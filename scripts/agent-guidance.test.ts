// SPDX-License-Identifier: MPL-2.0
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const guidance = readFileSync(resolve(ROOT, "AGENTS.md"), "utf8");
const applicationLaneRuntime = readFileSync(
  resolve(ROOT, "docs/application-lane-runtime.md"),
  "utf8",
);
const applicationLanes = readFileSync(
  resolve(ROOT, "docs/application-lanes.md"),
  "utf8",
);
const privacy = readFileSync(resolve(ROOT, "docs/privacy.md"), "utf8");
const executionChecklist = readFileSync(
  resolve(ROOT, "docs/live-application-lane-execution-checklist.md"),
  "utf8",
);
const physicalHandoff = readFileSync(
  resolve(ROOT, "docs/codex-physical-handoff.md"),
  "utf8",
);

describe("coding-agent repository guidance", () => {
  it("keeps universal boundaries hot and routes task-specific policy", () => {
    expect(guidance).toContain("laneRef + generation");
    expect(guidance).toContain("private ephemeral projections");
    expect(guidance).toContain(
      "Observation grants neither work nor dispatch authority",
    );
    expect(guidance).toContain("Stensibly owns scheduling");
    expect(guidance).toContain("lifecycle eligibility conservatively");
    expect(guidance).toContain("docs/application-lane-runtime.md");
    expect(guidance).toContain("docs/privacy.md");
    expect(guidance).toContain("docs/codex-physical-handoff.md");
    expect(guidance).toContain("Query the owning issue/current repository state");
  });

  it("keeps detailed authority and privacy policy in routed owners", () => {
    expect(applicationLaneRuntime).toContain("zero-work-authority fence");
    expect(applicationLaneRuntime).toContain(
      "Old-generation events increment a content-free stale-event counter",
    );
    expect(applicationLaneRuntime).toContain(
      "Stensibly** — work authority, scheduling, dispatch",
    );
    expect(applicationLanes).toContain(
      "Elatura does not inherit mission, ownership, scheduling, or dispatch authority",
    );
    expect(applicationLanes).toContain(
      "unknown application state continue to block aggressive reclamation",
    );
    expect(privacy).toContain(
      "no cookies, authorization headers, or session tokens in logs",
    );
    expect(privacy).toContain("no response bodies or message text in benchmark reports");
  });

  it("keeps developer commands hot and benchmark procedure cold", () => {
    expect(guidance).toContain("npm run check:code");
    expect(guidance).toContain("npm run check");
    expect(physicalHandoff).toContain("npm run live-lane:next");
    expect(physicalHandoff).toContain("`live-lane:check` remains the final evidence authority");
    expect(executionChecklist).toContain(
      "The four resource stages are independent evidence gates",
    );
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
