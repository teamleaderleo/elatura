// SPDX-License-Identifier: MPL-2.0
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const guidance = readFileSync(resolve(ROOT, "AGENTS.md"), "utf8");
const physicalHandoff = readFileSync(
  resolve(ROOT, "docs/codex-physical-handoff.md"),
  "utf8",
);

describe("coding-agent repository guidance", () => {
  it("keeps the durable lane and authority boundaries explicit", () => {
    expect(guidance).toContain("laneRef + generation");
    expect(guidance).toContain("browser ids stay private");
    expect(guidance).toContain("grantsWorkAuthority = false");
    expect(guidance).toContain("authorizesWorkDispatch = false");
    expect(guidance).toContain("Unknown lifecycle eligibility stays conservative");
  });

  it("keeps the developer and benchmark gates explicit", () => {
    expect(guidance).toContain("npm run check:code");
    expect(guidance).toContain("npm run check");
    expect(guidance).toContain("live-lane:next");
    expect(guidance).toContain("live-lane:check");
    expect(guidance).toContain("Treat its plan/schema/protocol semantics as frozen evidence rules");
  });

  it("keeps private evidence and physical-handoff rules visible", () => {
    expect(guidance).toContain("Private content stays out of committed evidence");
    expect(guidance).toContain("stop pretending repository code can answer it");
    expect(guidance).toContain("whole-browser resource cost");
    expect(guidance).toContain("useful authenticated lane capacity");
  });

  it("keeps the first physical-stage launch checklist tied to the frozen operator gates", () => {
    expect(physicalHandoff).toContain("Run only the preregistered `chatgpt-single` resource stage first");
    expect(physicalHandoff).toContain("npm run live-lane:verify-plan");
    expect(physicalHandoff).toContain("npm run live-lane:next");
    expect(physicalHandoff).toContain("npm run live-lane:check");
    expect(physicalHandoff).toContain("npm run benchmark:chatgpt-activity");
    expect(physicalHandoff).toContain("Only accepted final run/projection pairs belong in `final/`");
    expect(physicalHandoff).toContain("Credit browser-native behavior to the browser");
    expect(physicalHandoff).toContain("Do not fabricate replacement measurements");
  });
});
