// SPDX-License-Identifier: MPL-2.0
const status = document.getElementById("status");
const projectionsRoot = document.getElementById("lanes");
const refreshButton = document.getElementById("refresh");

function fixedStatus(text) {
  status.textContent = text;
}

async function send(command) {
  try {
    return await chrome.runtime.sendMessage(command);
  } catch {
    return null;
  }
}

function button(label, command, disabled = false) {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.disabled = disabled;
  element.addEventListener("click", async () => {
    element.disabled = true;
    fixedStatus("Applying browser lifecycle action…");
    const response = await send(command);
    if (response === null || response.ok !== true) {
      fixedStatus("Browser lifecycle action failed or was refused.");
      await refresh();
      return;
    }
    fixedStatus("Browser lifecycle action completed.");
    await refresh();
  });
  return element;
}

function lifecycleTokens(projection) {
  return [
    projection.browserResidency,
    projection.pinned ? "pinned" : "unpinned",
    projection.audioState,
    projection.autoDiscardable ? "auto-discardable" : "warm-protected",
    projection.frozen === null ? "freeze-unknown" : projection.frozen ? "frozen" : "unfrozen",
  ];
}

function renderProjection(projection) {
  const card = document.createElement("section");
  card.className = "lane";

  const heading = document.createElement("div");
  heading.className = "lane-heading";
  heading.textContent = `Window ${projection.windowId} · tab ${projection.tabIndex + 1} · id ${projection.tabId}`;

  const state = document.createElement("div");
  state.className = "tokens";
  state.textContent = lifecycleTokens(projection).join(" · ");

  const detail = document.createElement("div");
  detail.className = "detail";
  detail.textContent = `${projection.projectionId} · discard:${projection.manualDiscard.reason}`;

  const actions = document.createElement("div");
  actions.className = "actions";

  if (projection.autoDiscardable || projection.browserResidency === "discarded") {
    actions.append(button("Keep warm", { type: "keep-warm", tabId: projection.tabId }));
  } else {
    actions.append(button("Allow reclaim", { type: "allow-reclaim", tabId: projection.tabId }));
  }

  if (projection.browserResidency !== "discarded") {
    actions.append(
      button(
        "Discard now",
        { type: "discard", tabId: projection.tabId },
        projection.manualDiscard?.eligible !== true,
      ),
    );
  }

  actions.append(
    button(
      "Activate",
      { type: "activate", tabId: projection.tabId },
      projection.browserResidency === "foreground",
    ),
  );

  card.append(heading, state, detail, actions);
  return card;
}

async function refresh() {
  refreshButton.disabled = true;
  fixedStatus("Reading browser lifecycle…");
  const response = await send({ type: "list" });
  projectionsRoot.replaceChildren();

  if (response === null || response.ok !== true || !Array.isArray(response.projections)) {
    fixedStatus("Lifecycle read failed.");
    refreshButton.disabled = false;
    return;
  }

  for (const projection of response.projections) {
    projectionsRoot.append(renderProjection(projection));
  }

  const suffix = response.truncated ? " · list truncated" : "";
  fixedStatus(
    `${response.projections.length} browser projections · ${response.unprojectable ?? 0} unavailable${suffix}`,
  );
  refreshButton.disabled = false;
}

refreshButton.addEventListener("click", refresh);
void refresh();
