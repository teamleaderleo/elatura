// SPDX-License-Identifier: MPL-2.0
/**
 * A deliberately small Codex-facing read-only viewport over the local
 * companion protocol.  The client has no browser automation or submission
 * primitive: it discovers one local session, issues bounded protocol calls,
 * and emits one bounded JSON envelope.
 */
import {
  COMPANION_PROTOCOL_VERSION,
  isCompanionToken,
  parseCompanionResponse,
} from "@elatura/core/companion";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const PROTOCOL_PATH = "/companion/v1";
const SESSION_PATH = "/companion/v1/session";
const MAX_SESSION_BYTES = 4_096;
const MAX_RESPONSE_BYTES = 2_097_152;
const MAX_STRING_CODE_UNITS = 262_144;
const MAX_ENVELOPE_BYTES = 2_097_152;
const ORIGIN_PATTERN = /^http:\/\/(?:127\.0\.0\.1|\[::1\])(?::(?:[1-9]\d{0,4}))?$/u;
const OPERATION_PATTERN = /^[a-z][a-z0-9-]{0,31}$/u;

export class AgentViewportError extends Error {
  constructor(code, message = code, details = undefined) {
    super(message);
    this.name = "AgentViewportError";
    this.code = code;
    this.details = details;
  }
}

function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value, maximum = 512) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/u.test(value);
}

function validatedReference(value) {
  if (!boundedString(value, 2_048)) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function utf8Bytes(value) {
  return new TextEncoder().encode(value).byteLength;
}

function exactKeys(value, expected) {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function assertOrigin(origin) {
  if (typeof origin !== "string" || !ORIGIN_PATTERN.test(origin)) {
    throw new AgentViewportError("origin-refused", "Only an exact HTTP loopback origin is allowed.");
  }
  const portText = origin.match(/:(\d+)$/u)?.[1];
  if (portText !== undefined && (Number(portText) < 1 || Number(portText) > 65_535)) {
    throw new AgentViewportError("origin-refused", "Only a valid loopback port is allowed.");
  }
  return origin;
}

function boundedJson(value) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new AgentViewportError("envelope-serialization-failed");
  }
  const bytes = utf8Bytes(serialized);
  if (bytes > MAX_ENVELOPE_BYTES) {
    throw new AgentViewportError("envelope-too-large");
  }
  return { serialized, bytes };
}

function nextRequestId(counter) {
  return `viewport-${counter}`;
}

function requireToken(value, name) {
  if (!isCompanionToken(value)) {
    throw new AgentViewportError("argument-invalid", `${name} is invalid.`);
  }
  return value;
}

function requirePositiveInteger(value, name, fallback = undefined) {
  const actual = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(actual) || actual < 1) {
    throw new AgentViewportError("argument-invalid", `${name} must be a positive integer.`);
  }
  return actual;
}

function optionalNonNegativeInteger(value, name, fallback = 0) {
  const actual = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(actual) || actual < 0) {
    throw new AgentViewportError("argument-invalid", `${name} must be a non-negative integer.`);
  }
  return actual;
}

function requestFor(sessionId, requestId, operation, payload) {
  return {
    version: COMPANION_PROTOCOL_VERSION,
    sessionId,
    requestId,
    operation,
    payload,
  };
}

function unknownSource() {
  return Object.freeze({
    identity: "UNKNOWN",
    provenance: "UNKNOWN",
    freshness: "UNKNOWN",
  });
}

function sourceFromPayload(payload) {
  if (!record(payload)) return unknownSource();
  const adapter = record(payload.adapter) ? payload.adapter : null;
  const provenance = record(payload.provenance) ? payload.provenance : "UNKNOWN";
  const freshness = typeof payload.freshness === "string" ? payload.freshness : "UNKNOWN";
  return {
    identity: adapter ?? "UNKNOWN",
    provenance,
    freshness,
  };
}

function mergeSource(primary, probe) {
  const first = primary ?? unknownSource();
  const second = probe ?? unknownSource();
  return {
    identity: first.identity === "UNKNOWN" ? second.identity : first.identity,
    provenance: first.provenance === "UNKNOWN" ? second.provenance : first.provenance,
    freshness: first.freshness === "UNKNOWN" ? second.freshness : first.freshness,
  };
}

function entryRegion(payload) {
  if (!record(payload)) return null;
  if (Array.isArray(payload.results)) {
    return {
      kind: "search-results",
      conversationId: payload.conversationId,
      generation: payload.generation,
      results: payload.results,
    };
  }
  if (Array.isArray(payload.entries)) {
    return {
      conversationId: payload.conversationId,
      generation: payload.generation,
      cursor: payload.cursor,
      entries: payload.entries,
      bounds: {
        hasBefore: payload.hasBefore,
        hasAfter: payload.hasAfter,
      },
    };
  }
  if (record(payload.entry)) {
    return {
      conversationId: payload.conversationId,
      generation: payload.generation,
      entries: [payload.entry],
      bounds: { hasBefore: null, hasAfter: null },
    };
  }
  return null;
}

function omissionFor(operation, payload, region) {
  if (operation === "search") {
    return {
      kind: payload.truncated ? "bounded-result-set" : "none",
      explicit: true,
      resultsTruncated: payload.truncated,
    };
  }
  if (!region) return { kind: "not-applicable", explicit: true };
  const before = region.bounds.hasBefore === true;
  const after = region.bounds.hasAfter === true;
  return {
    kind: before || after ? "outside-region" : "none",
    explicit: true,
    entriesOutsideRegion: before || after,
    hasBefore: region.bounds.hasBefore,
    hasAfter: region.bounds.hasAfter,
    textTruncatedCount: region.entries.filter((entry) => entry.textTruncated === true).length,
  };
}

function resultFor(operation, payload) {
  if (
    (operation === "open" || operation === "page-before" || operation === "page-after") &&
    record(payload) &&
    Array.isArray(payload.entries)
  ) {
    // Entries live in the exact region field below. Keep the protocol
    // envelope's result metadata, but do not serialize the same bounded page
    // twice.
    const { entries: _entries, ...metadata } = payload;
    return metadata;
  }
  if (operation === "jump-back" && record(payload)) {
    return { reference: validatedReference(payload.jumpBackReference) ?? "UNKNOWN" };
  }
  return payload;
}

function expansionFor(operation, payload, region) {
  const affordances = [];
  if (region?.bounds?.hasBefore === true && region.cursor) {
    affordances.push({ operation: "page-before", cursor: region.cursor });
  }
  if (region?.bounds?.hasAfter === true && region.cursor) {
    affordances.push({ operation: "page-after", cursor: region.cursor });
  }
  if (region?.entries?.length === 1) {
    const entry = region.entries[0];
    affordances.push({ operation: "get-entry", entryId: entry.id });
    if (entry.codeBlockCount > 0) affordances.push({ operation: "get-resource", entryId: entry.id });
    if (entry.jumpBackReference) affordances.push({ operation: "jump-back", entryId: entry.id });
  }
  if (operation === "search" && payload.truncated === true) {
    affordances.push({ operation: "search", reason: "increase-limit-or-refine-query" });
  }
  if (operation === "search" && Array.isArray(payload.results)) {
    for (const result of payload.results) {
      affordances.push({
        operation: "open",
        conversationId: payload.conversationId,
        anchorEntryId: result.entryId,
        before: 0,
        after: 1,
        inputKind: "search-result-entry-id",
      });
    }
  }
  return { affordances };
}

function readOnlyDeclaration() {
  return {
    mode: "read-only",
    submission: false,
    navigation: false,
    click: false,
    persistence: false,
    authority: "zero",
  };
}

function protocolError(error) {
  return new AgentViewportError(
    error?.code ?? "protocol-failed",
    "The bounded companion request failed.",
    error?.details,
  );
}

export function parseOrigin(value) {
  return assertOrigin(value);
}

/**
 * Creates a local viewport client.  `fetchImpl` is injectable to keep this
 * surface testable without changing the production transport boundary.
 */
export function createAgentViewportClient({ origin, fetchImpl = globalThis.fetch } = {}) {
  const fixedOrigin = assertOrigin(origin);
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be callable.");
  let requestCount = 0;
  let protocolCallCount = 0;
  let hiddenBackendCallCount = 0;
  let requestBytes = 0;
  let responseBytes = 0;
  let hiddenBackendRequestBytes = 0;
  let hiddenBackendResponseBytes = 0;
  let sessionDiscoveryCalls = 0;
  let sessionId = null;
  const callLog = [];

  const wire = () => ({
    requestCount,
    protocolCallCount,
    sessionDiscoveryCalls,
    hiddenBackendCallCount,
    requestBytes,
    responseBytes,
    hiddenBackendRequestBytes,
    hiddenBackendResponseBytes,
  });

  async function fetchJson(path, init, hidden = false) {
    const response = await fetchImpl(`${fixedOrigin}${path}`, { ...init, redirect: "manual" });
    if (response.url && response.url !== `${fixedOrigin}${path}`) {
      throw new AgentViewportError("redirect-refused");
    }
    const rawBuffer = await response.arrayBuffer();
    const rawBytes = rawBuffer.byteLength;
    if (rawBytes > (path === SESSION_PATH ? MAX_SESSION_BYTES : MAX_RESPONSE_BYTES)) {
      throw new AgentViewportError("response-too-large");
    }
    const raw = new TextDecoder().decode(rawBuffer);
    responseBytes += rawBytes;
    if (!response.ok) throw new AgentViewportError("http-refused");
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new AgentViewportError("response-not-json");
    }
    if (hidden) hiddenBackendResponseBytes += rawBytes;
    return value;
  }

  async function discoverSession() {
    if (sessionId) return sessionId;
    sessionDiscoveryCalls += 1;
    requestCount += 1;
    const rawRequestBytes = 0;
    requestBytes += rawRequestBytes;
    const value = await fetchJson(SESSION_PATH, {
      method: "GET",
      headers: { accept: "application/json" },
    });
    if (!record(value) || !exactKeys(value, ["protocolVersion", "sessionId"]) ||
      value.protocolVersion !== COMPANION_PROTOCOL_VERSION || !isCompanionToken(value.sessionId)) {
      throw new AgentViewportError("session-invalid");
    }
    sessionId = value.sessionId;
    callLog.push({ kind: "session", requestBytes: rawRequestBytes, responseBytes: utf8Bytes(JSON.stringify(value)) });
    return sessionId;
  }

  async function dispatch(operation, payload, { hidden = false } = {}) {
    if (!OPERATION_PATTERN.test(operation)) throw new AgentViewportError("operation-invalid");
    const activeSession = await discoverSession();
    const requestId = nextRequestId(++protocolCallCount);
    const request = requestFor(activeSession, requestId, operation, payload);
    const serialized = JSON.stringify(request);
    const sentBytes = utf8Bytes(serialized);
    requestBytes += sentBytes;
    requestCount += 1;
    if (hidden) {
      hiddenBackendCallCount += 1;
      hiddenBackendRequestBytes += sentBytes;
    }
    const started = Date.now();
    const value = await fetchJson(PROTOCOL_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        origin: fixedOrigin,
      },
      body: serialized,
    }, hidden);
    const parsed = parseCompanionResponse(value, MAX_RESPONSE_BYTES, MAX_STRING_CODE_UNITS);
    const responseWireBytes = utf8Bytes(JSON.stringify(value));
    callLog.push({
      kind: hidden ? "hidden-probe" : "protocol",
      operation,
      requestBytes: sentBytes,
      responseBytes: responseWireBytes,
      elapsedMs: Math.max(0, Date.now() - started),
    });
    if (!parsed.ok) {
      throw new AgentViewportError("response-invalid", "Protocol response validation failed.", {
        issues: parsed.issues.slice(0, 8),
      });
    }
    if (!parsed.value.ok) {
      throw new AgentViewportError(parsed.value.errorCode ?? "protocol-error");
    }
    return parsed.value;
  }

  async function provenanceProbe(conversationId, anchorEntryId = null) {
    try {
      const response = await dispatch("open", {
        conversationId,
        anchorEntryId,
        before: 0,
        after: 0,
      }, { hidden: true });
      return sourceFromPayload(response.payload);
    } catch {
      return unknownSource();
    }
  }

  async function execute(operation, args = {}) {
    const started = Date.now();
    const counterStart = {
      requestCount,
      protocolCallCount,
      sessionDiscoveryCalls,
      hiddenBackendCallCount,
      requestBytes,
      responseBytes,
      hiddenBackendRequestBytes,
      hiddenBackendResponseBytes,
    };
    let response;
    let source = unknownSource();
    let probeAttempted = false;
    let mainError = null;
    try {
      switch (operation) {
        case "status":
          response = await dispatch("status", { conversationId: args.conversationId ?? null });
          source = sourceFromPayload(response.payload?.conversation);
          if (args.conversationId) {
            probeAttempted = true;
            source = mergeSource(source, await provenanceProbe(args.conversationId));
          }
          break;
        case "search":
          response = await dispatch("search", {
            conversationId: requireToken(args.conversationId, "conversationId"),
            query: boundedString(args.query, 4_096) ? args.query : (() => { throw new AgentViewportError("argument-invalid"); })(),
            limit: requirePositiveInteger(args.limit, "limit", 10),
          });
          source = sourceFromPayload(response.payload);
          probeAttempted = true;
          source = mergeSource(source, await provenanceProbe(args.conversationId));
          break;
        case "open":
          response = await dispatch("open", {
            conversationId: requireToken(args.conversationId, "conversationId"),
            anchorEntryId: args.anchorEntryId ?? null,
            before: optionalNonNegativeInteger(args.before, "before", 10),
            after: optionalNonNegativeInteger(args.after, "after", 10),
          });
          source = sourceFromPayload(response.payload);
          break;
        case "page-before":
        case "page-after":
          response = await dispatch("page", {
            conversationId: requireToken(args.conversationId, "conversationId"),
            cursor: requireToken(args.cursor, "cursor"),
            direction: operation === "page-before" ? "before" : "after",
            limit: requirePositiveInteger(args.limit, "limit", 10),
          });
          source = sourceFromPayload(response.payload);
          break;
        case "get-entry":
          response = await dispatch("entry", {
            conversationId: requireToken(args.conversationId, "conversationId"),
            entryId: requireToken(args.entryId, "entryId"),
          });
          source = sourceFromPayload(response.payload);
          probeAttempted = true;
          source = mergeSource(source, await provenanceProbe(args.conversationId, args.entryId));
          break;
        case "get-resource":
          response = await dispatch("code", {
            conversationId: requireToken(args.conversationId, "conversationId"),
            entryId: requireToken(args.entryId, "entryId"),
            blockIndex: optionalNonNegativeInteger(args.blockIndex, "blockIndex", 0),
          });
          probeAttempted = true;
          source = await provenanceProbe(args.conversationId, args.entryId);
          break;
        case "jump-back":
          response = await dispatch("navigate", {
            conversationId: requireToken(args.conversationId, "conversationId"),
            entryId: requireToken(args.entryId, "entryId"),
          });
          probeAttempted = true;
          source = await provenanceProbe(args.conversationId, args.entryId);
          break;
        case "close":
          probeAttempted = true;
          source = await provenanceProbe(requireToken(args.conversationId, "conversationId"));
          response = await dispatch("close", { conversationId: args.conversationId });
          break;
        default:
          throw new AgentViewportError("operation-invalid");
      }
    } catch (error) {
      mainError = error instanceof AgentViewportError ? error : new AgentViewportError("viewport-failed");
    }

    const payload = response?.payload ?? null;
    const region = entryRegion(payload);
    const operationResult = resultFor(operation, payload);
    const companionUsage = response?.usage ?? null;
    const currentWire = wire();
    const operationWire = Object.fromEntries(
      Object.keys(currentWire).map((key) => [key, currentWire[key] - counterStart[key]]),
    );
    const envelope = {
      operation,
      ok: mainError === null,
      result: operationResult,
      source: mainError === null ? source : unknownSource(),
      region,
      omission: mainError === null ? omissionFor(operation, payload, region) : { kind: "UNKNOWN", explicit: true },
      expansion: mainError === null ? expansionFor(operation, payload, region) : { affordances: [] },
      readOnly: readOnlyDeclaration(),
      metrics: {
        wire: operationWire,
        accounting: {
          emittedEnvelopeBytes: null,
          elapsedMs: Math.max(0, Date.now() - started),
          provenanceProbeAttempted: probeAttempted,
          provenanceProbeResult: probeAttempted && source.provenance !== "UNKNOWN" ? "validated" : probeAttempted ? "UNKNOWN" : "not-needed",
        },
      },
      companionUsage,
      error: mainError ? { code: mainError.code } : null,
    };
    let bounded = boundedJson(envelope);
    envelope.metrics.accounting.emittedEnvelopeBytes = bounded.bytes;
    bounded = boundedJson(envelope);
    envelope.metrics.accounting.emittedEnvelopeBytes = bounded.bytes;
    bounded = boundedJson(envelope);
    return { envelope, serialized: bounded.serialized };
  }

  return Object.freeze({ discoverSession, dispatch, execute, get wire() { return wire(); }, get callLog() { return [...callLog]; } });
}

function parseArguments(argv) {
  const [operation, ...rest] = argv;
  if (!operation || operation === "--help") return { help: true };
  const options = {};
  const positional = [];
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === "--origin") options.origin = rest[++index];
    else if (value === "--conversation") options.conversationId = rest[++index];
    else if (value === "--query") options.query = rest[++index];
    else if (value === "--cursor") options.cursor = rest[++index];
    else if (value === "--entry") options.entryId = rest[++index];
    else if (value === "--anchor") options.anchorEntryId = rest[++index];
    else if (value === "--before") options.before = rest[++index];
    else if (value === "--after") options.after = rest[++index];
    else if (value === "--limit") options.limit = rest[++index];
    else if (value === "--block") options.blockIndex = rest[++index];
    else if (value.startsWith("--")) throw new AgentViewportError("argument-invalid");
    else positional.push(value);
  }
  let operationArguments = positional;
  if (options.conversationId === undefined && positional[0]) {
    options.conversationId = positional[0];
    operationArguments = positional.slice(1);
  }
  if (operation === "search") {
    if (options.query === undefined && operationArguments[0]) options.query = operationArguments[0];
    if (options.limit === undefined && operationArguments[1]) options.limit = operationArguments[1];
  } else if (operation === "open") {
    if (options.anchorEntryId === undefined && operationArguments[0]) options.anchorEntryId = operationArguments[0];
    if (options.before === undefined && operationArguments[1]) options.before = operationArguments[1];
    if (options.after === undefined && operationArguments[2]) options.after = operationArguments[2];
  } else if (operation.startsWith("page-")) {
    if (options.cursor === undefined && operationArguments[0]) options.cursor = operationArguments[0];
    if (options.limit === undefined && operationArguments[1]) options.limit = operationArguments[1];
  } else if (operation === "get-entry" || operation === "jump-back") {
    if (options.entryId === undefined && operationArguments[0]) options.entryId = operationArguments[0];
  } else if (operation === "get-resource") {
    if (options.entryId === undefined && operationArguments[0]) options.entryId = operationArguments[0];
    if (options.blockIndex === undefined && operationArguments[1]) options.blockIndex = operationArguments[1];
  }
  return { operation, options };
}

export async function runViewportCli(argv = process.argv.slice(2), fetchImpl = globalThis.fetch) {
  let parsed;
  try {
    parsed = parseArguments(argv);
    if (parsed.help) {
      return {
        exitCode: 0,
        output: [
          "Usage: query-agent-viewport.mjs <operation> --origin LOOPBACK --conversation ID [arguments]",
          "",
          "status",
          "search QUERY [LIMIT]       # result.entryId is a search-result entry ID",
          "open [ENTRY_ID [BEFORE AFTER]] # ENTRY_ID may come from search.result.entryId",
          "page-before CURSOR [LIMIT] # CURSOR comes only from open/page result.cursor",
          "page-after CURSOR [LIMIT]  # CURSOR comes only from open/page result.cursor",
          "get-entry ENTRY_ID         # entry ID, never a page cursor",
          "get-resource ENTRY_ID [BLOCK_INDEX] # entry ID, never a page cursor",
          "jump-back ENTRY_ID         # entry ID, never a page cursor",
          "close",
          "",
          "Every command emits one JSON envelope. jump-back returns a reference and performs no navigation.",
          "",
        ].join("\n"),
      };
    }
    if (!parsed.options.origin) throw new AgentViewportError("argument-invalid");
    const client = createAgentViewportClient({ origin: parsed.options.origin, fetchImpl });
    const result = await client.execute(parsed.operation, parsed.options);
    return { exitCode: result.envelope.ok ? 0 : 1, output: result.serialized + "\n", envelope: result.envelope };
  } catch (error) {
    const failure = error instanceof AgentViewportError ? error : new AgentViewportError("viewport-failed");
    const envelope = {
      operation: parsed?.operation ?? "UNKNOWN",
      ok: false,
      result: null,
      source: unknownSource(),
      region: null,
      omission: { kind: "UNKNOWN", explicit: true },
      expansion: { affordances: [] },
      readOnly: readOnlyDeclaration(),
      metrics: { wire: null, accounting: { emittedEnvelopeBytes: null } },
      companionUsage: null,
      error: { code: failure.code },
    };
    const serialized = boundedJson(envelope).serialized;
    return { exitCode: 1, output: serialized + "\n", envelope };
  }
}

export async function isDirectInvocation(argvPath, moduleUrl = import.meta.url) {
  if (typeof argvPath !== "string") return false;
  const moduleFilePath = fileURLToPath(moduleUrl);
  const [resolvedInvoked, resolvedModule] = await Promise.all([
    realpath(argvPath).catch(() => null),
    realpath(moduleFilePath).catch(() => null),
  ]);
  // macOS exposes /var as a symlink to /private/var.  realpath normally
  // resolves both spellings, but a launcher can hand Node the alias before
  // the path is resolvable (and tests/tools can supply that spelling).  Only
  // this exact prefix alias is folded; the remainder must still equal the
  // approved module file path exactly.
  const invoked = canonicalMacVarAlias(resolvedInvoked ?? argvPath);
  const modulePath = canonicalMacVarAlias(resolvedModule ?? moduleFilePath);
  return invoked === modulePath;
}

export function canonicalMacVarAlias(value) {
  if (typeof value !== "string") return null;
  const absolute = value.startsWith("/") ? value : null;
  if (absolute === null) return null;
  if (absolute === "/private/var") return "/var";
  if (absolute.startsWith("/private/var/")) {
    return `/var${absolute.slice("/private/var".length)}`;
  }
  return absolute;
}

if (await isDirectInvocation(process.argv[1])) {
  const result = await runViewportCli();
  process.stdout.write(result.output);
  process.exitCode = result.exitCode;
}
