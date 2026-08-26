// SPDX-License-Identifier: MPL-2.0

export const FIREFOX_CHATGPT_ACTIVITY_PRODUCER_VERSION = 2 as const;
export const FIREFOX_CHATGPT_ACTIVITY_MESSAGE_TYPE =
  "elatura:sample-chatgpt-lane-activity" as const;
export const FIREFOX_CHATGPT_DOCUMENT_PROJECTION_MESSAGE_TYPE =
  "elatura:get-chatgpt-document-projection" as const;

export type FirefoxChatGptLaneActivityTargetV2 = Readonly<{
  laneRef: string;
  laneGeneration: number;
  documentProjectionRef: string;
}>;

export type FirefoxChatGptPageSignalSnapshotV1 = Readonly<{
  generationMarkerActive: boolean;
  conversationMarkersPresent: boolean;
  composerCount: number;
  composerDirty: boolean | null;
  compositionActive: boolean;
  modalActive: boolean;
  mediaActive: boolean;
}>;

export type FirefoxChatGptLaneActivityObservationV1 = Readonly<{
  version: 1;
  laneRef: string;
  laneGeneration: number;
  observedAtMs: number;
  source: "reviewed-live-sentinel";
  confidence: "exact" | "probable";
  generation: "active" | "inactive" | "unknown";
  composer: "clean" | "dirty" | "unknown";
  composition: "active" | "inactive";
  modal: "active" | "inactive";
  mediaOrDevice: "active" | "unknown";
  download: "unknown";
  otherTransient: "unknown";
  grantsWorkAuthority: false;
  authorizesWorkDispatch: false;
}>;

export type FirefoxChatGptDocumentProjectionV1 = Readonly<{
  version: 1;
  documentProjectionRef: string;
  observedAtMs: number;
  grantsWorkAuthority: false;
  authorizesWorkDispatch: false;
}>;

export type FirefoxChatGptLaneActivitySampleV2 = Readonly<{
  version: 2;
  documentProjectionRef: string;
  status: "sampled" | "projection_mismatch";
  observation: FirefoxChatGptLaneActivityObservationV1 | null;
  grantsWorkAuthority: false;
  authorizesWorkDispatch: false;
}>;

export type FirefoxChatGptDocumentProjectionState = {
  current(routeKey: string): string;
};

const MAX_LANE_REF_LENGTH = 240;
const MAX_DOCUMENT_PROJECTION_REF_LENGTH = 128;
const LANE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/#@-]*$/u;
const DOCUMENT_PROJECTION_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const COMPOSER_SELECTOR =
  'textarea, [contenteditable="true"][role="textbox"], form [contenteditable="true"]';
const ACTIVE_GENERATION_SELECTOR =
  '[data-testid="stop-button"], [data-message-author-role="assistant"] [aria-busy="true"], [data-message-author-role="assistant"] [data-is-streaming="true"]';
const CONVERSATION_MARKER_SELECTOR = "[data-message-author-role]";
const MODAL_SELECTOR = 'dialog[open], [role="dialog"][aria-modal="true"]';

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function ownData(value: Record<string, unknown>, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError();
    }
    return descriptor.value;
  } catch {
    throw new TypeError("Firefox ChatGPT activity message is invalid");
  }
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  let actual: (string | symbol)[];
  try {
    actual = Reflect.ownKeys(value);
  } catch {
    return false;
  }
  const expected = new Set(keys);
  return (
    actual.length === keys.length &&
    actual.every((key) => typeof key === "string" && expected.has(key))
  );
}

function boundedDocumentProjectionRef(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_DOCUMENT_PROJECTION_REF_LENGTH ||
    !DOCUMENT_PROJECTION_REF_PATTERN.test(value)
  ) {
    throw new TypeError("Firefox ChatGPT document projection reference is invalid");
  }
  return value;
}

export function parseFirefoxChatGptLaneActivityTargetV2(
  value: unknown,
): FirefoxChatGptLaneActivityTargetV2 {
  try {
    if (
      !isPlainRecord(value) ||
      !exactKeys(value, ["laneRef", "laneGeneration", "documentProjectionRef"])
    ) {
      throw new TypeError();
    }
    const laneRef = ownData(value, "laneRef");
    const laneGeneration = ownData(value, "laneGeneration");
    const documentProjectionRef = ownData(value, "documentProjectionRef");
    if (
      typeof laneRef !== "string" ||
      laneRef.length < 1 ||
      laneRef.length > MAX_LANE_REF_LENGTH ||
      !LANE_REF_PATTERN.test(laneRef)
    ) {
      throw new TypeError();
    }
    if (
      typeof laneGeneration !== "number" ||
      !Number.isSafeInteger(laneGeneration) ||
      laneGeneration < 1
    ) {
      throw new TypeError();
    }
    return Object.freeze({
      laneRef,
      laneGeneration,
      documentProjectionRef: boundedDocumentProjectionRef(documentProjectionRef),
    });
  } catch {
    throw new TypeError("Firefox ChatGPT activity target is invalid");
  }
}

export function createFirefoxChatGptDocumentProjectionState(
  initialRouteKey: string,
  createRef: () => string = () => `firefox-chatgpt-document-${crypto.randomUUID()}`,
): FirefoxChatGptDocumentProjectionState {
  let routeKey = initialRouteKey;
  let documentProjectionRef = boundedDocumentProjectionRef(createRef());
  return {
    current(nextRouteKey: string): string {
      if (nextRouteKey !== routeKey) {
        routeKey = nextRouteKey;
        documentProjectionRef = boundedDocumentProjectionRef(createRef());
      }
      return documentProjectionRef;
    },
  };
}

function composerDirtyState(element: Element): boolean | null {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return element.value.trim().length > 0;
  }
  if (element instanceof HTMLElement && element.isContentEditable) {
    return (element.textContent ?? "").trim().length > 0;
  }
  return null;
}

function mediaActive(documentRef: Document): boolean {
  const media = documentRef.querySelectorAll<HTMLMediaElement>("audio, video");
  for (let index = 0; index < media.length; index += 1) {
    const element = media[index];
    if (element && !element.paused && !element.ended) return true;
  }
  return false;
}

export function collectFirefoxChatGptPageSignalSnapshotV1(
  documentRef: Document,
  compositionActive: boolean,
): FirefoxChatGptPageSignalSnapshotV1 {
  const composers = documentRef.querySelectorAll(COMPOSER_SELECTOR);
  const composer = composers.length === 1 ? composers.item(0) : null;
  return Object.freeze({
    generationMarkerActive: documentRef.querySelector(ACTIVE_GENERATION_SELECTOR) !== null,
    conversationMarkersPresent:
      documentRef.querySelector(CONVERSATION_MARKER_SELECTOR) !== null,
    composerCount: composers.length,
    composerDirty: composer === null ? null : composerDirtyState(composer),
    compositionActive,
    modalActive: documentRef.querySelector(MODAL_SELECTOR) !== null,
    mediaActive: mediaActive(documentRef),
  });
}

export function classifyFirefoxChatGptLaneActivityV1(
  laneTarget: Pick<FirefoxChatGptLaneActivityTargetV2, "laneRef" | "laneGeneration">,
  snapshot: FirefoxChatGptPageSignalSnapshotV1,
  observedAtMsInput: unknown,
): FirefoxChatGptLaneActivityObservationV1 {
  if (
    typeof observedAtMsInput !== "number" ||
    !Number.isSafeInteger(observedAtMsInput) ||
    observedAtMsInput < 0
  ) {
    throw new TypeError("Firefox ChatGPT activity observation time is invalid");
  }

  const generation = snapshot.generationMarkerActive
    ? "active"
    : snapshot.conversationMarkersPresent
      ? "inactive"
      : "unknown";
  const composer = snapshot.composerCount === 1 && snapshot.composerDirty !== null
    ? snapshot.composerDirty
      ? "dirty"
      : "clean"
    : "unknown";
  const composition = snapshot.compositionActive ? "active" : "inactive";
  const modal = snapshot.modalActive ? "active" : "inactive";
  const mediaOrDevice = snapshot.mediaActive ? "active" : "unknown";

  const blockerObserved =
    generation === "active" ||
    composer === "dirty" ||
    composition === "active" ||
    modal === "active" ||
    mediaOrDevice === "active";

  return Object.freeze({
    version: 1,
    laneRef: laneTarget.laneRef,
    laneGeneration: laneTarget.laneGeneration,
    observedAtMs: observedAtMsInput,
    source: "reviewed-live-sentinel",
    confidence: blockerObserved ? "exact" : "probable",
    generation,
    composer,
    composition,
    modal,
    mediaOrDevice,
    download: "unknown",
    otherTransient: "unknown",
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
  });
}

export function sampleFirefoxChatGptLaneActivityV1(
  laneTarget: Pick<FirefoxChatGptLaneActivityTargetV2, "laneRef" | "laneGeneration">,
  documentRef: Document,
  compositionActive: boolean,
  observedAtMs = Date.now(),
): FirefoxChatGptLaneActivityObservationV1 {
  return classifyFirefoxChatGptLaneActivityV1(
    laneTarget,
    collectFirefoxChatGptPageSignalSnapshotV1(documentRef, compositionActive),
    observedAtMs,
  );
}

function currentRouteKey(documentRef: Document): string {
  // The URL is used only as a private local route-change detector. It never
  // enters a response or benchmark artifact.
  return documentRef.URL;
}

function parseActivityTarget(message: unknown): FirefoxChatGptLaneActivityTargetV2 | null {
  if (!isPlainRecord(message) || !exactKeys(message, ["type", "target"])) return null;
  try {
    if (ownData(message, "type") !== FIREFOX_CHATGPT_ACTIVITY_MESSAGE_TYPE) return null;
    return parseFirefoxChatGptLaneActivityTargetV2(ownData(message, "target"));
  } catch {
    return null;
  }
}

function isProjectionDiscoveryMessage(message: unknown): boolean {
  if (!isPlainRecord(message) || !exactKeys(message, ["type"])) return false;
  try {
    return ownData(message, "type") === FIREFOX_CHATGPT_DOCUMENT_PROJECTION_MESSAGE_TYPE;
  } catch {
    return false;
  }
}

export function bootFirefoxChatGptLaneActivityProducer(
  documentRef: Document = document,
): () => void {
  let compositionActive = false;
  const projectionState = createFirefoxChatGptDocumentProjectionState(
    currentRouteKey(documentRef),
  );
  const onCompositionStart = () => {
    compositionActive = true;
  };
  const onCompositionEnd = () => {
    compositionActive = false;
  };
  documentRef.addEventListener("compositionstart", onCompositionStart, true);
  documentRef.addEventListener("compositionend", onCompositionEnd, true);

  const listener = (
    message: unknown,
  ): Promise<FirefoxChatGptDocumentProjectionV1 | FirefoxChatGptLaneActivitySampleV2> | undefined => {
    const documentProjectionRef = projectionState.current(currentRouteKey(documentRef));
    const observedAtMs = Date.now();

    if (isProjectionDiscoveryMessage(message)) {
      return Promise.resolve(Object.freeze({
        version: 1,
        documentProjectionRef,
        observedAtMs,
        grantsWorkAuthority: false,
        authorizesWorkDispatch: false,
      }));
    }

    const target = parseActivityTarget(message);
    if (target === null) return undefined;
    if (target.documentProjectionRef !== documentProjectionRef) {
      return Promise.resolve(Object.freeze({
        version: 2,
        documentProjectionRef,
        status: "projection_mismatch",
        observation: null,
        grantsWorkAuthority: false,
        authorizesWorkDispatch: false,
      }));
    }

    const observation = sampleFirefoxChatGptLaneActivityV1(
      { laneRef: target.laneRef, laneGeneration: target.laneGeneration },
      documentRef,
      compositionActive,
      observedAtMs,
    );
    return Promise.resolve(Object.freeze({
      version: 2,
      documentProjectionRef,
      status: "sampled",
      observation,
      grantsWorkAuthority: false,
      authorizesWorkDispatch: false,
    }));
  };
  browser.runtime.onMessage.addListener(listener);

  return () => {
    documentRef.removeEventListener("compositionstart", onCompositionStart, true);
    documentRef.removeEventListener("compositionend", onCompositionEnd, true);
  };
}
