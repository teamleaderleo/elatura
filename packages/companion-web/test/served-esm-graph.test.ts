// SPDX-License-Identifier: MPL-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createLoopbackServer,
} from "../../../scripts/run-synthetic-companion-loopback.mjs";

const LOOPBACK_HOST = "127.0.0.1";
const ENTRY_ROUTE = "/app.js";
const MAX_WALKED_MODULES = 64;
const CONTROLLER_ROUTE = "/vendor/@elatura/companion-web/controller.js";
const REQUEST_ID_ROUTE = "/vendor/@elatura/companion-web/request-id.js";

let instance;
let origin;

beforeAll(async () => {
  instance = await createLoopbackServer({
    host: LOOPBACK_HOST,
    sessionToken: "served-esm-graph",
  });
  await instance.start();
  origin = instance.origin();
});

afterAll(async () => {
  if (instance) await instance.stop();
});

const CLAUSE_IMPORT_PATTERN = /import\s[^;]*?from\s*["']([^"']+)["']/g;
const REEXPORT_PATTERN = /export\s[^;]*?from\s*["']([^"']+)["']/g;
const SIDE_EFFECT_IMPORT_PATTERN = /import\s*["']([^"']+)["']/g;

/** Bounded parser for the static import/export-from syntax emitted by this
 * build only; dynamic import() and non-import strings are never edges. */
function parseStaticImportSpecifiers(source) {
  const specifiers = new Set();
  for (const pattern of [
    CLAUSE_IMPORT_PATTERN,
    REEXPORT_PATTERN,
    SIDE_EFFECT_IMPORT_PATTERN,
  ]) {
    pattern.lastIndex = 0;
    for (
      let match = pattern.exec(source);
      match !== null;
      match = pattern.exec(source)
    ) {
      specifiers.add(match[1]);
    }
  }
  return [...specifiers];
}

/** Browser module resolution: absolute same-origin routes as-is, relative
 * specifiers against the importing module path, bare specifiers through the
 * served import map. Returns null when a bare specifier is unmapped. */
function resolveSpecifier(specifier, importerRoute, importMap) {
  if (specifier.startsWith("/")) return specifier;
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const baseEnd = importerRoute.lastIndexOf("/");
    const base = importerRoute.slice(0, baseEnd);
    const resolved = [];
    for (const segment of `${base}/${specifier}`.split("/")) {
      if (segment === "" || segment === ".") continue;
      if (segment === "..") resolved.pop();
      else resolved.push(segment);
    }
    return `/${resolved.join("/")}`;
  }
  return importMap.get(specifier) ?? null;
}

/** Walks the actually served ESM graph over real HTTP from /app.js and
 * returns every visited route, every resolved edge, and a human-readable
 * list of broken routes (non-200, wrong content-type, unresolvable
 * specifier, or dynamic import outside the bounded static parser). */
async function walkServedEsmGraph() {
  const indexResponse = await fetch(`${origin}/`);
  const html = await indexResponse.text();
  const importMapMatch = html.match(
    /<script type="importmap">\s*([\s\S]*?)<\/script>/u,
  );
  expect(importMapMatch, "served index must carry the fixed import map")
    .not.toBeNull();
  const importMap = new Map(
    Object.entries(JSON.parse(importMapMatch[1]).imports),
  );

  const routes = new Map();
  const edges = [];
  const broken = [];
  const queue = [ENTRY_ROUTE];
  while (queue.length > 0) {
    if (routes.size >= MAX_WALKED_MODULES) {
      throw new Error(
        `Served ESM graph exceeded the bounded walk of ${MAX_WALKED_MODULES} modules.`,
      );
    }
    const route = queue.shift();
    if (routes.has(route)) continue;
    const response = await fetch(`${origin}${route}`);
    const body = await response.text();
    const contentType = response.headers.get("content-type") ?? "";
    routes.set(route, { status: response.status, contentType });
    if (response.status !== 200 || !contentType.includes("text/javascript")) {
      broken.push(`${route} -> ${response.status} ${contentType || "(no content-type)"}`);
      continue;
    }
    if (/import\s*\(/u.test(body)) {
      broken.push(`${route} uses dynamic import(), which the bounded static parser cannot walk`);
      continue;
    }
    for (const specifier of parseStaticImportSpecifiers(body)) {
      const resolved = resolveSpecifier(specifier, route, importMap);
      edges.push({ from: route, specifier, to: resolved });
      if (resolved === null) {
        broken.push(`${route} imports bare specifier "${specifier}" missing from the served import map`);
        continue;
      }
      if (!routes.has(resolved)) queue.push(resolved);
    }
  }
  return { routes, edges, broken };
}

describe("bounded static-import parser controls", () => {
  it("extracts clause, re-export, and side-effect static imports only", () => {
    const sample = [
      "import { A } from \"./first.js\";",
      "import {\n  B,\n} from \"/absolute/second.js\";",
      "import \"@elatura/core/companion\";",
      "export * from \"./third.js\";",
      "export { parseCompanionResponse } from \"./fourth.js\";",
      "const dynamic = await import(\"./dynamic.js\");",
      "const literal = \"not/an/import.js\";",
      'import { X } from "./fifth.js"',
    ].join("\n");
    const specifiers = parseStaticImportSpecifiers(sample);
    expect(new Set(specifiers)).toEqual(new Set([
      "./first.js",
      "/absolute/second.js",
      "@elatura/core/companion",
      "./third.js",
      "./fourth.js",
      "./fifth.js",
    ]));
    expect(specifiers).not.toContain("./dynamic.js");
    expect(specifiers).not.toContain("not/an/import.js");
  });

  it("resolves relative specifiers against the importing module path", () => {
    expect(
      resolveSpecifier(
        "./request-id.js",
        CONTROLLER_ROUTE,
        new Map(),
      ),
    ).toBe(REQUEST_ID_ROUTE);
    expect(
      resolveSpecifier("../up.js", "/vendor/@elatura/core/one/two.js", new Map()),
    ).toBe("/vendor/@elatura/core/up.js");
    expect(
      resolveSpecifier("@elatura/core/companion", ENTRY_ROUTE, new Map([
        ["@elatura/core/companion", "/vendor/@elatura/core/companion.js"],
      ])),
    ).toBe("/vendor/@elatura/core/companion.js");
    expect(resolveSpecifier("unmapped/bare.js", ENTRY_ROUTE, new Map())).toBeNull();
  });
});

describe("served ESM dependency graph regression", () => {
  it("walks every statically reachable module from /app.js and serves each with 200", async () => {
    const { routes, edges, broken } = await walkServedEsmGraph();
    expect(
      broken,
      `broken served-module routes: ${broken.length > 0 ? broken.join("; ") : "(none)"}`,
    ).toEqual([]);
    expect(routes.get(ENTRY_ROUTE)?.status).toBe(200);

    // Pinned edge: the controller -> request-id relative import that regressed
    // to 404 must be walked and served.
    expect(edges).toContainEqual({
      from: CONTROLLER_ROUTE,
      specifier: "./request-id.js",
      to: REQUEST_ID_ROUTE,
    });
    expect(routes.has(REQUEST_ID_ROUTE)).toBe(true);

    // Pinned deep chain: reachable only through the import-map bare specifier
    // followed by relative re-export resolution, so a walker that ignores
    // either mechanism cannot produce these routes.
    expect(routes.has("/vendor/@elatura/core/companion.js")).toBe(true);
    expect(edges).toContainEqual({
      from: "/vendor/@elatura/core/companion.js",
      specifier: "./companion-client.js",
      to: "/vendor/@elatura/core/companion-client.js",
    });
    expect(routes.has("/vendor/@elatura/core/companion-client.js")).toBe(true);
    expect(routes.has("/vendor/@elatura/core/resource-accounting.js")).toBe(true);
    expect(routes.has("/vendor/@elatura/companion-web/probes.js")).toBe(true);
    expect(edges).toContainEqual({
      from: "/vendor/@elatura/companion-web/probes.js",
      specifier: "./plateau.js",
      to: "/vendor/@elatura/companion-web/plateau.js",
    });
  }, 30_000);
});
