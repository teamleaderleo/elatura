// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  BoundedCompanionRenderSink,
  DEFAULT_COMPANION_RENDER_POLICY,
} from "../src/render-sink.js";
import {
  extractNavigationRecord,
} from "../src/navigation.js";

const NAVIGATION = Object.freeze({
  conversationId: "nav-conversation",
  entryId: "conv-entry-7",
  parentId: "conv-entry-6",
  childIds: Object.freeze(["conv-entry-8", "conv-entry-9"]),
  childCount: 2,
  siblingIds: Object.freeze(["conv-entry-10"]),
  siblingCount: 1,
  activePath: Object.freeze(["conv-entry-0", "conv-entry-1", "conv-entry-7"]),
  jumpBackReference: null,
});

describe("bounded navigation records", () => {
  it("extracts exact navigate payloads within caps", () => {
    const extracted = extractNavigationRecord(
      {
        conversationId: "nav-conversation",
        generation: 0,
        entryId: "conv-entry-7",
        parentId: "conv-entry-6",
        childIds: ["conv-entry-8", "conv-entry-9"],
        childCount: 2,
        siblingIds: ["conv-entry-10"],
        siblingCount: 1,
        activePath: ["conv-entry-0", "conv-entry-1", "conv-entry-7"],
        jumpBackReference: null,
      },
      DEFAULT_COMPANION_RENDER_POLICY.maxNavigationRelationshipIds,
    );
    expect(extracted).toEqual(NAVIGATION);
  });

  it("rejects inflated relationship lists, hostile fields, and bad counts", () => {
    const base = () => ({
      ...structuredClone(NAVIGATION),
      childIds: [...NAVIGATION.childIds],
      siblingIds: [...NAVIGATION.siblingIds],
      activePath: [...NAVIGATION.activePath],
    });
    expect(
      extractNavigationRecord({ ...base(), childIds: ["a".repeat(3)], childCount: 2 }, 1),
    ).toBeNull();
    expect(extractNavigationRecord(base(), 1)).toBeNull();
    expect(extractNavigationRecord({ ...base(), childCount: -1 }, 64)).toBeNull();
    expect(extractNavigationRecord({ ...base(), extra: true }, 64)).toBeNull();
    expect(extractNavigationRecord({ ...base(), entryId: "bad id" }, 64)).toBeNull();
    expect(extractNavigationRecord("payload", 64)).toBeNull();
    expect(extractNavigationRecord(null, 64)).toBeNull();
  });

  it("accepts bounded jump-back references and rejects unbounded ones", () => {
    const base = () => ({
      ...structuredClone(NAVIGATION),
      generation: 0,
      childIds: [],
      siblingIds: [],
      activePath: [],
    });
    const reference = "https://synthetic.elatura.invalid/jump";
    expect(extractNavigationRecord({ ...base(), jumpBackReference: reference }, 64)?.jumpBackReference).toBe(reference);
    expect(
      extractNavigationRecord({ ...base(), jumpBackReference: "x".repeat(4_097) }, 64),
    ).toBeNull();
  });
});

describe("render sink navigation state", () => {
  it("mounts one record and replaces it with the next", () => {
    const sink = new BoundedCompanionRenderSink();
    expect(sink.snapshot.navigation).toBeNull();
    expect(sink.snapshot.mountedNavigationRelationshipCount).toBe(0);

    sink.replaceNavigation(structuredClone(NAVIGATION));
    expect(sink.snapshot.navigation?.entryId).toBe("conv-entry-7");
    expect(sink.snapshot.mountedNavigationRelationshipCount).toBe(
      NAVIGATION.childIds.length +
        NAVIGATION.activePath.length +
        1,
    );

    sink.replaceNavigation({
      ...structuredClone(NAVIGATION),
      entryId: "conv-entry-8",
      parentId: null,
    });
    expect(sink.snapshot.navigation?.parentId).toBeNull();
  });

  it("refuses a navigation record that would exceed the artifact budget", () => {
    const sink = new BoundedCompanionRenderSink({ maxEstimatedArtifactBytes: 900 });
    const emptyBytes = sink.snapshot.estimatedArtifactBytes;
    expect(sink.snapshot.navigation).toBeNull();
    sink.replaceNavigation(structuredClone(NAVIGATION));
    // Refused records never mount and never inflate retained view state.
    expect(sink.snapshot.navigation).toBeNull();
    expect(sink.snapshot.estimatedArtifactBytes).toBe(emptyBytes);
  });

  it("clears navigation with its conversation and on revoke", () => {
    const sink = new BoundedCompanionRenderSink();
    sink.replaceNavigation(structuredClone(NAVIGATION));

    sink.clearConversation("other-conversation");
    expect(sink.snapshot.navigation?.conversationId).toBe("nav-conversation");

    sink.clearConversation("nav-conversation");
    expect(sink.snapshot.navigation).toBeNull();

    sink.replaceNavigation(structuredClone(NAVIGATION));
    sink.clear();
    expect(sink.snapshot.navigation).toBeNull();
    expect(sink.snapshot.mountedNavigationRelationshipCount).toBe(0);
  });
});
