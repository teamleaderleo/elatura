// SPDX-License-Identifier: MPL-2.0

let composerRecorded = false;

type ContentPageMetric = {
  kind: "dom-content-loaded" | "composer-like-input";
  elapsedMs: number;
  recordedAt: string;
};

function emit(kind: ContentPageMetric["kind"]): void {
  const metric: ContentPageMetric = {
    kind,
    elapsedMs: Math.max(0, performance.now()),
    recordedAt: new Date().toISOString(),
  };
  void browser.runtime.sendMessage({ type: "elatura:page-metric", metric });
}

function findComposerLikeInput(): Element | null {
  return document.querySelector(
    'textarea, [contenteditable="true"][role="textbox"], form [contenteditable="true"]',
  );
}

function inspectForComposer(): void {
  if (composerRecorded || !findComposerLikeInput()) return;
  composerRecorded = true;
  emit("composer-like-input");
  observer.disconnect();
}

const observer = new MutationObserver(inspectForComposer);
observer.observe(document, { subtree: true, childList: true, attributes: true });

addEventListener(
  "DOMContentLoaded",
  () => {
    emit("dom-content-loaded");
    inspectForComposer();
  },
  { once: true },
);
