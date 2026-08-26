// SPDX-License-Identifier: MPL-2.0

export const FIREFOX_CHATGPT_ACTIVITY_PRODUCER_VERSION = 1 as const;
export const FIREFOX_CHATGPT_ACTIVITY_MESSAGE_TYPE =
  "elatura:sample-chatgpt-lane-activity" as const;

export type FirefoxChatGptLaneActivityTargetV1 = Readonly<{
  laneRef: string;
  laneGeneration: number;
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

const MAX_LANE_REF_LENGTH = 240;
const LANE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/#@-]*$/u;
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
    throw new TypeError("Firefox ChatGPT activity target is invalid");
  }
}

export function parseFirefoxChatGptLaneActivityTargetV1(
  value: unknown,
): FirefoxChatGptLaneActivityTargetV1 {
  if (!isPlainRecord(value)) {
    throw new TypeError("Firefox ChatGPT activity target is invalid");
  }
  let keys: (string | symbol)[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    throw new TypeError("Firefox ChatGPT activity target is invalid");
  }
  if (
    keys.length !== 2 ||
    keys.some((key) => key !== "laneRef" && key !== "laneGeneration")
  ) {
    throw new TypeError("Firefox ChatGPT activity target is invalid");
  }
  const laneRef = ownData(value, "laneRef");
  const laneGeneration = ownData(value, "laneGeneration");
  if (
    typeof laneRef !== "string" ||
    laneRef.length < 1 ||
    laneRef.length > MAX_LANE_REF_LENGTH ||
    !LANE_REF_PATTERN.test(laneRef)
  ) {
    throw new TypeError("Firefox ChatGPT activity target is invalid");
  }
  if (
    typeof laneGeneration !== "number" ||
    !Number.isSafeInteger(laneGeneration) ||
    laneGeneration < 1
  ) {
    throw new TypeError("Firefox ChatGPT activity target is invalid");
  }
  return Object.freeze({ laneRef, laneGeneration });
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
  targetInput: unknown,
  snapshot: FirefoxChatGptPageSignalSnapshotV1,
  observedAtMsInput: unknown,
): FirefoxChatGptLaneActivityObservationV1 {
  const target = parseFirefoxChatGptLaneActivityTargetV1(targetInput);
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
    version: FIREFOX_CHATGPT_ACTIVITY_PRODUCER_VERSION,
    laneRef: target.laneRef,
    laneGeneration: target.laneGeneration,
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
  targetInput: unknown,
  documentRef: Document,
  compositionActive: boolean,
  observedAtMs = Date.now(),
): FirefoxChatGptLaneActivityObservationV1 {
  return classifyFirefoxChatGptLaneActivityV1(
    targetInput,
    collectFirefoxChatGptPageSignalSnapshotV1(documentRef, compositionActive),
    observedAtMs,
  );
}

function parseSampleMessage(message: unknown): FirefoxChatGptLaneActivityTargetV1 | null {
  if (!isPlainRecord(message)) return null;
  let keys: (string | symbol)[];
  try {
    keys = Reflect.ownKeys(message);
  } catch {
    return null;
  }
  if (
    keys.length !== 2 ||
    !keys.includes("type") ||
    !keys.includes("target")
  ) {
    return null;
  }
  try {
    const type = ownData(message, "type");
    if (type !== FIREFOX_CHATGPT_ACTIVITY_MESSAGE_TYPE) return null;
    return parseFirefoxChatGptLaneActivityTargetV1(ownData(message, "target"));
  } catch {
    return null;
  }
}

export function bootFirefoxChatGptLaneActivityProducer(
  documentRef: Document = document,
): () => void {
  let compositionActive = false;
  const onCompositionStart = () => {
    compositionActive = true;
  };
  const onCompositionEnd = () => {
    compositionActive = false;
  };
  documentRef.addEventListener("compositionstart", onCompositionStart, true);
  documentRef.addEventListener("compositionend", onCompositionEnd, true);

  const listener = (message: unknown): Promise<FirefoxChatGptLaneActivityObservationV1> | undefined => {
    const target = parseSampleMessage(message);
    if (target === null) return undefined;
    return Promise.resolve(
      sampleFirefoxChatGptLaneActivityV1(
        target,
        documentRef,
        compositionActive,
        Date.now(),
      ),
    );
  };
  browser.runtime.onMessage.addListener(listener);

  return () => {
    documentRef.removeEventListener("compositionstart", onCompositionStart, true);
    documentRef.removeEventListener("compositionend", onCompositionEnd, true);
  };
}
