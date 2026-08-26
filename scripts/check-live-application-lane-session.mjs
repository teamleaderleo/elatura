// SPDX-License-Identifier: MPL-2.0
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const admission = fileURLToPath(
  new URL("./validate-live-application-lane-artifacts.mjs", import.meta.url),
);
const timing = fileURLToPath(
  new URL("./validate-live-application-lane-timing.mjs", import.meta.url),
);
const semantic = fileURLToPath(
  new URL("./check-live-application-lane-session-semantic.mjs", import.meta.url),
);

function run(script, args, options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    ...options,
  });
}

function forward(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.status ?? 2;
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h") || args.length < 2) {
  const result = run(semantic, args, { stdio: "inherit" });
  process.exitCode = result.status ?? 2;
} else {
  const admitted = run(admission, args.slice(0, 2));
  if (admitted.status !== 0) {
    forward(admitted);
  } else {
    const timed = run(timing, args);
    if (timed.status !== 0) {
      forward(timed);
    } else {
      const checked = run(semantic, args, { stdio: "inherit" });
      process.exitCode = checked.status ?? 2;
    }
  }
}
