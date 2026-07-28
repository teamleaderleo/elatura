// SPDX-License-Identifier: MPL-2.0
import { cp, mkdir, rm } from "node:fs/promises";

const source = new URL("../extension/firefox/static/", import.meta.url);
const destination = new URL("../extension/firefox/dist/", import.meta.url);

await mkdir(destination, { recursive: true });
for (const name of ["manifest.json", "popup.html", "popup.css"]) {
  await cp(new URL(name, source), new URL(name, destination));
}

// TypeScript may preserve stale maps when files are removed between builds.
await rm(new URL(".DS_Store", destination), { force: true });
