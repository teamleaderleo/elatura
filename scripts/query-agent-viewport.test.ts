import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLoopbackServer } from "./run-synthetic-companion-loopback.mjs";
import {
  createAgentViewportClient,
  canonicalMacVarAlias,
  isDirectInvocation,
  parseOrigin,
  runViewportCli,
} from "./query-agent-viewport.mjs";

let instance: Awaited<ReturnType<typeof createLoopbackServer>>;
let origin: string;

beforeAll(async () => {
  instance = await createLoopbackServer({
    host: "127.0.0.1",
    scenarioIds: ["synthetic-100", "large-code"],
    sessionToken: "viewport-test-session",
  });
  await instance.start();
  origin = instance.origin();
});

afterAll(async () => {
  await instance?.stop();
});

describe("agent viewport loopback client", () => {
  it("recognizes the invoked script through canonical path aliases", async () => {
    expect(await isDirectInvocation(new URL("./query-agent-viewport.mjs", import.meta.url).pathname)).toBe(true);
    const privatePath = "/private/var/folders/zz/agent/query-agent-viewport.mjs";
    const varPath = "/var/folders/zz/agent/query-agent-viewport.mjs";
    expect(canonicalMacVarAlias(privatePath)).toBe(varPath);
    expect(canonicalMacVarAlias(varPath)).toBe(varPath);
    expect(await isDirectInvocation(varPath, `file://${privatePath}`)).toBe(true);
    expect(await isDirectInvocation("/various/folders/zz/agent/query-agent-viewport.mjs", `file://${privatePath}`)).toBe(false);
    expect(canonicalMacVarAlias("/private/various/folders/zz/agent/query-agent-viewport.mjs"))
      .toBe("/private/various/folders/zz/agent/query-agent-viewport.mjs");
  });

  it("accepts only an exact loopback origin", () => {
    expect(parseOrigin("http://127.0.0.1:4173")).toBe("http://127.0.0.1:4173");
    expect(parseOrigin("http://[::1]:4173")).toBe("http://[::1]:4173");
    for (const hostile of [
      "http://localhost:4173",
      "https://127.0.0.1:4173",
      "http://127.0.0.2:4173",
      "http://127.0.0.1:4173/path",
      "http://127.0.0.1:4173?x=1",
    ]) {
      expect(() => parseOrigin(hostile)).toThrow();
    }
  });

  it("discovers the session and returns a bounded open region with provenance", async () => {
    const client = createAgentViewportClient({ origin });
    const result = await client.execute("open", {
      conversationId: "synthetic-100",
      before: 1,
      after: 1,
    });
    expect(result.envelope.ok).toBe(true);
    expect(result.envelope.source.provenance).toMatchObject({
      authority: { origin: "https://synthetic.elatura.invalid" },
    });
    expect(result.envelope.region.entries.length).toBeLessThanOrEqual(3);
    expect(result.envelope.result.entries).toBeUndefined();
    expect(result.envelope.result.cursor).toBe(result.envelope.region.cursor);
    expect(result.envelope.region.bounds).toEqual({ hasBefore: true, hasAfter: false });
    expect(result.envelope.omission.kind).toBe("outside-region");
    expect(result.envelope.expansion.affordances).toEqual([
      expect.objectContaining({ operation: "page-before" }),
    ]);
    expect(result.envelope.readOnly).toEqual(expect.objectContaining({
      authority: "zero",
      submission: false,
      navigation: false,
    }));
    expect(result.envelope.metrics.wire.hiddenBackendCallCount).toBe(0);
    expect(result.envelope.companionUsage.residentEntryCount).toBeGreaterThan(0);
  });

  it("maps page-before/page-after and counts the hidden provenance probe", async () => {
    const client = createAgentViewportClient({ origin });
    const opened = await client.execute("open", {
      conversationId: "synthetic-100",
      before: 0,
      after: 0,
    });
    const cursor = opened.envelope.region.cursor;
    const paged = await client.execute("page-before", {
      conversationId: "synthetic-100",
      cursor,
      limit: 1,
    });
    expect(paged.envelope.ok).toBe(true);
    expect(paged.envelope.operation).toBe("page-before");
    expect(paged.envelope.result.entries).toBeUndefined();
    expect(paged.envelope.result.cursor).toBe(paged.envelope.region.cursor);
    expect(paged.envelope.metrics.wire.hiddenBackendCallCount).toBe(0);
    const pagedAfter = await client.execute("page-after", {
      conversationId: "synthetic-100",
      cursor: paged.envelope.region.cursor,
      limit: 1,
    });
    expect(pagedAfter.envelope.ok).toBe(true);
    expect(pagedAfter.envelope.operation).toBe("page-after");
    expect(pagedAfter.envelope.result.entries).toBeUndefined();

    const searched = await client.execute("search", {
      conversationId: "large-code",
      query: "synthetic = 41",
      limit: 1,
    });
    expect(searched.envelope.ok).toBe(true);
    expect(searched.envelope.metrics.wire.hiddenBackendCallCount).toBe(1);
    expect(searched.envelope.metrics.accounting.provenanceProbeResult).toBe("validated");
    expect(searched.envelope.source.provenance).not.toBe("UNKNOWN");
    expect(searched.envelope.expansion.affordances).toContainEqual(expect.objectContaining({
      operation: "open",
      anchorEntryId: searched.envelope.result.results[0].entryId,
      inputKind: "search-result-entry-id",
    }));
  });

  it("keeps resource and jump-back operations read-only", async () => {
    const client = createAgentViewportClient({ origin });
    const search = await client.execute("search", {
      conversationId: "large-code",
      query: "synthetic = 41",
      limit: 1,
    });
    const entryId = search.envelope.result.results[0].entryId;
    const entry = await client.execute("get-entry", {
      conversationId: "large-code",
      entryId,
    });
    expect(entry.envelope.ok).toBe(true);
    expect(entry.envelope.result.entry.id).toBe(entryId);
    expect(entry.envelope.metrics.wire.hiddenBackendCallCount).toBe(1);
    const resource = await client.execute("get-resource", {
      conversationId: "large-code",
      entryId,
      blockIndex: 0,
    });
    expect(resource.envelope.ok).toBe(true);
    expect(resource.envelope.result.block.text).toContain("synthetic = 41");
    expect(resource.envelope.metrics.wire.hiddenBackendCallCount).toBe(1);

    const jump = await client.execute("jump-back", {
      conversationId: "large-code",
      entryId,
    });
    expect(jump.envelope.ok).toBe(true);
    expect(jump.envelope.result.reference).toMatch(/^https:\/\/synthetic\.elatura\.invalid\/conversation#/u);
    expect(jump.envelope.readOnly.navigation).toBe(false);
    expect(jump.envelope.metrics.wire.hiddenBackendCallCount).toBe(1);
    const closed = await client.execute("close", { conversationId: "large-code" });
    expect(closed.envelope.ok).toBe(true);
    expect(closed.envelope.result.released).toBe(true);
    expect(closed.envelope.metrics.wire.hiddenBackendCallCount).toBe(1);
  });

  it("emits one bounded JSON envelope for CLI use and refuses bad origins", async () => {
    const help = await runViewportCli(["--help"]);
    expect(help.output).toContain("result.entryId is a search-result entry ID");
    expect(help.output).toContain("CURSOR comes only from open/page result.cursor");
    const success = await runViewportCli([
      "status",
      "--origin",
      origin,
      "--conversation",
      "synthetic-100",
    ]);
    expect(success.exitCode).toBe(0);
    expect(() => JSON.parse(success.output)).not.toThrow();
    expect(success.envelope?.source.provenance).not.toBe("UNKNOWN");

    const refusal = await runViewportCli(["status", "--origin", "http://localhost:4173"]);
    expect(refusal.exitCode).toBe(1);
    expect(JSON.parse(refusal.output)).toMatchObject({
      ok: false,
      error: { code: "origin-refused" },
      source: { identity: "UNKNOWN", provenance: "UNKNOWN", freshness: "UNKNOWN" },
    });
  });

  it("accepts operation-relative positional arguments behind a fixed conversation wrapper", async () => {
    const searched = await runViewportCli([
      "search",
      "--origin",
      origin,
      "--conversation",
      "synthetic-100",
      "user",
      "1",
    ]);
    expect(searched.exitCode).toBe(0);
    expect(searched.envelope?.operation).toBe("search");
    expect(searched.envelope?.result.results).toHaveLength(1);

    const entryId = searched.envelope?.result.results[0].entryId;
    const opened = await runViewportCli([
      "open",
      "--origin",
      origin,
      "--conversation",
      "synthetic-100",
      entryId,
      "0",
      "0",
    ]);
    expect(opened.exitCode).toBe(0);
    expect(opened.envelope?.region.entries).toHaveLength(1);
  });
});
