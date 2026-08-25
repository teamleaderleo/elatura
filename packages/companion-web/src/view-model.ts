// SPDX-License-Identifier: MPL-2.0
import type {
  CompanionUsage,
} from "@elatura/core/companion";
import type { CompanionWebControllerSnapshot } from "./controller.js";
import type { CompanionBrowserLedgerSnapshot } from "./browser-request-ledger.js";
import type { CompanionNavigationRecord } from "./navigation.js";

/**
 * Content-free projection of controller/ledger state into fixed display rows.
 * Every row is plain data: the static UI mounts these values as text and never
 * closes over a source entry, so no rendered artifact retains conversation
 * objects beyond the bounded render sink itself.
 */
export type CompanionBrowserViewModelRow = Readonly<{
  id: string;
  sequence: number;
  kindToken: string;
  label: string | null;
  textPreview: string;
  textTruncated: boolean;
  codeBlockCount: number;
  childCount: number;
  parentId: string | null;
  active: boolean;
  jumpBackReference: string | null;
}>;

export type CompanionBrowserConversationRow = Readonly<{
  id: string;
  entryCount: number;
  freshnessToken: string;
}>;

export type CompanionBrowserSearchRow = Readonly<{
  entryId: string;
  sequence: number;
  snippetPreview: string;
}>;

export type CompanionBrowserStatusToken =
  | "session-idle"
  | "conversation-list"
  | "conversation-open"
  | "search-ready"
  | "code-ready"
  | "fresh"
  | "stale"
  | "expired"
  | "corrupt"
  | "drifted"
  | "cancelled"
  | "over-limit"
  | "protocol-error";

const ERROR_STATUS_BY_CODE: Readonly<Record<string, CompanionBrowserStatusToken>> =
  Object.freeze({
    "request-cancelled": "cancelled",
    "too-many-in-flight": "over-limit",
    "too-many-queued-pages": "over-limit",
    "page-limit": "over-limit",
    "page-too-large": "over-limit",
    "search-limit": "over-limit",
    "index-limit": "over-limit",
    "resource-too-large": "over-limit",
    "response-too-large": "over-limit",
    "resident-limit": "over-limit",
    "client-state-limit": "over-limit",
    "conversation-expired": "expired",
    "session-expired": "expired",
    "conversation-corrupt": "corrupt",
    "adapter-drift": "drifted",
    "conversation-missing": "protocol-error",
    "entry-missing": "protocol-error",
    "code-missing": "protocol-error",
    "cursor-invalid": "protocol-error",
    "cursor-stale": "protocol-error",
    "invalid-request": "protocol-error",
    "session-mismatch": "protocol-error",
    "session-revoked": "protocol-error",
  });

const MAX_TEXT_PREVIEW_CODE_UNITS = 240;

function preview(text: string): string {
  return text.length > MAX_TEXT_PREVIEW_CODE_UNITS
    ? `${text.slice(0, MAX_TEXT_PREVIEW_CODE_UNITS)}…`
    : text;
}

export type CompanionBrowserViewModel = Readonly<{
  statusToken: CompanionBrowserStatusToken;
  freshnessToken: string | null;
  conversations: readonly CompanionBrowserConversationRow[];
  timelineRows: readonly CompanionBrowserViewModelRow[];
  timelineTruncated: boolean;
  cursor: string | null;
  hasBefore: boolean;
  hasAfter: boolean;
  searchResults: readonly CompanionBrowserSearchRow[];
  searchTruncated: boolean;
  codeState: Readonly<{
    conversationId: string;
    entryId: string;
    blockIndex: number;
    language: string | null;
    textCodeUnits: number;
    text: string;
  }> | null;
  navigation: CompanionNavigationRecord | null;
  lastErrorToken: string | null;
  counters: readonly (readonly [string, number])[];
}>;

export type CompanionBrowserViewModelInput = Readonly<{
  snapshot: CompanionWebControllerSnapshot;
  usage: CompanionUsage | null;
  ledger: CompanionBrowserLedgerSnapshot;
}>;

export function projectCompanionBrowserViewModel(
  input: CompanionBrowserViewModelInput,
): CompanionBrowserViewModel {
  const { snapshot } = input;
  const client = snapshot.client;
  const render = snapshot.render;

  let statusToken: CompanionBrowserStatusToken = "session-idle";
  if (client.page !== null) statusToken = "conversation-open";
  else if (client.conversations.length > 0) statusToken = "conversation-list";
  if (client.searchResults.length > 0) statusToken = "search-ready";
  if (client.code !== null) statusToken = "code-ready";

  let lastErrorToken: string | null = null;
  if (snapshot.pendingLaneCount === 0 && client.lastError !== null) {
    lastErrorToken = client.lastError;
    statusToken = ERROR_STATUS_BY_CODE[client.lastError] ?? "protocol-error";
  }

  const pageFreshness = client.page?.freshness ?? null;
  if (
    pageFreshness === "stale" &&
    (statusToken === "conversation-open" || statusToken === "session-idle")
  ) {
    statusToken = "stale";
  }

  const counters: (readonly [string, number])[] = [
    ["pendingLanes", snapshot.pendingLaneCount],
    ["clientPending", client.pendingRequestCount],
    ["renderConversations", render.conversations.length],
    ["renderRows", render.mountedTimelineRowCount],
    ["renderSearch", render.mountedSearchResultCount],
    ["renderCodeUnits", render.mountedCodeTextCodeUnits],
    ["navigationIds", render.mountedNavigationRelationshipCount],
    ["artifactBytes", render.estimatedArtifactBytes],
    [
      "transportInFlight",
      snapshot.transport.inFlightRequestCount,
    ],
    [
      "transportDispatched",
      snapshot.transport.dispatchedRequestCount,
    ],
    [
      "transportCancelled",
      snapshot.transport.cancelledRequestCount,
    ],
    ["cacheEntries", input.ledger.cacheEntryCount],
    ["cacheBytes", input.ledger.cacheTotalBytes],
    ["ledgerRefused", input.ledger.refusedOverLimitRequestCount],
    ["companionResidentRecords", input.usage?.residentRecordCount ?? 0],
    ["companionResidentEntries", input.usage?.residentEntryCount ?? 0],
    [
      "companionResidentBytes",
      input.usage?.residentSerializedBytes ?? 0,
    ],
  ];

  return {
    statusToken,
    freshnessToken: pageFreshness,
    conversations: render.conversations.map((conversation) => ({
      id: conversation.id,
      entryCount: conversation.entryCount,
      freshnessToken: conversation.freshness,
    })),
    timelineRows: render.timeline.map((entry) => ({
      id: entry.id,
      sequence: entry.sequence,
      kindToken: entry.kind,
      label: entry.label ?? null,
      textPreview: preview(entry.text ?? ""),
      textTruncated: entry.textTruncated,
      codeBlockCount: entry.codeBlockCount,
      childCount: entry.childCount,
      parentId: entry.parentId,
      active: entry.active,
      jumpBackReference: entry.jumpBackReference ?? null,
    })),
    timelineTruncated: render.timelineTruncated,
    cursor: render.cursor,
    hasBefore: client.page?.hasBefore ?? false,
    hasAfter: client.page?.hasAfter ?? false,
    searchResults: render.searchResults.map((result) => ({
      entryId: result.entryId,
      sequence: result.sequence,
      snippetPreview: preview(result.snippet),
    })),
    searchTruncated: render.searchTruncated,
    codeState:
      client.code === null || render.code === null
        ? null
        : {
            conversationId: render.code.conversationId,
            entryId: render.code.entryId,
            blockIndex: render.code.blockIndex,
            language: render.code.language ?? null,
            textCodeUnits: render.code.text.length,
            text: render.code.text,
          },
    navigation: render.navigation,
    lastErrorToken,
    counters,
  };
}
