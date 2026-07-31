// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  MAX_SLIM_TURN_GROUPS,
  planSlimWindow,
  revealPreviousTurnGroups,
  type SlimTurnDescriptor,
} from "../src/slim-window.js";

function pair(group: number, streaming = false): SlimTurnDescriptor[] {
  return [
    {
      id: `turn-${group}-user`,
      groupKey: `group-${group}`,
      streaming: false,
      estimatedBlockSizePx: 120,
    },
    {
      id: `turn-${group}-assistant`,
      groupKey: `group-${group}`,
      streaming,
      estimatedBlockSizePx: 280,
    },
  ];
}

describe("slim turn-window planner", () => {
  it("retains the latest three complete user/assistant pairs", () => {
    const turns = [pair(1), pair(2), pair(3), pair(4), pair(5)].flat();
    const result = planSlimWindow(turns, "latest-window", 3);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.retainedGroupKeys).toEqual(["group-3", "group-4", "group-5"]);
    expect(result.value.retainedTurnIds).toEqual([
      "turn-3-user",
      "turn-3-assistant",
      "turn-4-user",
      "turn-4-assistant",
      "turn-5-user",
      "turn-5-assistant",
    ]);
    expect(result.value.mountedTurnCountBefore).toBe(10);
    expect(result.value.mountedTurnCountAfter).toBe(6);
  });

  it("retains a streaming group even when it falls outside the latest window", () => {
    const turns = [pair(1, true), pair(2), pair(3), pair(4), pair(5)].flat();
    const result = planSlimWindow(turns, "latest-window", 2);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.retainedGroupKeys).toEqual(["group-1", "group-4", "group-5"]);
    expect(result.value.retainedTurnIds).toContain("turn-1-user");
    expect(result.value.retainedTurnIds).toContain("turn-1-assistant");
  });

  it("creates bounded contiguous placeholder ranges without retaining turn objects", () => {
    const turns = [pair(1), pair(2), pair(3), pair(4)].flat();
    const result = planSlimWindow(turns, "latest-window", 1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.removalRanges).toEqual([
      {
        id: "range:turn-1-user:turn-3-assistant",
        turnIds: [
          "turn-1-user",
          "turn-1-assistant",
          "turn-2-user",
          "turn-2-assistant",
          "turn-3-user",
          "turn-3-assistant",
        ],
        estimatedBlockSizePx: 1200,
        insertBeforeId: "turn-4-user",
      },
    ]);
  });

  it("keeps render suppression separate from mounted-turn reduction", () => {
    const turns = [pair(1), pair(2), pair(3), pair(4)].flat();
    const result = planSlimWindow(turns, "render-suppressed", 2);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.suppressedTurnIds).toEqual([
      "turn-1-user",
      "turn-1-assistant",
      "turn-2-user",
      "turn-2-assistant",
    ]);
    expect(result.value.removalRanges).toEqual([]);
    expect(result.value.mountedTurnCountAfter).toBe(turns.length);
  });

  it("makes stock mode a complete no-op plan", () => {
    const turns = [pair(1), pair(2)].flat();
    const result = planSlimWindow(turns, "stock", 3);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.retainedTurnIds).toEqual(turns.map((turn) => turn.id));
    expect(result.value.suppressedTurnIds).toEqual([]);
    expect(result.value.removalRanges).toEqual([]);
    expect(result.value.mountedTurnCountAfter).toBe(turns.length);
  });

  it("fails closed on ambiguous noncontiguous grouping", () => {
    const turns: SlimTurnDescriptor[] = [
      { id: "turn-a", groupKey: "group-1", streaming: false, estimatedBlockSizePx: 10 },
      { id: "turn-b", groupKey: "group-2", streaming: false, estimatedBlockSizePx: 10 },
      { id: "turn-c", groupKey: "group-1", streaming: false, estimatedBlockSizePx: 10 },
    ];
    const result = planSlimWindow(turns, "latest-window", 1);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.code)).toContain("noncontiguous-group");
  });

  it("rejects invalid counts and empty non-stock inputs", () => {
    expect(planSlimWindow([], "latest-window", 3)).toMatchObject({
      ok: false,
      issues: [{ code: "no-turns" }],
    });
    expect(planSlimWindow(pair(1), "render-suppressed", 0)).toMatchObject({
      ok: false,
      issues: [{ code: "invalid-turn-groups" }],
    });
    expect(planSlimWindow(pair(1), "render-suppressed", MAX_SLIM_TURN_GROUPS + 1)).toMatchObject({
      ok: false,
      issues: [{ code: "invalid-turn-groups" }],
    });
  });

  it("bounds reveal expansion at the hard maximum", () => {
    expect(revealPreviousTurnGroups(3)).toBe(6);
    expect(revealPreviousTurnGroups(7)).toBe(MAX_SLIM_TURN_GROUPS);
    expect(revealPreviousTurnGroups(Number.NaN, 2)).toBe(5);
  });
});
