// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  HELD_OUT_VIEWPORT_GOLD,
  buildHeldOutViewportRepresentation,
  buildSyntheticCompanion,
} from "../../../scripts/run-synthetic-companion-loopback.mjs";

const sessionId = "held-out-viewport-test";

function request(requestId: string, operation: string, payload: Record<string, unknown>) {
  return {
    version: 1,
    sessionId,
    requestId,
    operation,
    payload,
  };
}

async function dispatch(companion, requestId, operation, payload) {
  const response = await companion.dispatch(request(requestId, operation, payload));
  expect(response.ok, `${operation} failed: ${response.errorCode}`).toBe(true);
  if (!response.ok) throw new Error(`${operation} failed: ${response.errorCode}`);
  return response.payload;
}

describe("held-out 100,000-entry viewport scenario", () => {
  it("is deterministic, exactly bounded, and keeps clue IDs content-safe", () => {
    const representation = buildHeldOutViewportRepresentation();
    expect(representation.entries).toHaveLength(HELD_OUT_VIEWPORT_GOLD.entryCount);
    expect(representation.provenance.synthetic).toBe(true);
    expect(representation.provenance.authority.origin).toBe("https://synthetic.elatura.invalid");
    expect(representation.entries.map((entry) => entry.id)).toContain(
      HELD_OUT_VIEWPORT_GOLD.approvedProfile.clueEntryId,
    );
    expect(representation.entries.map((entry) => entry.id)).toContain(
      HELD_OUT_VIEWPORT_GOLD.recoveryCommand.entryId,
    );
    const approvedClue = representation.entries.find(
      (entry) => entry.id === HELD_OUT_VIEWPORT_GOLD.approvedProfile.clueEntryId,
    )?.text;
    expect(approvedClue).toContain("APPROVED_PROFILE_LINK");
    expect(approvedClue).toContain("42 sequence positions later");
    expect(approvedClue).toContain("page-after using the returned cursor");
    expect(representation.entries.find((entry) => entry.id === HELD_OUT_VIEWPORT_GOLD.recoveryCommand.entryId)?.codeBlocks[0]?.text)
      .toContain(HELD_OUT_VIEWPORT_GOLD.recoveryCommand.command);
  }, 60_000);

  it("supports bounded linked clue routes without exposing the source", async () => {
    const companion = buildSyntheticCompanion({
      sessionToken: sessionId,
      scenarioIds: [HELD_OUT_VIEWPORT_GOLD.conversationId],
    });

    const status = await dispatch(companion, "status", "status", {
      conversationId: HELD_OUT_VIEWPORT_GOLD.conversationId,
    });
    expect(status.conversation.entryCount).toBe(100_000);
    expect(status.conversation.freshness).toBe("fresh");
    expect(status.conversation.capabilities.submission).toBe(false);
    expect(status.conversation.capabilities.privateContent).toBe(false);

    const approvedSearch = await dispatch(companion, "approved-search", "search", {
      conversationId: HELD_OUT_VIEWPORT_GOLD.conversationId,
      query: HELD_OUT_VIEWPORT_GOLD.approvedProfile.query,
      limit: 5,
    });
    expect(approvedSearch.results).toHaveLength(1);
    expect(approvedSearch.results[0].entryId).toBe(HELD_OUT_VIEWPORT_GOLD.approvedProfile.clueEntryId);
    const approvedOpen = await dispatch(companion, "approved-open", "open", {
      conversationId: HELD_OUT_VIEWPORT_GOLD.conversationId,
      anchorEntryId: HELD_OUT_VIEWPORT_GOLD.approvedProfile.clueEntryId,
      before: 1,
      after: 1,
    });
    expect(approvedOpen.entries.length).toBeLessThanOrEqual(3);
    const approvedAfter = await dispatch(companion, "approved-after", "page", {
      conversationId: HELD_OUT_VIEWPORT_GOLD.conversationId,
      cursor: approvedOpen.cursor,
      direction: "after",
      limit: 50,
    });
    expect(approvedAfter.entries.map((entry) => entry.id)).toContain(
      HELD_OUT_VIEWPORT_GOLD.approvedProfile.factEntryId,
    );

    const rollbackSearch = await dispatch(companion, "rollback-search", "search", {
      conversationId: HELD_OUT_VIEWPORT_GOLD.conversationId,
      query: HELD_OUT_VIEWPORT_GOLD.rollbackPolicy.query,
      limit: 5,
    });
    expect(rollbackSearch.results).toHaveLength(1);
    expect(rollbackSearch.results[0].entryId).toBe(HELD_OUT_VIEWPORT_GOLD.rollbackPolicy.clueEntryId);
    const rollbackOpen = await dispatch(companion, "rollback-open", "open", {
      conversationId: HELD_OUT_VIEWPORT_GOLD.conversationId,
      anchorEntryId: HELD_OUT_VIEWPORT_GOLD.rollbackPolicy.clueEntryId,
      before: 1,
      after: 1,
    });
    const rollbackBefore = await dispatch(companion, "rollback-before", "page", {
      conversationId: HELD_OUT_VIEWPORT_GOLD.conversationId,
      cursor: rollbackOpen.cursor,
      direction: "before",
      limit: 50,
    });
    expect(rollbackBefore.entries.map((entry) => entry.id)).toContain(
      HELD_OUT_VIEWPORT_GOLD.rollbackPolicy.factEntryId,
    );

    const commandSearch = await dispatch(companion, "command-search", "search", {
      conversationId: HELD_OUT_VIEWPORT_GOLD.conversationId,
      query: HELD_OUT_VIEWPORT_GOLD.recoveryCommand.query,
      limit: 5,
    });
    expect(commandSearch.results).toHaveLength(1);
    expect(commandSearch.results[0].entryId).toBe(HELD_OUT_VIEWPORT_GOLD.recoveryCommand.entryId);
    const commandResource = await dispatch(companion, "command-resource", "code", {
      conversationId: HELD_OUT_VIEWPORT_GOLD.conversationId,
      entryId: HELD_OUT_VIEWPORT_GOLD.recoveryCommand.entryId,
      blockIndex: 0,
    });
    expect(commandResource.block.text.trim()).toBe(HELD_OUT_VIEWPORT_GOLD.recoveryCommand.command);
  }, 60_000);
});
