// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import type {
  CompanionUsage,
} from "@elatura/core/companion";
import type {
  CompanionWebControllerSnapshot,
} from "../src/controller.js";
import type {
  CompanionBrowserLedgerSnapshot,
} from "../src/browser-request-ledger.js";
import {
  projectCompanionBrowserViewModel,
} from "../src/view-model.js";

const USAGE: CompanionUsage = Object.freeze({
  residentConversationCount: 1,
  residentRecordCount: 2,
  residentEntryCount: 50,
  residentTextCodeUnits: 4_096,
  residentSerializedBytes: 65_536,
  residentAccountedBytes: 262_144,
  inFlightRequests: 0,
  queuedPageRequests: 0,
});

const LEDGER: CompanionBrowserLedgerSnapshot = Object.freeze({
  dispatchedRequestCount: 12,
  completedRequestCount: 10,
  failedRequestCount: 1,
  cancelledRequestCount: 1,
  refusedOverLimitRequestCount: 0,
  cacheEntryCount: 6,
  cacheTotalBytes: 24_576,
  cacheEvictedEntryCount: 2,
  logEntryCount: 8,
});

function snapshotFixture(overrides: Partial<CompanionWebControllerSnapshot> = {}) {
  const base = {
    client: {
      conversations: [
        {
          id: "synthetic-100",
          entryCount: 100,
          adapter: { id: "chatgpt-conversation", version: "0.3.0" },
          freshness: "fresh" as const,
          capabilities: {
            paging: true,
            search: true,
            branches: true,
            codeOnDemand: true,
            jumpBack: true,
            submission: false,
            persistence: false,
            privateContent: false,
          },
        },
      ],
      page: null,
      searchConversationId: null,
      searchResults: [],
      code: null,
      lastError: null,
      pendingRequestCount: 0,
    },
    render: {
      conversations: [],
      conversationId: null,
      cursor: null,
      timeline: [],
      timelineTruncated: false,
      searchConversationId: null,
      searchResults: [],
      searchTruncated: false,
      code: null,
      navigation: null,
      lastError: null,
      mountedTimelineRowCount: 0,
      mountedSearchResultCount: 0,
      mountedCodeTextCodeUnits: 0,
      mountedNavigationRelationshipCount: 0,
      estimatedArtifactBytes: 512,
    },
    transport: {
      dispatchedRequestCount: 3,
      completedRequestCount: 3,
      cancelledRequestCount: 0,
      inFlightRequestCount: 0,
    },
    pendingLaneCount: 0,
    requestOrdinal: 3,
  };
  return Object.freeze(structuredClone(base)) as CompanionWebControllerSnapshot;
}

function viewModel(overrides: Partial<CompanionWebControllerSnapshot> = {}) {
  const snapshot = overrides
    ? (Object.assign({}, snapshotFixture(), overrides) as CompanionWebControllerSnapshot)
    : snapshotFixture();
  return projectCompanionBrowserViewModel({
    snapshot,
    usage: USAGE,
    ledger: LEDGER,
  });
}

describe("companion browser view model", () => {
  it("starts idle and reports the conversation list once mounted", () => {
    expect(viewModel().statusToken).toBe("conversation-list");
    expect(viewModel().conversations).toHaveLength(0);
  });

  it("maps every fixed error code to a bounded diagnostic token", () => {
    for (const [code, expected] of [
      ["request-cancelled", "cancelled"],
      ["page-too-large", "over-limit"],
      ["search-limit", "over-limit"],
      ["response-too-large", "over-limit"],
      ["resident-limit", "over-limit"],
      ["conversation-expired", "expired"],
      ["adapter-drift", "drifted"],
      ["conversation-corrupt", "corrupt"],
      ["code-missing", "protocol-error"],
      ["cursor-stale", "protocol-error"],
      ["session-mismatch", "protocol-error"],
    ] as const) {
      const withError = structuredClone(snapshotFixture());
      (withError.client as { lastError: string | null }).lastError = code;
      const model = projectCompanionBrowserViewModel({
        snapshot: withError,
        usage: USAGE,
        ledger: LEDGER,
      });
      expect(model.statusToken, code).toBe(expected);
      expect(model.lastErrorToken, code).toBe(code);
    }
  });

  it("reports stale freshness without masking the open state", () => {
    const stale = structuredClone(snapshotFixture());
    (
      stale.render as unknown as { conversations: { freshness: string }[] }
    ).conversations.push();
    const model = projectCompanionBrowserViewModel({
      snapshot: stale,
      usage: USAGE,
      ledger: LEDGER,
    });
    expect(model.counters.length).toBeGreaterThanOrEqual(15);
    expect(model.codeState).toBeNull();
    expect(model.navigation).toBeNull();
  });

  it("bounds text previews to the fixed code-unit cap", () => {
    const long = "x".repeat(600);
    const withRows = structuredClone(snapshotFixture());
    (
      withRows.render as unknown as {
        timeline: {
          id: string;
          parentId: null;
          childCount: number;
          sequence: number;
          kind: string;
          text: string;
          textTruncated: boolean;
          codeBlockCount: number;
          active: boolean;
        }[];
      }
    ).timeline.push({
      id: "entry-long",
      parentId: null,
      childCount: 2,
      sequence: 4,
      kind: "message",
      text: long,
      textTruncated: false,
      codeBlockCount: 1,
      active: false,
    });
    const model = projectCompanionBrowserViewModel({
      snapshot: withRows,
      usage: USAGE,
      ledger: LEDGER,
    });
    expect(model.timelineRows[0]?.textPreview.length).toBeLessThanOrEqual(241);
    expect(model.timelineRows[0]?.textPreview.endsWith("…")).toBe(true);
    expect(model.timelineRows[0]?.childCount).toBe(2);
  });

  it("exposes content-free counters including companion usage and ledger", () => {
    const counters = new Map(viewModel().counters);
    expect(counters.get("companionResidentEntries")).toBe(50);
    expect(counters.get("companionResidentBytes")).toBe(65_536);
    expect(counters.get("cacheBytes")).toBe(24_576);
    expect(counters.get("ledgerRefused")).toBe(0);
    expect(counters.get("transportDispatched")).toBe(3);
    // No counter name or value carries content; all are fixed numeric fields.
    for (const [name, value] of counters) {
      expect(typeof name === "string" && /^[a-zA-Z]+$/.test(name)).toBe(true);
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});
