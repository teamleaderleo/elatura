// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { parseGoogleDocsLiveRunManifest } from "../src/google-docs-live-manifest.js";

function laneState(ordinal: number, overrides: Record<string, unknown> = {}) {
  return {
    ordinal,
    laneRef: `docs-lane-${ordinal}`,
    laneGeneration: 1,
    requestedIntent: null,
    browserResidency: ordinal === 0 ? "foreground" : "background",
    recovery: "verified",
    freezeEligibility: "allowed",
    discardEligibility: "allowed",
    blockers: [],
    plannerAction: null,
    plannerReason: null,
    latestEventType: "idle",
    latestEventConfidence: "exact",
    latestEventFreshness: "fresh",
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
    autosaveState: "saved",
    localEditPending: "no",
    compositionActive: "no",
    selectionPresent: "no",
    transientEditorActive: "no",
    collaborationActive: "no",
    viewportAnchorAvailable: "yes",
    ...structuredClone(overrides),
  };
}

function sample(
  sequence: number,
  requestedDocumentCount: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    sequence,
    phase: sequence === 0 ? "initial" : "active",
    probeClass: "routine",
    revisitIntervalClass: "rotation",
    browserAction: "none",
    activeDocumentOrdinal: requestedDocumentCount > 0 ? 0 : null,
    openDocumentTabs: requestedDocumentCount,
    frozenDocumentTabs: 0,
    discardedDocumentTabs: 0,
    usefulDocumentCount: requestedDocumentCount,
    attentionRequiredDocumentCount: 0,
    pageTargetCount: requestedDocumentCount,
    rendererProcessCount: requestedDocumentCount > 0 ? 1 : 0,
    serviceWorkerProcessCount: 1,
    browserTreeResidentBytes: 800_000_000,
    docsRendererResidentBytes: requestedDocumentCount > 0 ? 200_000_000 : null,
    gpuResidentBytes: 80_000_000,
    systemAvailableMemoryBytes: 8_000_000_000,
    swapUsedBytes: 0,
    majorPageFaultsDelta: 0,
    jsHeapUsedBytes: requestedDocumentCount > 0 ? 100_000_000 : null,
    domNodes: requestedDocumentCount > 0 ? 5_000 : null,
    jsEventListeners: requestedDocumentCount > 0 ? 500 : null,
    browserTreeCpuSecondsDelta: 0.1,
    rendererCpuSecondsDelta: requestedDocumentCount > 0 ? 0.05 : null,
    backgroundNetworkBytesDelta: 0,
    activationToVisibleMs: requestedDocumentCount > 0 ? 40 : null,
    activationToEditableMs: requestedDocumentCount > 0 ? 70 : null,
    editEchoMs: null,
    saveSettledMs: null,
    reloadTransferredBytes: null,
    reloadRequestCount: null,
    laneStates: Array.from({ length: requestedDocumentCount }, (_, ordinal) =>
      laneState(ordinal),
    ),
    ...structuredClone(overrides),
  };
}

function fidelity() {
  return {
    documentIdentityContinuity: "pass",
    authenticationContinuity: "pass",
    editCanarySaved: "pass",
    editingModeContinuity: "pass",
    undoRedo: "pass",
    caretContinuity: "pass",
    selectionContinuity: "pass",
    viewportContinuity: "pass",
    autosaveContinuity: "pass",
    commentSuggestionContinuity: "unmeasured",
    collaborationContinuity: "unmeasured",
    permissionsContinuity: "pass",
    findNavigationContinuity: "pass",
    offlineStateTruthful: "unmeasured",
    unexpectedReloadCount: 0,
    operatorVisibleFailureCount: 0,
  };
}

function validManifest(options: Record<string, unknown> = {}): any {
  const workload = String(options.workload ?? "docs-switch-capacity-v1");
  const requestedDocumentCount = Number(
    options.requestedDocumentCount ??
      (workload === "docs-large-text-v1" ? 1 : workload === "docs-switch-8-v1" ? 8 : 2),
  );
  const variant = String(options.variant ?? "stock-resident");
  const sampleCount = Number(options.sampleCount ?? (workload === "docs-switch-8-v1" ? 64 : 6));
  const memorySaver = variant === "stock-memory-saver" ? "balanced" : "off";
  const instrumentation =
    variant === "elatura-suspended"
      ? "bounded-cdp-lease"
      : variant === "elatura-observe" || variant === "elatura-reclaimable"
        ? "extension-only"
        : "none";

  const samples = Array.from({ length: sampleCount }, (_, index) =>
    sample(index, requestedDocumentCount),
  );

  if (requestedDocumentCount > 0 && variant === "stock-explicit-discard") {
    samples[1] = sample(1, requestedDocumentCount, { browserAction: "discard" });
  }
  if (requestedDocumentCount > 0 && variant === "elatura-suspended") {
    const laneStates = Array.from({ length: requestedDocumentCount }, (_, ordinal) =>
      laneState(ordinal, ordinal === Math.min(1, requestedDocumentCount - 1)
        ? {
            requestedIntent: "suspended",
            browserResidency: "background",
            plannerAction: "freeze",
            plannerReason: "freeze_eligible",
          }
        : {}),
    );
    samples[1] = sample(1, requestedDocumentCount, {
      browserAction: "freeze",
      laneStates,
    });
  }
  if (requestedDocumentCount > 0 && variant === "elatura-reclaimable") {
    const laneStates = Array.from({ length: requestedDocumentCount }, (_, ordinal) =>
      laneState(ordinal, ordinal === Math.min(1, requestedDocumentCount - 1)
        ? {
            requestedIntent: "reclaimable",
            browserResidency: "background",
            plannerAction: "discard",
            plannerReason: "discard_eligible",
          }
        : {}),
    );
    samples[1] = sample(1, requestedDocumentCount, {
      browserAction: "discard",
      laneStates,
    });
  }

  return {
    schemaVersion: 1,
    runId: "00000000-0000-4000-8000-00000000d118",
    recordedAt: "2026-08-27T00:00:00.000Z",
    workload,
    variant,
    requestedDocumentCount,
    fixture: {
      generator: "google-docs-workload-v1",
      documentCount: 8,
      totalTextCodeUnits: 2_318_400,
      perDocumentTextCodeUnits: new Array(8).fill(289_800),
      manifestSha256: `sha256:${"a".repeat(64)}`,
    },
    environment: {
      osClass: "macos",
      browserVersionToken: "140.0.7339.80",
      profileClass: "dedicated-signed-in",
      memorySaver,
      energySaver: "off",
      instrumentation,
      persistentDebuggerAttached: false,
      hardwareMemoryBytes: 16_000_000_000,
    },
    samples,
    fidelity: fidelity(),
    privacy: {
      documentTextCaptured: false,
      documentTitlesCaptured: false,
      urlsCaptured: false,
      accountIdsCaptured: false,
      collaboratorIdsCaptured: false,
      screenshotsCaptured: false,
      clipboardCaptured: false,
      freeFormNotesCaptured: false,
    },
  };
}

describe("Google Docs live run manifest parser", () => {
  it("accepts a coherent content-free capacity run", () => {
    const parsed = parseGoogleDocsLiveRunManifest(validManifest());
    expect(parsed.workload).toBe("docs-switch-capacity-v1");
    expect(parsed.requestedDocumentCount).toBe(2);
    expect(parsed.samples).toHaveLength(6);
    expect(parsed.samples[0]?.laneStates.map((lane) => lane.laneRef)).toEqual([
      "docs-lane-0",
      "docs-lane-1",
    ]);
  });

  it("rejects unknown content-bearing fields and privacy capture", () => {
    const withTitle = validManifest();
    withTitle.documentTitle = "private title";
    expect(() => parseGoogleDocsLiveRunManifest(withTitle)).toThrow(/unsupported fields/u);

    const leaky = validManifest();
    leaky.privacy.urlsCaptured = true;
    expect(() => parseGoogleDocsLiveRunManifest(leaky)).toThrow(/exactly false/u);
  });

  it("pins application-lane work and dispatch authority to false", () => {
    const authority = validManifest();
    authority.samples[0].laneStates[0].grantsWorkAuthority = true;
    expect(() => parseGoogleDocsLiveRunManifest(authority)).toThrow(/zero work authority/u);

    const dispatch = validManifest();
    dispatch.samples[0].laneStates[0].authorizesWorkDispatch = true;
    expect(() => parseGoogleDocsLiveRunManifest(dispatch)).toThrow(/zero work authority/u);
  });

  it("requires stable laneRef and nondecreasing generation by document ordinal", () => {
    const changedRef = validManifest();
    changedRef.samples[2].laneStates[0].laneRef = "different-lane";
    expect(() => parseGoogleDocsLiveRunManifest(changedRef)).toThrow(/Lane reference changed/u);

    const generation = validManifest();
    generation.samples[1].laneStates[0].laneGeneration = 2;
    generation.samples[2].laneStates[0].laneGeneration = 1;
    expect(() => parseGoogleDocsLiveRunManifest(generation)).toThrow(/generation regressed/u);
  });

  it("requires one unique lane per requested document and reconciles residency counts", () => {
    const missing = validManifest();
    missing.samples[0].laneStates = [laneState(0)];
    expect(() => parseGoogleDocsLiveRunManifest(missing)).toThrow(/one state per requested document/u);

    const duplicateRef = validManifest();
    duplicateRef.samples[0].laneStates[1].laneRef = "docs-lane-0";
    expect(() => parseGoogleDocsLiveRunManifest(duplicateRef)).toThrow(/duplicate laneRef/u);

    const mismatch = validManifest();
    mismatch.samples[0].frozenDocumentTabs = 1;
    expect(() => parseGoogleDocsLiveRunManifest(mismatch)).toThrow(/lifecycle counts must match/u);
  });

  it("admits merged lifecycle blocker vocabulary on adversarial probes", () => {
    const adversarial = validManifest();
    adversarial.samples[2].probeClass = "adversarial";
    adversarial.samples[2].laneStates[1] = laneState(1, {
      freezeEligibility: "blocked",
      discardEligibility: "blocked",
      blockers: ["save_in_progress", "composition_active"],
      autosaveState: "saving",
      compositionActive: "yes",
    });
    expect(() => parseGoogleDocsLiveRunManifest(adversarial)).not.toThrow();
  });

  it("keeps stock and observe cohorts outside the residency planner", () => {
    const stock = validManifest();
    stock.environment.instrumentation = "extension-only";
    expect(() => parseGoogleDocsLiveRunManifest(stock)).toThrow(/Stock variants/u);

    const observe = validManifest({ variant: "elatura-observe" });
    observe.samples[1].laneStates[1].requestedIntent = "suspended";
    observe.samples[1].laneStates[1].plannerAction = "freeze";
    observe.samples[1].laneStates[1].plannerReason = "freeze_eligible";
    expect(() => parseGoogleDocsLiveRunManifest(observe)).toThrow(/must not contain lifecycle planner/u);
  });

  it("requires a suspended planner decision and browser freeze for the suspended arm", () => {
    const frozen = validManifest({ variant: "elatura-suspended" });
    expect(() => parseGoogleDocsLiveRunManifest(frozen)).not.toThrow();

    frozen.environment.instrumentation = "extension-only";
    expect(() => parseGoogleDocsLiveRunManifest(frozen)).toThrow(/short-lived CDP/u);

    const missing = validManifest({ variant: "elatura-suspended" });
    missing.samples[1] = sample(1, missing.requestedDocumentCount);
    expect(() => parseGoogleDocsLiveRunManifest(missing)).toThrow(/suspended\/freeze/u);
  });

  it("separates stock discard from planner-controlled reclaimable discard", () => {
    const stockDiscard = parseGoogleDocsLiveRunManifest(
      validManifest({ variant: "stock-explicit-discard" }),
    );
    expect(stockDiscard.environment.instrumentation).toBe("none");
    expect(stockDiscard.samples.flatMap((sample) => sample.laneStates).every(
      (lane) => lane.requestedIntent === null,
    )).toBe(true);

    const reclaimable = parseGoogleDocsLiveRunManifest(
      validManifest({ variant: "elatura-reclaimable" }),
    );
    expect(reclaimable.samples.flatMap((sample) => sample.laneStates).some(
      (lane) => lane.requestedIntent === "reclaimable" && lane.plannerAction === "discard",
    )).toBe(true);
  });

  it("requires all 64 raw samples for the fixed eight-document rotation", () => {
    expect(() =>
      parseGoogleDocsLiveRunManifest(
        validManifest({ workload: "docs-switch-8-v1", sampleCount: 64 }),
      ),
    ).not.toThrow();
    expect(() =>
      parseGoogleDocsLiveRunManifest(
        validManifest({ workload: "docs-switch-8-v1", sampleCount: 63 }),
      ),
    ).toThrow(/exactly 64/u);
  });

  it("admits only the documented 0/1/2/4/8 capacity points", () => {
    expect(() =>
      parseGoogleDocsLiveRunManifest(
        validManifest({ workload: "docs-switch-capacity-v1", requestedDocumentCount: 3 }),
      ),
    ).toThrow(/0, 1, 2, 4, or 8/u);
    expect(() =>
      parseGoogleDocsLiveRunManifest(
        validManifest({ workload: "docs-switch-capacity-v1", requestedDocumentCount: 0 }),
      ),
    ).not.toThrow();
  });

  it("refuses persistent debugger attachment", () => {
    const attached = validManifest();
    attached.environment.persistentDebuggerAttached = true;
    expect(() => parseGoogleDocsLiveRunManifest(attached)).toThrow(/exactly false/u);
  });
});
