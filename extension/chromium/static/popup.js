// SPDX-License-Identifier: MPL-2.0
const status = document.getElementById("status");
const projectionsRoot = document.getElementById("projections");
const refreshButton = document.getElementById("refresh");

function setStatus(text) {
  status.textContent = text;
}

async function send(command) {
  try {
    return await chrome.runtime.sendMessage(command);
  } catch {
    return null;
  }
}

function actionButton(label, command, disabled = false) {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.disabled = disabled;
  element.addEventListener("click", async () => {
    element.disabled = true;
    setStatus("Applying explicit browser action…");
    const response = await send(command);
    if (response === null || response.ok !== true) {
      setStatus("Browser action failed or was refused.");
      await refresh();
      return;
    }
    setStatus("Browser action completed.");
    await refresh();
  });
  return element;
}

function renderProjection(projection) {
  const card = document.createElement("section");
  card.className = "projection";

  const heading = document.createElement("div");
  heading.className = "projection-heading";
  heading.textContent = `Window ${projection.windowId} · tab ${projection.tabIndex + 1} · id ${projection.tabId}`;

  const ref = document.createElement("div");
  ref.className = "mono";
  ref.textContent = projection.projectionRef;

  const state = document.createElement("div");
  state.className = "tokens";
  state.textContent = [
    projection.browserResidency,
    projection.audioState,
    projection.autoDiscardable ? "auto-discardable" : "browser-protected",
    projection.pinned ? "pinned" : "unpinned",
    `freeze:${projection.freezeEligibility}`,
    `discard:${projection.discardEligibility}`,
  ].join(" · ");

  const blockers = document.createElement("div");
  blockers.className = "mono";
  blockers.textContent = `blockers: ${(projection.blockers ?? []).join(", ") || "none"}`;

  const actions = document.createElement("div");
  actions.className = "actions";

  if (projection.browserResidency === "discarded") {
    actions.append(actionButton("Wake", { type: "wake", tabId: projection.tabId }));
  } else {
    actions.append(
      actionButton(
        "Manual discard",
        { type: "discard", tabId: projection.tabId },
        projection.manualDiscard?.eligible !== true,
      ),
    );
  }

  if (projection.autoDiscardable) {
    actions.append(actionButton("Protect", { type: "set-protection", tabId: projection.tabId, protected: true }));
  } else {
    actions.append(actionButton("Allow discard", { type: "set-protection", tabId: projection.tabId, protected: false }));
  }

  card.append(heading, ref, state, blockers, actions);
  return card;
}

async function refresh() {
  refreshButton.disabled = true;
  setStatus("Reading browser lifecycle…");
  const response = await send({ type: "list" });
  projectionsRoot.replaceChildren();

  if (response === null || response.ok !== true || !Array.isArray(response.projections)) {
    setStatus("Lifecycle read failed.");
    refreshButton.disabled = false;
    return;
  }

  for (const projection of response.projections) {
    projectionsRoot.append(renderProjection(projection));
  }

  const suffix = response.truncated ? " · list truncated" : "";
  setStatus(`${response.projections.length} projections · ${response.unprojectable ?? 0} unavailable${suffix}`);
  refreshButton.disabled = false;
}

refreshButton.addEventListener("click", refresh);
void refresh();
