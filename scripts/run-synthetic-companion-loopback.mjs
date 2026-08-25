// SPDX-License-Identifier: MPL-2.0
/**
 * Loopback-only synthetic companion protocol and static surface server.
 *
 * Hard boundary: this process serves fixed local synthetic assets and one
 * protocol endpoint over an explicitly loopback-bound HTTP listener. It binds
 * only 127.0.0.1 / ::1, drops every connection from any other peer, refuses
 * unexpected methods, paths, origins, hosts, and content types, bounds every
 * body, and performs no outbound network behavior whatsoever. There is no
 * persistence, analytics, telemetry, credential handling, private content,
 * native messaging, or message submission on this surface.
 */
import {
  SyntheticCompanion,
  COMPANION_PROTOCOL_VERSION,
  parseCompanionRequest,
} from "@elatura/core/companion";
import { READ_ONLY_REPRESENTATION_VERSION } from "@elatura/core/representation";
import { validateChatGptConversation } from "@elatura/adapter-chatgpt";
import { toSyntheticChatGptRepresentation } from "@elatura/adapter-chatgpt/contracts";
import { generateSyntheticConversation } from "@elatura/fixtures";
import { readFile, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_REQUEST_BODY_BYTES = 65_536;
const MAX_URL_LENGTH = 512;
const MAX_HEADER_COUNT = 64;
const FIXED_CLOCK_MS = 10_000;
const FRESHNESS_FRESH = { capturedAt: 100, staleAt: 1_000_000, expiresAt: 2_000_000 };
const FRESHNESS_STALE = { capturedAt: 100, staleAt: FIXED_CLOCK_MS - 1_000, expiresAt: 1_000_000 };
const FRESHNESS_EXPIRED = { capturedAt: 100, staleAt: 500, expiresAt: 900 };
const AUTHORITY_ORIGIN = "https://synthetic.elatura.invalid";
const AUTHORITY_REFERENCE = `${AUTHORITY_ORIGIN}/conversation`;
const LARGE_SOURCE_REPRESENTATION_POLICY = Object.freeze({
  maxEntries: 100_000,
  maxRepresentationNodes: 4_000_000,
  maxRepresentationSerializedBytes: 134_217_728,
});
const DEFAULT_SESSION_TOKEN = "synthetic-companion-loopback";
const MAX_ASSET_BYTES = 262_144;

export const ALLOWED_BIND_HOSTS = Object.freeze(["127.0.0.1", "::1"]);
export const PROTOCOL_PATH = "/companion/v1";
export const SESSION_INFO_PATH = "/companion/v1/session";

function codeText(unitPattern, units) {
  return unitPattern.repeat(Math.ceil(units / unitPattern.length)).slice(0, units);
}

/**
 * Fixed deterministic scenario registry. Every conversation id is a bounded
 * synthetic token; fixtures flow through the merged
 * generate -> validate -> alternate-representation -> SyntheticCompanion path.
 */
export const SCENARIO_REGISTRY = Object.freeze({
  "synthetic-100": Object.freeze({
    turnGroups: 33,
    hiddenNodesPerTurn: 1,
    seed: 86,
    freshness: FRESHNESS_FRESH,
    needsLargeSourcePolicy: false,
    driftProfile: false,
  }),
  "synthetic-10000": Object.freeze({
    turnGroups: 99,
    hiddenNodesPerTurn: 99,
    seed: 87,
    freshness: FRESHNESS_FRESH,
    needsLargeSourcePolicy: false,
    driftProfile: false,
  }),
  "synthetic-100000": Object.freeze({
    turnGroups: 2_439,
    hiddenNodesPerTurn: 39,
    seed: 88,
    freshness: FRESHNESS_FRESH,
    needsLargeSourcePolicy: true,
    driftProfile: false,
  }),
  "branch-heavy": Object.freeze({
    turnGroups: 40,
    branchEvery: 4,
    hiddenNodesPerTurn: 0,
    seed: 89,
    freshness: FRESHNESS_FRESH,
    needsLargeSourcePolicy: false,
    driftProfile: false,
  }),
  "large-code": Object.freeze({
    turnGroups: 20,
    hiddenNodesPerTurn: 0,
    seed: 90,
    freshness: FRESHNESS_FRESH,
    needsLargeSourcePolicy: false,
    driftProfile: false,
    codeBlocks: [
      Object.freeze({ language: "ts", text: codeText("const synthetic = 41;\n", 1_024) }),
      Object.freeze({ language: "js", text: codeText("let synthetic = 42;\n", 1_024) }),
    ],
  }),
  "stale-source": Object.freeze({
    turnGroups: 10,
    hiddenNodesPerTurn: 0,
    seed: 91,
    freshness: FRESHNESS_STALE,
    needsLargeSourcePolicy: false,
    driftProfile: false,
  }),
  "expired-source": Object.freeze({
    turnGroups: 10,
    hiddenNodesPerTurn: 0,
    seed: 92,
    freshness: FRESHNESS_EXPIRED,
    needsLargeSourcePolicy: false,
    driftProfile: false,
  }),
  "corrupt-source": Object.freeze({
    turnGroups: 10,
    hiddenNodesPerTurn: 0,
    seed: 93,
    freshness: FRESHNESS_FRESH,
    corrupt: true,
    needsLargeSourcePolicy: false,
    driftProfile: false,
  }),
  "drifted-source": Object.freeze({
    turnGroups: 10,
    hiddenNodesPerTurn: 0,
    seed: 94,
    freshness: FRESHNESS_FRESH,
    driftProfile: true,
    needsLargeSourcePolicy: false,
  }),
});

export const SCENARIO_IDS = Object.freeze(Object.keys(SCENARIO_REGISTRY));
const DEFAULT_SCENARIOS = Object.freeze(["synthetic-100"]);

function buildRepresentation(scenarioId) {
  const scenario = SCENARIO_REGISTRY[scenarioId];
  if (!scenario) throw new TypeError(`Unknown scenario ${scenarioId}.`);
  const fixture = generateSyntheticConversation({
    turnGroups: scenario.turnGroups,
    branchEvery: scenario.branchEvery ?? 0,
    hiddenNodesPerTurn: scenario.hiddenNodesPerTurn ?? 0,
    payloadBytesPerMessage: 16,
    seed: scenario.seed,
  });
  const validated = validateChatGptConversation(fixture);
  if (!validated.ok) {
    throw new TypeError("Generated fixture failed adapter validation.");
  }
  const represented = toSyntheticChatGptRepresentation(validated.value, {
    authorityOrigin: AUTHORITY_ORIGIN,
    authorityReference: AUTHORITY_REFERENCE,
    capturedAt: scenario.freshness.capturedAt,
    staleAt: scenario.freshness.staleAt,
    expiresAt: scenario.freshness.expiresAt,
    ...(scenario.needsLargeSourcePolicy ? { representationPolicy: LARGE_SOURCE_REPRESENTATION_POLICY } : {}),
  });
  if (!represented.ok) {
    throw new TypeError(
      `Scenario ${scenarioId} representation rejected: ${represented.issues[0]?.code ?? "unknown"}.`,
    );
  }
  if (scenario.corrupt) {
    return { ...represented.value, version: READ_ONLY_REPRESENTATION_VERSION + 1 };
  }
  if (scenario.codeBlocks) {
    const source = represented.value;
    const target = source.entries[source.entries.length - 3];
    if (!target) throw new TypeError("Code scenario has no mutable entry.");
    target.codeBlocks.push(...scenario.codeBlocks.map((block) => ({ ...block })));
    return source;
  }
  return represented.value;
}

/** Builds the single guarded companion for the selected scenarios. */
export function buildSyntheticCompanion({
  sessionToken = DEFAULT_SESSION_TOKEN,
  scenarioIds = [...DEFAULT_SCENARIOS],
} = {}) {
  const unknown = scenarioIds.filter((id) => !SCENARIO_REGISTRY[id]);
  if (unknown.length > 0) {
    throw new TypeError(`Unknown scenario ids: ${unknown.join(", ")}`);
  }
  const unique = [...new Set(scenarioIds)];
  const hasDrift = unique.includes("drifted-source");
  if (hasDrift && unique.length > 1) {
    throw new TypeError("drifted-source cannot be combined with other scenarios.");
  }
  const needsLargeSourcePolicy = unique.some(
    (id) => SCENARIO_REGISTRY[id].needsLargeSourcePolicy,
  );
  return new SyntheticCompanion({
    sessionId: sessionToken,
    now: () => FIXED_CLOCK_MS,
    conversations: unique.map((id) => ({
      id,
      representation: buildRepresentation(id),
    })),
    ...(hasDrift ? { acceptedAdapters: [] } : {}),
    ...(needsLargeSourcePolicy ? { representationPolicy: LARGE_SOURCE_REPRESENTATION_POLICY } : {}),
  });
}

/** Fixed same-origin static asset table: URL path -> repository file. */
export function staticAssetTable() {
  return new Map([
    ["/", "packages/companion-web/browser/index.html"],
    ["/app.css", "packages/companion-web/browser/app.css"],
    ["/app.js", "packages/companion-web/browser/app.js"],
    ...["companion", "companion-client", "companion-protocol", "companion-response",
      "companion-runtime", "companion-synthetic", "representation", "resource-accounting",
    ].flatMap((name) => [
      [`/vendor/@elatura/core/${name}.js`, `packages/core/dist/${name}.js`],
    ]),
    ...["browser-request-ledger", "controller", "http-companion-transport",
      "index", "navigation", "plateau", "render-sink", "transport", "view-model",
    ].flatMap((name) => [
      [`/vendor/@elatura/companion-web/${name}.js`, `packages/companion-web/dist/${name}.js`],
    ]),
  ]);
}

const CONTENT_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  ["default-js", "text/javascript; charset=utf-8"],
]);

const BASE_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-security-policy": [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "style-src-attr 'none'",
    "connect-src 'self'",
    "img-src 'none'",
    "font-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; "),
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
});

export class RefusedBindingError extends TypeError {}

export function assertBindableHost(host) {
  if (!ALLOWED_BIND_HOSTS.includes(host)) {
    throw new RefusedBindingError(
      `Refusing to bind ${host}; only ${ALLOWED_BIND_HOSTS.join(" or ")} are permitted.`,
    );
  }
}

export function isLoopbackRemoteAddress(remoteAddress) {
  if (typeof remoteAddress !== "string") return false;
  const normalized = remoteAddress.startsWith("::ffff:")
    ? remoteAddress.slice("::ffff:".length)
    : remoteAddress;
  return normalized === "127.0.0.1" || normalized === "::1";
}

function expectedHostHeaders(host, port) {
  return host === "::1" ? [`[::1]:${port}`] : [`${host}:${port}`];
}

function originFor(host, port) {
  return host === "::1" ? `http://[::1]:${port}` : `http://${host}:${port}`;
}

async function loadAssets(table) {
  const loaded = new Map();
  for (const [route, relative] of table) {
    const absolute = resolve(REPO_ROOT, relative);
    if (!absolute.startsWith(`${REPO_ROOT}/`)) {
      throw new TypeError(`Asset route escapes the repository: ${relative}`);
    }
    const info = await stat(absolute);
    if (!info.isFile() || info.size > MAX_ASSET_BYTES) {
      throw new TypeError(`Fixed asset is missing or oversized: ${relative}`);
    }
    const extension = relative.endsWith(".html") ? ".html"
      : relative.endsWith(".css") ? ".css"
      : "default-js";
    loaded.set(route, Object.freeze({
      bytes: await readFile(absolute),
      contentType: CONTENT_TYPES.get(extension),
    }));
  }
  return loaded;
}

export function parseServerArguments(argv) {
  const parsed = {
    host: "127.0.0.1",
    port: 0,
    sessionToken: DEFAULT_SESSION_TOKEN,
    scenarioIds: [...DEFAULT_SCENARIOS],
    listScenarios: false,
    selfTest: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined) throw new TypeError(`${argument} requires a value.`);
      index += 1;
      return next;
    };
    if (argument === "--host") {
      parsed.host = value();
    } else if (argument === "--port") {
      const port = Number(value());
      if (!Number.isInteger(port) || port < 0 || port > 65_535) {
        throw new TypeError("--port must be an integer between 0 and 65535.");
      }
      parsed.port = port;
    } else if (argument === "--session") {
      const token = value();
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(token)) {
        throw new TypeError("--session must be a bounded local token.");
      }
      parsed.sessionToken = token;
    } else if (argument === "--conversation") {
      const ids = value().split(",").map((id) => id.trim()).filter((id) => id.length > 0);
      const unknown = ids.filter((id) => !SCENARIO_REGISTRY[id]);
      if (unknown.length > 0) {
        throw new TypeError(`Unknown scenario ids: ${unknown.join(", ")}`);
      }
      parsed.scenarioIds = ids;
    } else if (argument === "--list-scenarios") {
      parsed.listScenarios = true;
    } else if (argument === "--self-test") {
      parsed.selfTest = true;
    } else if (argument === "--help") {
      parsed.help = true;
    } else {
      throw new TypeError(`Unknown argument: ${argument}`);
    }
  }
  return parsed;
}

/**
 * Creates the loopback-only server. No listener is opened until start().
 */
export async function createLoopbackServer(options = {}) {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const sessionToken = options.sessionToken ?? DEFAULT_SESSION_TOKEN;
  assertBindableHost(host);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new TypeError("port must be an integer between 0 and 65535.");
  }
  const companion = buildSyntheticCompanion({
    sessionToken,
    scenarioIds: options.scenarioIds ?? [...DEFAULT_SCENARIOS],
  });
  const assets = await loadAssets(staticAssetTable());

  const server = createServer();
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = MAX_HEADER_COUNT;

  const state = {
    started: false,
    boundPort: null,
    refusedConnectionCount: 0,
    refusedRequestCount: 0,
    dispatchedProtocolRequestCount: 0,
  };

  server.on("connection", (socket) => {
    if (!isLoopbackRemoteAddress(socket.remoteAddress)) {
      state.refusedConnectionCount += 1;
      socket.destroy();
    }
  });

  function sendFixed(response, statusCode, body, extraHeaders = {}) {
    if (response.headersSent || response.writableEnded) {
      response.destroy();
      return;
    }
    response.writeHead(statusCode, {
      ...BASE_HEADERS,
      "content-type": typeof body === "string" ? "application/json" : "text/plain; charset=utf-8",
      "content-length": Buffer.byteLength(body),
      ...extraHeaders,
    });
    response.end(body);
  }

  function refuse(response, statusCode, code) {
    state.refusedRequestCount += 1;
    sendFixed(response, statusCode, JSON.stringify({ refused: code }));
  }

  async function readBoundedBody(request, response) {
    const declared = Number(request.headers["content-length"]);
    if (
      request.headers["transfer-encoding"] !== undefined ||
      !Number.isSafeInteger(declared) ||
      declared < 0 ||
      declared > MAX_REQUEST_BODY_BYTES
    ) {
      refuse(response, declared > MAX_REQUEST_BODY_BYTES ? 413 : 400, "body-not-allowed");
      return null;
    }
    const chunks = [];
    let received = 0;
    for await (const chunk of request) {
      received += chunk.length;
      if (received > MAX_REQUEST_BODY_BYTES) {
        refuse(response, 413, "body-too-large");
        request.destroy();
        return null;
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  function handleSessionInfo(request, response) {
    if (request.method === "HEAD") {
      response.writeHead(200, { ...BASE_HEADERS, "content-type": "application/json", "content-length": 0 });
      response.end();
      return;
    }
    sendFixed(response, 200, JSON.stringify({
      protocolVersion: COMPANION_PROTOCOL_VERSION,
      sessionId: companion.sessionId,
    }));
  }

  async function handleProtocolPost(request, response) {
    const contentType = String(request.headers["content-type"] ?? "");
    if (contentType !== "application/json") {
      refuse(response, 415, "content-type-not-allowed");
      return;
    }
    const body = await readBoundedBody(request, response);
    if (body === null) return;

    state.dispatchedProtocolRequestCount += 1;
    let envelope;
    try {
      const parsedRequest = parseCompanionRequest(JSON.parse(body));
      if (!parsedRequest.ok) {
        envelope = {
          version: COMPANION_PROTOCOL_VERSION,
          sessionId: companion.sessionId,
          requestId: "invalid",
          operation: "invalid",
          ok: false,
          payload: null,
          errorCode: "invalid-request",
          usage: companion.usage,
        };
      } else {
        const controller = new AbortController();
        request.on("aborted", () => controller.abort());
        response.on("close", () => {
          if (!response.writableEnded) controller.abort();
        });
        envelope = await companion.dispatch(parsedRequest.value, {
          beforeCommit: async () => {
            await Promise.resolve();
            if (controller.signal.aborted) {
              throw new Error("The loopback companion request was cancelled.");
            }
          },
        });
      }
    } catch {
      envelope = {
        version: COMPANION_PROTOCOL_VERSION,
        sessionId: companion.sessionId,
        requestId: "invalid",
        operation: "invalid",
        ok: false,
        payload: null,
        errorCode: "invalid-request",
        usage: companion.usage,
      };
    }
    const serialized = JSON.stringify(envelope);
    if (Buffer.byteLength(serialized) > 2_097_152) {
      sendFixed(response, 200, JSON.stringify({
        version: COMPANION_PROTOCOL_VERSION,
        sessionId: companion.sessionId,
        requestId: envelope.requestId,
        operation: envelope.operation,
        ok: false,
        payload: null,
        errorCode: "response-too-large",
        usage: envelope.usage,
      }));
      return;
    }
    sendFixed(response, 200, serialized);
  }

  server.on("request", (request, response) => {
    try {
      if (!isLoopbackRemoteAddress(request.socket.remoteAddress)) {
        state.refusedConnectionCount += 1;
        response.destroy();
        return;
      }
      if (
        request.url === undefined ||
        request.url.length > MAX_URL_LENGTH ||
        request.url.includes("?") ||
        request.url.includes("#")
      ) {
        refuse(response, 404, "path-not-allowed");
        return;
      }
      const pathname = request.url;

      const hostHeader = request.headers.host;
      if (
        typeof hostHeader !== "string" ||
        !expectedHostHeaders(host, state.boundPort ?? port).includes(
          hostHeader.toLowerCase(),
        )
      ) {
        refuse(response, 421, "host-not-allowed");
        return;
      }

      const siteHeader = request.headers["sec-fetch-site"];
      if (
        typeof siteHeader === "string" &&
        siteHeader !== "same-origin" &&
        siteHeader !== "none"
      ) {
        refuse(response, 403, "site-not-allowed");
        return;
      }

      if (pathname === PROTOCOL_PATH) {
        if (request.method !== "POST") {
          refuse(response, 405, "method-not-allowed");
          return;
        }
        if (request.headers.origin !== originFor(host, state.boundPort ?? port)) {
          refuse(response, 403, "origin-not-allowed");
          return;
        }
        void handleProtocolPost(request, response);
        return;
      }

      if (pathname === SESSION_INFO_PATH) {
        if (request.method !== "GET" && request.method !== "HEAD") {
          refuse(response, 405, "method-not-allowed");
          return;
        }
        handleSessionInfo(request, response);
        return;
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        refuse(response, 405, "method-not-allowed");
        return;
      }
      const asset = assets.get(pathname);
      if (!asset) {
        refuse(response, 404, "path-not-allowed");
        return;
      }
      if (request.method === "HEAD") {
        response.writeHead(200, {
          ...BASE_HEADERS,
          "content-type": asset.contentType,
          "content-length": asset.bytes.length,
        });
        response.end();
        return;
      }
      response.writeHead(200, {
        ...BASE_HEADERS,
        "content-type": asset.contentType,
        "content-length": asset.bytes.length,
      });
      response.end(asset.bytes);
    } catch {
      try {
        refuse(response, 500, "internal-refused");
      } catch {
        response.destroy();
      }
    }
  });

  return {
    server,
    companion,
    get sessionId() {
      return companion.sessionId;
    },
    get scenarioIds() {
      return Object.freeze([...(options.scenarioIds ?? DEFAULT_SCENARIOS)]);
    },
    get state() {
      return Object.freeze({ ...state });
    },
    origin() {
      if (state.boundPort === null) throw new TypeError("Server is not started.");
      return originFor(host, state.boundPort);
    },
    async start() {
      if (state.started) throw new TypeError("Server already started.");
      await new Promise((resolveStart, rejectStart) => {
        const onError = (error) => {
          server.off("listening", onListening);
          rejectStart(error);
        };
        const onListening = () => {
          server.off("error", onError);
          resolveStart(undefined);
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, host);
      });
      state.started = true;
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new TypeError("Unexpected loopback listener address.");
      }
      state.boundPort = address.port;
      return state.boundPort;
    },
    async stop() {
      await new Promise((resolveStop) => server.close(() => resolveStop()));
      state.started = false;
      state.boundPort = null;
    },
  };
}

function runSelfTests() {
  return import("node:assert/strict").then((module) =>
    runSelfTestsWithAssert(module.default),
  );
}

async function runSelfTestsWithAssert(assert) {
  assertBindableHost("127.0.0.1");
  assertBindableHost("::1");
  for (const hostile of ["0.0.0.0", "::", "localhost", "example.test", "192.168.1.10"]) {
    let refused = false;
    try {
      assertBindableHost(hostile);
    } catch (error) {
      refused = error instanceof RefusedBindingError;
    }
    assert(refused, `binding ${hostile} must be refused`);
  }

  const table = staticAssetTable();
  for (const [route] of table) {
    assert(route.startsWith("/") && !route.includes(".."), `unsafe route ${route}`);
  }
  assert(table.has("/"), "index route missing");

  assert(SCENARIO_IDS.includes("synthetic-100"), "smoke scenario missing");
  assert.throws(() => buildSyntheticCompanion({ scenarioIds: ["missing"] }), TypeError);
  assert.throws(
    () => buildSyntheticCompanion({ scenarioIds: ["drifted-source", "synthetic-100"] }),
    /cannot be combined/u,
  );

  const parsed = parseServerArguments(["--host", "::1", "--port", "4173"]);
  assert(parsed.host === "::1" && parsed.port === 4173, "argument parsing drifted");
  await assert.rejects(
    () => createLoopbackServer({ host: "0.0.0.0" }),
    RefusedBindingError,
  );

  process.stdout.write("Self-test passed: binding refusals, asset routes, scenario guards.\n");
}
async function runCli() {
  const parsed = parseServerArguments(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(
      [
        "Usage: node scripts/run-synthetic-companion-loopback.mjs [options]",
        "",
        "--host 127.0.0.1|::1     Bind address (loopback literals only)",
        "--port N                 TCP port; 0 selects an ephemeral port",
        "--session TOKEN          Bounded session token",
        "--conversation ID[,ID…]  Scenario ids from the fixed registry",
        "--list-scenarios         Print the scenario registry and exit",
        "--self-test              Run embedded refusal self-tests and exit",
        "--help                   Show this help",
        "",
      ].join("\n"),
    );
    return;
  }
  if (parsed.selfTest) {
    runSelfTests();
    return;
  }
  if (parsed.listScenarios) {
    for (const id of SCENARIO_IDS) {
      process.stdout.write(`${id}\n`);
    }
    return;
  }
  assertBindableHost(parsed.host);
  const instance = await createLoopbackServer(parsed);
  const boundPort = await instance.start();
  process.stdout.write(
    `synthetic companion loopback listening on ${instance.origin()} ` +
    `scenarios=${instance.scenarioIds.join(",")} session=${instance.sessionId}\n`,
  );
  const shutdown = () => {
    void instance.stop().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  (await realpath(process.argv[1]).catch(() => null)) ===
    (await realpath(fileURLToPath(import.meta.url)).catch(() => null));

if (invokedDirectly) {
  await runCli();
}
