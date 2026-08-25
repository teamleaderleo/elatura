// SPDX-License-Identifier: MPL-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { request as httpRequest } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_BIND_HOSTS,
  PROTOCOL_PATH,
  RefusedBindingError,
  SCENARIO_IDS,
  createLoopbackServer,
  isLoopbackRemoteAddress,
} from "../../../scripts/run-synthetic-companion-loopback.mjs";
import { CompanionWebController } from "../src/controller.js";
import {
  HttpCompanionTransport,
} from "../src/http-companion-transport.js";
import { BoundedBrowserRequestLedger } from "../src/browser-request-ledger.js";

const LOOPBACK_HOST = "127.0.0.1";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SCENARIOS = ["synthetic-100", "large-code", "stale-source", "expired-source", "corrupt-source"];

let instance;
let origin;

beforeAll(async () => {
  instance = await createLoopbackServer({
    host: LOOPBACK_HOST,
    scenarioIds: SCENARIOS,
    sessionToken: "surface-integration",
  });
  await instance.start();
  origin = instance.origin();
});

afterAll(async () => {
  if (instance) await instance.stop();
});

/** Raw request with explicit hostile headers; resolves {status, headers, body}. */
function rawRequest(path, { method = "GET", headers = {}, body = null } = {}) {
  return new Promise((resolveRequest, rejectRequest) => {
    const finalHeaders = { ...headers };
    if (body !== null && finalHeaders["content-length"] === undefined) {
      finalHeaders["content-length"] = String(Buffer.byteLength(body));
    }
    const request = httpRequest(
      `${origin}${path}`,
      { method, headers: finalHeaders },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolveRequest({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    request.on("error", rejectRequest);
    if (body !== null) request.write(body);
    request.end();
  });
}

async function protocolPost(body, extraHeaders = {}) {
  const response = await rawRequest(PROTOCOL_PATH, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      ...extraHeaders,
    },
    body,
  });
  return {
    status: response.status,
    json: JSON.parse(response.body.toString("utf8")),
    bytes: response.body.length,
  };
}

describe("loopback binding refusals", () => {
  it("permits only the two loopback literals", () => {
    expect([...ALLOWED_BIND_HOSTS]).toEqual(["127.0.0.1", "::1"]);
  });

  it("refuses LAN, wildcard, and hostname bind targets before listening", async () => {
    for (const hostile of ["0.0.0.0", "::", "localhost", "192.168.1.50", "10.0.0.7", "example.test"]) {
      await expect(
        createLoopbackServer({ host: hostile }),
      ).rejects.toBeInstanceOf(RefusedBindingError);
    }
  });

  it("classifies remote addresses with an exact loopback allowlist", () => {
    expect(isLoopbackRemoteAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackRemoteAddress("::1")).toBe(true);
    expect(isLoopbackRemoteAddress("::ffff:127.0.0.1")).toBe(true);
    for (const hostile of [
      "127.0.0.2",
      "::2",
      "192.168.0.10",
      "10.1.2.3",
      "172.16.5.5",
      "fd00::1",
      "",
      undefined,
      null,
      42,
    ]) {
      expect(isLoopbackRemoteAddress(hostile)).toBe(false);
    }
  });
});

describe("static surface serving", () => {
  it("serves the index with hardened fixed headers", async () => {
    const response = await fetch(`${origin}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toMatch(/https?:\/\//u);
    const html = await response.text();
    expect(html).toContain('src="/app.js"');
    expect(html).not.toMatch(/https?:\/\/(?!synthetic\.elatura\.invalid)/u);
  });

  it("serves byte-identical repository assets deterministically", async () => {
    const [first, second] = await Promise.all([
      fetch(`${origin}/app.js`).then((response) => response.arrayBuffer()),
      fetch(`${origin}/app.js`).then((response) => response.arrayBuffer()),
    ]);
    expect(Buffer.compare(Buffer.from(first), Buffer.from(second))).toBe(0);
    const repoAsset = await readFile(
      resolve(REPO_ROOT, "packages/companion-web/browser/app.js"),
    );
    expect(Buffer.from(first).equals(repoAsset)).toBe(true);

    const vendor = await fetch(
      `${origin}/vendor/@elatura/core/companion.js`,
    );
    expect(vendor.status).toBe(200);
    expect(vendor.headers.get("content-type")).toContain("text/javascript");
  });

  it("keeps every served asset free of remote URL literals", async () => {
    for (const path of ["/", "/app.css", "/app.js", "/vendor/@elatura/core/companion.js", "/vendor/@elatura/companion-web/controller.js"]) {
      const text = await fetch(`${origin}${path}`).then((response) => response.text());
      expect(text, path).not.toMatch(/https?:\/\//u);
    }
  });

  it("answers HEAD without a body but with the true content length", async () => {
    const response = await rawRequest("/app.css", { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(Number(response.headers["content-length"])).toBeGreaterThan(0);
    expect(response.body.length).toBe(0);
  });

  it("refuses unknown paths, traversal, query strings, and wrong methods", async () => {
    expect((await rawRequest("/definitely-not-here")).status).toBe(404);
    expect((await rawRequest("/../package.json")).status).toBe(404);
    expect((await rawRequest("/app.css?cachebust=1")).status).toBe(404);
    expect((await rawRequest("/", { method: "DELETE" })).status).toBe(405);
    expect((await rawRequest("/app.js", { method: "POST", headers: { origin }, body: "{}" })).status).toBe(405);
    expect((await rawRequest(PROTOCOL_PATH, { method: "GET" })).status).toBe(405);
    expect((await rawRequest("/vendor/@elatura/core/index.js")).status).toBe(404);
  });

  it("refuses cross-site fetch metadata and hostile Host headers", async () => {
    expect(
      (
        await rawRequest("/", {
          headers: { "sec-fetch-site": "cross-site" },
        })
      ).status,
    ).toBe(403);

    const hostileHost = await new Promise((resolveRequest, rejectRequest) => {
      const port = Number(origin.split(":").pop());
      const request = httpRequest(
        {
          host: LOOPBACK_HOST,
          port,
          path: "/",
          method: "GET",
          headers: { host: "attacker.example:4173" },
        },
        (response) => {
          response.resume();
          response.on("end", () => resolveRequest(response.statusCode));
        },
      );
      request.on("error", rejectRequest);
      request.end();
    });
    expect(hostileHost).toBe(421);
  });
});

describe("protocol endpoint security", () => {
  it("exposes only the bounded session descriptor", async () => {
    const response = await fetch(`${origin}/companion/v1/session`);
    const info = await response.json();
    expect(info).toEqual({ protocolVersion: 1, sessionId: "surface-integration" });
  });

  it("requires the exact loopback origin and JSON content type on POST", async () => {
    const missingOrigin = await rawRequest(PROTOCOL_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(missingOrigin.status).toBe(403);

    const foreignOrigin = await rawRequest(PROTOCOL_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://attacker.example",
      },
      body: "{}",
    });
    expect(foreignOrigin.status).toBe(403);

    const wrongType = await rawRequest(PROTOCOL_PATH, {
      method: "POST",
      headers: { "content-type": "text/plain", origin },
      body: "{}",
    });
    expect(wrongType.status).toBe(415);
  });

  it("refuses oversized and chunked bodies with fixed codes", async () => {
    const oversizedDeclared = await rawRequest(PROTOCOL_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        "content-length": String(65_537),
      },
      body: "x".repeat(65_600),
    });
    expect([413, 400]).toContain(oversizedDeclared.status);

    const chunked = await new Promise((resolveRequest) => {
      const port = Number(origin.split(":").pop());
      const request = httpRequest(
        {
          host: LOOPBACK_HOST,
          port,
          path: PROTOCOL_PATH,
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin,
            "transfer-encoding": "chunked",
          },
        },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () =>
            resolveRequest({
              status: response.statusCode,
              body: Buffer.concat(chunks).toString("utf8"),
            }),
          );
        },
      );
      request.end("{}");
    });
    expect(chunked.status).toBe(400);
    expect(JSON.parse(chunked.body).refused).toBe("body-not-allowed");
  });

  it("reduces malformed bodies to one fixed invalid-request envelope", async () => {
    const malformed = await protocolPost("{not-json", {});
    expect(malformed.status).toBe(200);
    expect(malformed.json.ok).toBe(false);
    expect(malformed.json.errorCode).toBe("invalid-request");

    const hostile = await protocolPost(
      JSON.stringify({ version: 2, sessionId: "x", requestId: "r", operation: "close", payload: {} }),
      {},
    );
    expect(hostile.json.errorCode).toBe("invalid-request");
  });

  it("returns the bounded session-mismatch envelope for foreign sessions", async () => {
    const response = await protocolPost(
      JSON.stringify({
        version: 1,
        sessionId: "some-other-session",
        requestId: "mismatch-1",
        operation: "list",
        payload: { cursor: null, limit: 5 },
      }),
      {},
    );
    expect(response.json.ok).toBe(false);
    expect(response.json.errorCode).toBe("session-mismatch");
  });
});

describe("full-stack controller over the loopback transport", () => {
  /** Each full-stack probe gets its own companion so revoke in one probe
   * cannot poison another; the runtime revokes the whole shared session. */
  async function startIsolatedServer(sessionToken) {
    const isolated = await createLoopbackServer({
      host: LOOPBACK_HOST,
      scenarioIds: SCENARIOS,
      sessionToken,
    });
    await isolated.start();
    return isolated;
  }

  function browserController(isolated) {
    const ledger = new BoundedBrowserRequestLedger();
    const transport = new HttpCompanionTransport({
      origin: isolated.origin(),
      ledger,
      post: async (url, body, signal) => {
        const response = await fetch(url, {
          body,
          cache: "no-store",
          credentials: "omit",
          headers: { "content-type": "application/json", origin: isolated.origin() },
          method: "POST",
          signal,
        });
        return response.text();
      },
    });
    const controller = new CompanionWebController({
      sessionId: isolated.sessionId,
      transport,
    });
    return { controller, ledger };
  }

  it("drives list/open/page/search/navigate/code/close through real HTTP", async () => {
    const isolated = await startIsolatedServer("surface-fullstack");
    try {
    const { controller, ledger } = browserController(isolated);
    const origin2 = isolated.origin;

    const listed = await controller.list(null, 100);
    expect(listed.outcome).toBe("applied");
    const ids = controller.snapshot.client.conversations.map((item) => item.id);
    for (const scenario of SCENARIOS) expect(ids).toContain(scenario);

    expect((await controller.open("synthetic-100")).outcome).toBe("applied");
    expect(controller.snapshot.client.page?.conversationId).toBe("synthetic-100");

    const cursor = controller.snapshot.client.page?.cursor ?? "";
    expect(
      (await controller.page("synthetic-100", cursor, "before")).outcome,
    ).toBe("applied");

    const searched = await controller.search("synthetic-100", "message", 5);
    expect(searched.outcome).toBe("applied");
    expect(controller.snapshot.client.searchResults.length).toBeLessThanOrEqual(5);

    const firstEntry = controller.snapshot.client.page?.entries[0]?.id ?? "";
    const navigated = await controller.navigate("synthetic-100", firstEntry);
    expect(navigated.outcome).toBe("applied");
    expect(controller.snapshot.render.navigation?.entryId).toBe(firstEntry);
    expect(controller.snapshot.render.navigation?.activePath.length).toBeGreaterThan(0);

    // Code lives in large-code; open it explicitly and pull exactly one block.
    expect((await controller.open("large-code")).outcome).toBe("applied");
    const block = controller.snapshot.client.page?.entries.find(
      (entry) => entry.codeBlockCount > 0,
    );
    expect(block?.id).toBeTruthy();
    const codeResult = await controller.code("large-code", block!.id, 0);
    expect(codeResult.outcome).toBe("applied");
    expect(controller.snapshot.client.code?.blockIndex).toBe(0);
    expect(controller.workingSetSnapshot.renderMountedCodeTextCodeUnits).toBeGreaterThan(0);

    const closed = await controller.close("large-code");
    expect(closed.outcome).toBe("applied");
    expect(controller.workingSetSnapshot.renderMountedCodeTextCodeUnits).toBe(0);

    const revoked = await controller.revoke();
    expect(revoked.outcome).toBe("applied");
    expect(controller.workingSetSnapshot.renderMountedTimelineRowCount).toBe(0);
    expect(controller.workingSetSnapshot.renderMountedSearchResultCount).toBe(0);
    expect(controller.snapshot.render.navigation).toBeNull();
    expect(revoked.usage?.residentRecordCount).toBe(0);

    const ledgerSnapshot = ledger.snapshot;
    expect(ledgerSnapshot.dispatchedRequestCount).toBeGreaterThan(6);
    expect(ledgerSnapshot.cacheEntryCount).toBeLessThanOrEqual(64);
    expect(ledgerSnapshot.failedRequestCount + ledgerSnapshot.cancelledRequestCount).toBe(0);
    void origin2;
    } finally {
      await isolated.stop();
    }
  }, 60_000);

  it("surfaces expired, corrupt, and drifted states as visible diagnostics", async () => {
    const isolated = await startIsolatedServer("surface-diagnostics");
    try {
    const { controller } = browserController(isolated);

    await controller.list(null, 100);
    const byId = new Map(
      controller.snapshot.client.conversations.map((item) => [item.id, item]),
    );
    expect(byId.get("stale-source")?.freshness).toBe("stale");
    expect(byId.get("expired-source")?.freshness).toBe("expired");
    expect(byId.get("corrupt-source")?.freshness).toBe("corrupt");

    const expiredOpen = await controller.open("expired-source");
    expect(expiredOpen.outcome).toBe("applied");
    expect(controller.snapshot.client.lastError).toBe("conversation-expired");

    const corruptOpen = await controller.open("corrupt-source");
    expect(corruptOpen.outcome).toBe("applied");
    expect(controller.snapshot.client.lastError).toBe("conversation-corrupt");
    expect(controller.workingSetSnapshot.renderMountedTimelineRowCount).toBe(0);
    } finally {
      await isolated.stop();
    }
  }, 60_000);
});

describe("scenario registry guards", () => {
  it("refuses unknown scenarios and drifted combinations", async () => {
    expect(SCENARIO_IDS).toContain("synthetic-100000");
    await expect(
      createLoopbackServer({
        host: LOOPBACK_HOST,
        scenarioIds: ["no-such-scenario"],
      }),
    ).rejects.toThrow(/Unknown scenario ids/u);
    await expect(
      createLoopbackServer({
        host: LOOPBACK_HOST,
        scenarioIds: ["drifted-source", "synthetic-100"],
      }),
    ).rejects.toThrow(/cannot be combined/u);
  });
});
