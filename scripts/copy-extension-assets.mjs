// SPDX-License-Identifier: MPL-2.0
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const firefoxSource = new URL("../extension/firefox/static/", import.meta.url);
const firefoxDestination = new URL("../extension/firefox/dist/", import.meta.url);

await mkdir(firefoxDestination, { recursive: true });
for (const name of ["manifest.json", "popup.html", "popup.css"]) {
  await cp(new URL(name, firefoxSource), new URL(name, firefoxDestination));
}
await rm(new URL(".DS_Store", firefoxDestination), { force: true });

const chromiumSource = new URL("../extension/chromium/static/", import.meta.url);
const chromiumDestination = new URL("../extension/chromium/dist/", import.meta.url);
await mkdir(chromiumDestination, { recursive: true });
await cp(new URL("manifest.json", chromiumSource), new URL("manifest.json", chromiumDestination));

// TypeScript compiles a source-time bridge so tests consume the reviewed core module.
// Replace that bridge with the self-contained compiled runtime module for Chrome.
const coreLaneGovernor = await readFile(
  new URL("../packages/core/dist/lane-governor.js", import.meta.url),
  "utf8",
);
if (/\bfrom\s+["']\.|\bimport\s*\(\s*["']\./u.test(coreLaneGovernor)) {
  throw new Error("Chromium lane governor runtime must remain self-contained");
}
const chromiumLaneGovernor = coreLaneGovernor.replace(
  /\n\/\/# sourceMappingURL=lane-governor\.js\.map\s*$/u,
  "\n",
);
await writeFile(new URL("lane-governor.js", chromiumDestination), chromiumLaneGovernor, "utf8");
await rm(new URL("lane-governor.js.map", chromiumDestination), { force: true });
await rm(new URL(".DS_Store", chromiumDestination), { force: true });
