// SPDX-License-Identifier: MPL-2.0
import { cp, mkdir, rm } from "node:fs/promises";

const firefoxSource = new URL("../extension/firefox/static/", import.meta.url);
const firefoxDestination = new URL("../extension/firefox/dist/", import.meta.url);

await mkdir(firefoxDestination, { recursive: true });
for (const name of ["manifest.json", "popup.html", "popup.css"]) {
  await cp(new URL(name, firefoxSource), new URL(name, firefoxDestination));
}

// TypeScript may preserve stale maps when files are removed between builds.
await rm(new URL(".DS_Store", firefoxDestination), { force: true });

const chromiumSource = new URL("../extension/chromium/static/", import.meta.url);
const chromiumDestination = new URL("../extension/chromium/dist/", import.meta.url);
const chromiumVendor = new URL("vendor/", chromiumDestination);

await mkdir(chromiumDestination, { recursive: true });
for (const name of ["manifest.json", "background.js", "popup.html", "popup.js", "popup.css"]) {
  await cp(new URL(name, chromiumSource), new URL(name, chromiumDestination));
}
await mkdir(chromiumVendor, { recursive: true });
await cp(
  new URL("../packages/core/dist/lane-governor.js", import.meta.url),
  new URL("lane-governor.js", chromiumVendor),
);
await rm(new URL(".DS_Store", chromiumDestination), { force: true });
