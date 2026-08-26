// SPDX-License-Identifier: MPL-2.0
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const admission = fileURLToPath(
  new URL("./validate-live-application-lane-artifacts.mjs", import.meta.url),
);
const readiness = fileURLToPath(
  new URL("./check-live-application-lane-session.mjs", import.meta.url),
);

function run(script, args, options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    ...options,
  });
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  const result = run(readiness, args, { stdio: "inherit" });
  process.exitCode = result.status ?? 2;
} else if (args.length < 2) {
  const result = run(readiness, args, { stdio: "inherit" });
  process.exitCode = result.status ?? 2;
} else {
  const admitted = run(admission, args.slice(0, 2));
  if (admitted.status !== 0) {
    if (admitted.stdout) process.stdout.write(admitted.stdout);
    if (admitted.stderr) process.stderr.write(admitted.stderr);
    process.exitCode = admitted.status ?? 2;
  } else {
    const checked = run(readiness, args, { stdio: "inherit" });
    process.exitCode = checked.status ?? 2;
  }
}
