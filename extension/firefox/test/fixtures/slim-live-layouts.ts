// SPDX-License-Identifier: MPL-2.0

import type { SlimLiveContainerObservation } from "../../src/slim-live-observation.js";

export type SlimLiveLayoutFixture = {
  name: string;
  roleMarkerCount: number;
  containers: SlimLiveContainerObservation[];
};

function turn(
  index: number,
  role: unknown,
  overrides: Partial<SlimLiveContainerObservation> = {},
): SlimLiveContainerObservation {
  return {
    containerId: `container-${index + 1}`,
    parentToken: "parent-1",
    documentOrder: index,
    roleValues: [role],
    streaming: false,
    estimatedBlockSizePx: role === "assistant" ? 280 : 120,
    ...overrides,
  };
}

export const ordinaryFivePairLayout: SlimLiveLayoutFixture = {
  name: "ordinary-five-pairs",
  roleMarkerCount: 10,
  containers: Array.from({ length: 5 }, (_, pairIndex) => [
    turn(pairIndex * 2, "user"),
    turn(pairIndex * 2 + 1, "assistant"),
  ]).flat(),
};

export const streamingLayout: SlimLiveLayoutFixture = {
  name: "active-stream",
  roleMarkerCount: 6,
  containers: [
    turn(0, "user"),
    turn(1, "assistant"),
    turn(2, "user"),
    turn(3, "assistant"),
    turn(4, "user"),
    turn(5, "assistant", { streaming: true, estimatedBlockSizePx: 420 }),
  ],
};

export const providerNoiseLayout: SlimLiveLayoutFixture = {
  name: "provider-role-noise",
  roleMarkerCount: 5,
  containers: [
    turn(0, "system"),
    turn(1, "user"),
    turn(2, "future-provider-private-role"),
    turn(3, "assistant"),
  ],
};

export const ignoredMarkerLayout: SlimLiveLayoutFixture = {
  name: "ignored-markers-outside-turns",
  roleMarkerCount: 6,
  containers: [
    turn(0, "user"),
    turn(1, "assistant"),
    turn(2, "user"),
    turn(3, "assistant"),
  ],
};

export const ambiguousRoleLayout: SlimLiveLayoutFixture = {
  name: "ambiguous-role-markers",
  roleMarkerCount: 3,
  containers: [
    turn(0, "user"),
    turn(1, "assistant", { roleValues: ["assistant", "tool"] }),
  ],
};

export const splitParentLayout: SlimLiveLayoutFixture = {
  name: "split-parent",
  roleMarkerCount: 2,
  containers: [
    turn(0, "user"),
    turn(1, "assistant", { parentToken: "parent-2" }),
  ],
};

export const outOfOrderLayout: SlimLiveLayoutFixture = {
  name: "out-of-order",
  roleMarkerCount: 2,
  containers: [
    turn(0, "user", { documentOrder: 1 }),
    turn(1, "assistant", { documentOrder: 1 }),
  ],
};

export const missingParentLayout: SlimLiveLayoutFixture = {
  name: "missing-parent",
  roleMarkerCount: 1,
  containers: [turn(0, "user", { parentToken: null })],
};

export const duplicateContainerIdLayout: SlimLiveLayoutFixture = {
  name: "duplicate-container-id",
  roleMarkerCount: 2,
  containers: [
    turn(0, "user", { containerId: "same-container" }),
    turn(1, "assistant", { containerId: "same-container" }),
  ],
};

export const markerCountMismatchLayout: SlimLiveLayoutFixture = {
  name: "marker-count-mismatch",
  roleMarkerCount: 1,
  containers: [
    turn(0, "user"),
    turn(1, "assistant"),
  ],
};
