// SPDX-License-Identifier: MPL-2.0

export const DEFAULT_SLIM_TURN_GROUPS = 3;
export const MAX_SLIM_TURN_GROUPS = 8;
export const MAX_SLIM_TURN_DESCRIPTORS = 10_000;
const MAX_DESCRIPTOR_TOKEN_LENGTH = 128;
const MAX_TURN_BLOCK_SIZE_PX = 1_000_000;
const MAX_PLACEHOLDER_BLOCK_SIZE_PX = 8_000_000;
const TOKEN_PATTERN = /^[a-z0-9:_-]+$/i;

export type SlimMode = "stock" | "render-suppressed" | "latest-window";

export type SlimTurnDescriptor = {
  id: string;
  groupKey: string;
  streaming: boolean;
  estimatedBlockSizePx: number;
};

export type SlimPlaceholderPlan = {
  id: string;
  turnIds: string[];
  estimatedBlockSizePx: number;
  insertBeforeId: string | null;
};

export type SlimWindowPlan = {
  mode: SlimMode;
  requestedTurnGroups: number;
  retainedGroupKeys: string[];
  retainedTurnIds: string[];
  suppressedTurnIds: string[];
  removalRanges: SlimPlaceholderPlan[];
  mountedTurnCountBefore: number;
  mountedTurnCountAfter: number;
};

export type SlimWindowIssue = {
  path: string;
  code: string;
  message: string;
};

export type SlimWindowPlanResult =
  | { ok: true; value: SlimWindowPlan; warnings: SlimWindowIssue[] }
  | { ok: false; issues: SlimWindowIssue[] };

function validToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_DESCRIPTOR_TOKEN_LENGTH &&
    TOKEN_PATTERN.test(value)
  );
}

function validMode(value: unknown): value is SlimMode {
  return value === "stock" || value === "render-suppressed" || value === "latest-window";
}

function validateTurnGroups(value: number): SlimWindowIssue | null {
  if (!Number.isInteger(value) || value < 1 || value > MAX_SLIM_TURN_GROUPS) {
    return {
      path: "$.turnGroups",
      code: "invalid-turn-groups",
      message: `turnGroups must be an integer from 1 through ${MAX_SLIM_TURN_GROUPS}.`,
    };
  }
  return null;
}

function validateDescriptors(turns: readonly SlimTurnDescriptor[]): SlimWindowIssue[] {
  if (turns.length > MAX_SLIM_TURN_DESCRIPTORS) {
    return [
      {
        path: "$.turns",
        code: "turn-budget-exceeded",
        message: `The turn list exceeds the ${MAX_SLIM_TURN_DESCRIPTORS} descriptor budget.`,
      },
    ];
  }

  const issues: SlimWindowIssue[] = [];
  const ids = new Set<string>();
  const closedGroups = new Set<string>();
  let activeGroup: string | null = null;

  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index];
    const path = `$.turns[${index}]`;
    if (!turn || typeof turn !== "object") {
      issues.push({ path, code: "invalid-turn", message: "Expected a turn descriptor." });
      continue;
    }
    if (!validToken(turn.id)) {
      issues.push({
        path: `${path}.id`,
        code: "invalid-turn-id",
        message: "Turn ids must be bounded opaque tokens.",
      });
    } else if (ids.has(turn.id)) {
      issues.push({
        path: `${path}.id`,
        code: "duplicate-turn-id",
        message: "Turn ids must be unique.",
      });
    } else {
      ids.add(turn.id);
    }

    if (!validToken(turn.groupKey)) {
      issues.push({
        path: `${path}.groupKey`,
        code: "invalid-group-key",
        message: "Group keys must be bounded opaque tokens.",
      });
    } else if (turn.groupKey !== activeGroup) {
      if (activeGroup !== null) closedGroups.add(activeGroup);
      if (closedGroups.has(turn.groupKey)) {
        issues.push({
          path: `${path}.groupKey`,
          code: "noncontiguous-group",
          message: "A turn group may appear only in one contiguous range.",
        });
      }
      activeGroup = turn.groupKey;
    }

    if (typeof turn.streaming !== "boolean") {
      issues.push({
        path: `${path}.streaming`,
        code: "invalid-streaming-flag",
        message: "streaming must be boolean.",
      });
    }
    if (
      !Number.isFinite(turn.estimatedBlockSizePx) ||
      turn.estimatedBlockSizePx < 0 ||
      turn.estimatedBlockSizePx > MAX_TURN_BLOCK_SIZE_PX
    ) {
      issues.push({
        path: `${path}.estimatedBlockSizePx`,
        code: "invalid-block-size",
        message: `estimatedBlockSizePx must be finite and between 0 and ${MAX_TURN_BLOCK_SIZE_PX}.`,
      });
    }
  }

  return issues;
}

function boundedPlaceholderSize(turns: readonly SlimTurnDescriptor[]): number {
  let total = 0;
  for (const turn of turns) {
    total = Math.min(
      MAX_PLACEHOLDER_BLOCK_SIZE_PX,
      total + Math.max(1, Math.round(turn.estimatedBlockSizePx)),
    );
  }
  return total;
}

function buildRemovalRanges(
  turns: readonly SlimTurnDescriptor[],
  retainedIds: ReadonlySet<string>,
): SlimPlaceholderPlan[] {
  const ranges: SlimPlaceholderPlan[] = [];
  let range: SlimTurnDescriptor[] = [];

  const flush = (insertBeforeId: string | null): void => {
    if (range.length === 0) return;
    const first = range[0];
    const last = range.at(-1);
    if (!first || !last) return;
    ranges.push({
      id: `range:${first.id}:${last.id}`,
      turnIds: range.map((turn) => turn.id),
      estimatedBlockSizePx: boundedPlaceholderSize(range),
      insertBeforeId,
    });
    range = [];
  };

  for (const turn of turns) {
    if (retainedIds.has(turn.id)) {
      flush(turn.id);
    } else {
      range.push(turn);
    }
  }
  flush(null);
  return ranges;
}

export function planSlimWindow(
  turns: readonly SlimTurnDescriptor[],
  mode: SlimMode,
  turnGroups = DEFAULT_SLIM_TURN_GROUPS,
): SlimWindowPlanResult {
  if (!validMode(mode)) {
    return {
      ok: false,
      issues: [{ path: "$.mode", code: "invalid-mode", message: "Unknown slim mode." }],
    };
  }
  const groupIssue = validateTurnGroups(turnGroups);
  if (groupIssue) return { ok: false, issues: [groupIssue] };
  const descriptorIssues = validateDescriptors(turns);
  if (descriptorIssues.length > 0) return { ok: false, issues: descriptorIssues };
  if (mode !== "stock" && turns.length === 0) {
    return {
      ok: false,
      issues: [
        {
          path: "$.turns",
          code: "no-turns",
          message: "A non-stock mode requires at least one discovered turn.",
        },
      ],
    };
  }

  const groupOrder: string[] = [];
  const streamingGroups = new Set<string>();
  for (const turn of turns) {
    if (groupOrder.at(-1) !== turn.groupKey) groupOrder.push(turn.groupKey);
    if (turn.streaming) streamingGroups.add(turn.groupKey);
  }

  const retainedGroups = new Set(groupOrder.slice(-turnGroups));
  streamingGroups.forEach((groupKey) => retainedGroups.add(groupKey));
  const retainedTurnIds =
    mode === "stock"
      ? turns.map((turn) => turn.id)
      : turns.filter((turn) => retainedGroups.has(turn.groupKey)).map((turn) => turn.id);
  const retainedIds = new Set(retainedTurnIds);
  const suppressedTurnIds =
    mode === "stock" ? [] : turns.filter((turn) => !retainedIds.has(turn.id)).map((turn) => turn.id);
  const removalRanges = mode === "latest-window" ? buildRemovalRanges(turns, retainedIds) : [];

  return {
    ok: true,
    value: {
      mode,
      requestedTurnGroups: turnGroups,
      retainedGroupKeys: groupOrder.filter((groupKey) => retainedGroups.has(groupKey)),
      retainedTurnIds,
      suppressedTurnIds,
      removalRanges,
      mountedTurnCountBefore: turns.length,
      mountedTurnCountAfter: mode === "latest-window" ? retainedTurnIds.length : turns.length,
    },
    warnings: [],
  };
}

export function revealPreviousTurnGroups(current: number, increment = 3): number {
  const normalizedCurrent = Number.isInteger(current) ? current : DEFAULT_SLIM_TURN_GROUPS;
  const normalizedIncrement = Number.isInteger(increment) && increment > 0 ? increment : 1;
  return Math.min(
    MAX_SLIM_TURN_GROUPS,
    Math.max(1, normalizedCurrent) + normalizedIncrement,
  );
}
