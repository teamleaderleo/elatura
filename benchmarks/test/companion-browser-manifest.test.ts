// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  PLATEAU_HARD_BOUNDS,
  evaluateCompanionBrowserPlateau,
  parseCompanionBrowserRunManifest,
} from "../src/companion-browser-manifest.js";

function sample(overrides: Record<string, number> = {}) {
  return {
    residentConversations: 1,
    residentRecords: 2,
    residentEntries: 40,
    renderedRows: 25,
    retainedClientRecords: 60,
    cacheEntries: 6,
    cacheBytes: 12_288,
    artifactBytes: 32_768,
    ...overrides,
  };
}

function validManifest(overrides: Record<string, unknown> = {}, probeOverrides: {
  switchSamples?: number[];
  openCloseSamples?: number[];
} = {}) {
  const switchSamples = (probeOverrides.switchSamples ?? [1, 1, 1, 1]).map((step) =>
    sample({ residentEntries: 40 + step }),
  );
  const openCloseSamples = (probeOverrides.openCloseSamples ?? [1, 1, 1, 1]).map(() =>
    sample(),
  );
  return {
    schemaVersion: 1,
    runId: "00000000-0000-4000-8000-00000000c001",
    recordedAt: "2026-08-25T10:00:00.000Z",
    fixture: { id: "synthetic-10000", entryCount: 10_000, textCodeUnits: 320_000, codeBlockCount: 0 },
    client: { revision: "main-13c0972e", protocolVersion: 1 },
    environment: { platformClass: "desktop", browserClass: "gecko", versionToken: "140.0" },
    timingsMs: { initialUsableMs: 412.5, pageOlderMs: null, pageNewerMs: null, searchMs: 88 },
    peakProcessBytes: null,
    residentCompanion: { conversations: 1, records: 2, entries: 80, textCodeUnits: 8_192, serializedBytes: 131_072 },
    retainedClient: { metadataRecords: 5, timelineEntries: 50, searchResults: 3, codeBlocks: 0, pendingRequests: 0 },
    renderedSurface: { timelineRows: 50, domNodes: null, estimatedArtifactBytes: 65_536 },
    requestCacheLedger: {
      dispatchedRequests: 24,
      completedRequests: 22,
      cancelledRequests: 1,
      failedRequests: 1,
      refusedOverLimitRequests: 0,
      cacheEntries: 6,
      cacheTotalBytes: 12_288,
    },
    probes: {
      switchProbe: { cycles: 18, samples: switchSamples },
      openCloseProbe: { cycles: 100, samples: openCloseSamples },
    },
    integrity: {
      observedStates: ["fresh", "stale", "over-limit"],
      truncatedResponseCount: 2,
      overLimitRefusalCount: 1,
    },
    privacy: {
      contentCaptured: false,
      urlsCaptured: false,
      transcriptTextCaptured: false,
      screenshotsCaptured: false,
    },
    ...structuredClone(overrides),
  };
}

describe("companion browser run manifest parser", () => {
  it("accepts a fully valid content-free manifest", () => {
    const parsed = parseCompanionBrowserRunManifest(validManifest());
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.fixture.id).toBe("synthetic-10000");
    expect(parsed.probes.openCloseProbe.cycles).toBe(100);
    expect(parsed.privacy.contentCaptured).toBe(false);
  });

  it("rejects unknown fields anywhere in the document", () => {
    expect(() =>
      parseCompanionBrowserRunManifest(validManifest({ operatorNote: "hello" })),
    ).toThrow(/unsupported fields/u);
    expect(() =>
      parseCompanionBrowserRunManifest(
        validManifest({}, { switchSamples: [1, 1, 1, 1] }),
      ),
    ).not.toThrow();
    const withNote = validManifest();
    (withNote as Record<string, unknown>).fixture = {
      ...(withNote.fixture as Record<string, unknown>),
      title: "my conversation",
    };
    expect(() => parseCompanionBrowserRunManifest(withNote)).toThrow(/title/u);
  });

  it("rejects non-canonical timestamps and malformed UUIDs", () => {
    expect(() =>
      parseCompanionBrowserRunManifest(
        validManifest({ recordedAt: "2026-08-25T10:00:00Z" }),
      ),
    ).toThrow(/canonical ISO-8601/u);
    expect(() =>
      parseCompanionBrowserRunManifest(validManifest({ runId: "not-a-uuid" })),
    ).toThrow(/UUID/u);
  });

  it("enforces fixed enums for fixture ids, platforms, browsers, and states", () => {
    const badFixture = validManifest();
    (badFixture.fixture as { id: string }).id = "real-chatgpt-log";
    expect(() => parseCompanionBrowserRunManifest(badFixture)).toThrow(/must be one of/u);

    const badPlatform = validManifest();
    (badPlatform.environment as { platformClass: string }).platformClass = "watch";
    expect(() => parseCompanionBrowserRunManifest(badPlatform)).toThrow(/desktop, mobile/u);

    const badState = validManifest();
    (badState.integrity as { observedStates: string[] }).observedStates = ["fresh", "leaked"];
    expect(() => parseCompanionBrowserRunManifest(badState)).toThrow(/must be one of/u);
  });

  it("caps probe sample arrays and requires exact sample fields", () => {
    const tooMany = validManifest({}, { switchSamples: new Array(33).fill(0) });
    expect(() => parseCompanionBrowserRunManifest(tooMany)).toThrow(/at most 32/u);

    const wrongShape = validManifest();
    (
      (wrongShape.probes as { switchProbe: { samples: unknown[] } }).switchProbe
    ).samples = [{ residentConversations: 1 }];
    expect(() => parseCompanionBrowserRunManifest(wrongShape)).toThrow(/missing fields/u);
  });

  it("refuses any privacy flag that is not exactly false", () => {
    const leaky = validManifest();
    (leaky.privacy as { urlsCaptured: boolean }).urlsCaptured = true;
    expect(() => parseCompanionBrowserRunManifest(leaky)).toThrow(/exactly false/u);
  });
});

describe("companion browser plateau evaluation", () => {
  it("passes when both probes reach a bounded plateau", () => {
    const verdict = evaluateCompanionBrowserPlateau(
      parseCompanionBrowserRunManifest(validManifest()),
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.failures).toEqual([]);
  });

  it("fails monotonic growth in either probe with a fielded fixed code", () => {
    const growing = validManifest(
      {},
      { switchSamples: [1, 2, 3, 4, 5, 6], openCloseSamples: [1, 1, 1] },
    );
    const verdict = evaluateCompanionBrowserPlateau(
      parseCompanionBrowserRunManifest(growing),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.failures).toContainEqual({
      code: "monotonic-growth",
      probe: "switchProbe",
      field: "residentEntries",
    });
    expect(verdict.failures.some((failure) => failure.probe === "openCloseProbe")).toBe(true);
  });

  it("fails counters beyond hard bounds even when flat", () => {
    const over = validManifest({
      probes: {
        switchProbe: {
          cycles: 9,
          samples: Array.from({ length: 6 }, () =>
            sample({ residentConversations: PLATEAU_HARD_BOUNDS.residentConversations + 1 }),
          ),
        },
        openCloseProbe: {
          cycles: 9,
          samples: Array.from({ length: 6 }, () => sample()),
        },
      },
    } as Record<string, unknown>);
    const verdict = evaluateCompanionBrowserPlateau(
      parseCompanionBrowserRunManifest(over),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.filter((f) => f.code === "over-hard-bound").length).toBeGreaterThan(0);
  });

  it("fails probes with insufficient recorded samples", () => {
    const thin = validManifest(
      {},
      { switchSamples: [1, 1], openCloseSamples: [] },
    );
    const verdict = evaluateCompanionBrowserPlateau(
      parseCompanionBrowserRunManifest(thin),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.every((f) => f.code === "insufficient-samples")).toBe(true);
  });
});
