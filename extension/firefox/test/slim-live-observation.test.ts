// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { planSlimWindow } from "../src/slim-window.js";
import {
  buildSlimLiveObservation,
  driftReasonForSlimObservation,
} from "../src/slim-live-observation.js";
import {
  ambiguousRoleLayout,
  duplicateContainerIdLayout,
  ignoredMarkerLayout,
  markerCountMismatchLayout,
  missingParentLayout,
  ordinaryFivePairLayout,
  outOfOrderLayout,
  providerNoiseLayout,
  splitParentLayout,
  streamingLayout,
} from "./fixtures/slim-live-layouts.js";

describe("provider-free slim live observations", () => {
  it("feeds an ordinary five-pair layout into the latest-three planner", () => {
    const observed = buildSlimLiveObservation(
      ordinaryFivePairLayout.roleMarkerCount,
      ordinaryFivePairLayout.containers,
    );

    expect(observed.ok).toBe(true);
    if (!observed.ok) return;
    const plan = planSlimWindow(observed.turns, "latest-window", 3);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.retainedGroupKeys).toEqual(["group-3", "group-4", "group-5"]);
    expect(plan.value.retainedTurnIds).toEqual([
      "turn-5",
      "turn-6",
      "turn-7",
      "turn-8",
      "turn-9",
      "turn-10",
    ]);
    expect(plan.value.removalRanges).toHaveLength(1);
    expect(plan.value.removalRanges[0]?.turnIds).toEqual([
      "turn-1",
      "turn-2",
      "turn-3",
      "turn-4",
    ]);
  });

  it("retains the active streaming group", () => {
    const observed = buildSlimLiveObservation(
      streamingLayout.roleMarkerCount,
      streamingLayout.containers,
    );

    expect(observed.ok).toBe(true);
    if (!observed.ok) return;
    expect(observed.turns.at(-1)?.streaming).toBe(true);
    const plan = planSlimWindow(observed.turns, "latest-window", 1);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.retainedGroupKeys).toEqual(["group-3"]);
    expect(plan.value.retainedTurnIds).toEqual(["turn-5", "turn-6"]);
  });

  it("normalizes provider role noise before planning", () => {
    const observed = buildSlimLiveObservation(
      providerNoiseLayout.roleMarkerCount,
      providerNoiseLayout.containers,
    );

    expect(observed.ok).toBe(true);
    if (!observed.ok) return;
    expect(observed.turns.map((turn) => turn.role)).toEqual([
      "system",
      "user",
      "unknown",
      "assistant",
    ]);
    expect(observed.turns.map((turn) => turn.groupKey)).toEqual([
      "group-0",
      "group-1",
      "group-1",
      "group-1",
    ]);
  });

  it("allows bounded role markers outside recognized turn containers", () => {
    const observed = buildSlimLiveObservation(
      ignoredMarkerLayout.roleMarkerCount,
      ignoredMarkerLayout.containers,
    );

    expect(observed.ok).toBe(true);
    if (!observed.ok) return;
    expect(observed.turns).toHaveLength(4);
  });

  it("rejects ambiguous, split-parent, out-of-order, and missing-parent layouts", () => {
    expect(
      buildSlimLiveObservation(
        ambiguousRoleLayout.roleMarkerCount,
        ambiguousRoleLayout.containers,
      ),
    ).toEqual({ ok: false, reason: "ambiguous-role-markers" });
    expect(
      buildSlimLiveObservation(splitParentLayout.roleMarkerCount, splitParentLayout.containers),
    ).toEqual({ ok: false, reason: "turn-parent-mismatch" });
    expect(
      buildSlimLiveObservation(outOfOrderLayout.roleMarkerCount, outOfOrderLayout.containers),
    ).toEqual({ ok: false, reason: "turn-order-ambiguous" });
    expect(
      buildSlimLiveObservation(missingParentLayout.roleMarkerCount, missingParentLayout.containers),
    ).toEqual({ ok: false, reason: "turn-parent-missing" });
  });

  it("rejects malformed fixture identity and marker accounting", () => {
    expect(
      buildSlimLiveObservation(
        duplicateContainerIdLayout.roleMarkerCount,
        duplicateContainerIdLayout.containers,
      ),
    ).toEqual({ ok: false, reason: "duplicate-container-id" });
    expect(
      buildSlimLiveObservation(
        markerCountMismatchLayout.roleMarkerCount,
        markerCountMismatchLayout.containers,
      ),
    ).toEqual({ ok: false, reason: "marker-count-mismatch" });
    expect(buildSlimLiveObservation(Number.NaN, ordinaryFivePairLayout.containers)).toEqual({
      ok: false,
      reason: "invalid-marker-count",
    });
  });

  it("maps fixture-only failures into the bounded drift vocabulary", () => {
    expect(driftReasonForSlimObservation("ambiguous-role-markers")).toBe("invalid-role");
    expect(driftReasonForSlimObservation("turn-parent-missing")).toBe("turn-parent-mismatch");
    expect(driftReasonForSlimObservation("duplicate-container-id")).toBe(
      "invalid-candidate-id",
    );
    expect(driftReasonForSlimObservation("marker-count-mismatch")).toBe(
      "invalid-candidate-id",
    );
  });
});
