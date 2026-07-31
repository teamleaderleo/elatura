// SPDX-License-Identifier: MPL-2.0

let composerRecorded = false;

type ContentPageMetric = {
  kind: "dom-content-loaded" | "composer-like-input";
  elapsedMs: number;
  recordedAt: string;
};

type SlimContentControllerModule = typeof import("./slim-content-controller.js");

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
  composerObserver.disconnect();
}

const composerObserver = new MutationObserver(inspectForComposer);
composerObserver.observe(document, { subtree: true, childList: true, attributes: true });

addEventListener(
  "DOMContentLoaded",
  () => {
    emit("dom-content-loaded");
    inspectForComposer();
  },
  { once: true },
);

void (import(browser.runtime.getURL("slim-content-controller.js")) as Promise<SlimContentControllerModule>)
  .then((controller) => controller.bootSlimContentController())
  .catch(() => {
    // The observer remains usable when the locked prototype module cannot load.
  });
