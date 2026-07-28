// SPDX-License-Identifier: MPL-2.0

let composerRecorded = false;

type ContentPageMetric = {
  kind: "dom-content-loaded" | "composer-like-input";
  elapsedMs: number;
  recordedAt: string;
  pathTemplate: string;
};

function redactCurrentPath(): string {
  return location.pathname
    .split("/")
    .map((segment) => (/^[A-Za-z0-9_-]{20,}$/.test(segment) ? ":id" : segment))
    .join("/");
}

function emit(kind: ContentPageMetric["kind"]): void {
  const metric: ContentPageMetric = {
    kind,
    elapsedMs: Math.max(0, performance.now()),
    recordedAt: new Date().toISOString(),
    pathTemplate: redactCurrentPath(),
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
