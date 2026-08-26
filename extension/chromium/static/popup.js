// SPDX-License-Identifier: MPL-2.0
const status = document.getElementById("status");
const lanesRoot = document.getElementById("lanes");
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
    fixedStatus("Applying browser action…");
    const response = await send(command);
    if (response === null || response.ok !== true) {
      fixedStatus("Browser action failed or was refused.");
      await refresh();
      return;
    }
    fixedStatus("Browser action completed.");
    await refresh();
  });
  return element;
}

function lifecycleTokens(lane) {
  const lifecycle = lane.lifecycle;
  return [
    lifecycle.active ? "active" : "background",
    lifecycle.pinned ? "pinned" : "unpinned",
    lifecycle.audible ? "audible" : "quiet",
    lifecycle.discarded ? "discarded" : "loaded",
    lifecycle.frozen === true ? "frozen" : lifecycle.frozen === false ? "unfrozen" : "freeze-unknown",
    lifecycle.autoDiscardable ? "auto-discardable" : "browser-protected",
  ];
}

function renderLane(lane) {
  const card = document.createElement("section");
  card.className = "lane";

  const heading = document.createElement("div");
  heading.className = "lane-heading";
  heading.textContent = `Window ${lane.windowId} · tab ${lane.tabIndex + 1} · id ${lane.tabId}`;

  const state = document.createElement("div");
  state.className = "tokens";
  state.textContent = lifecycleTokens(lane).join(" · ");

  const decision = document.createElement("div");
  decision.className = "decision";
  decision.textContent = `${lane.decision.action} · ${lane.decision.reason}`;

  const actions = document.createElement("div");
  actions.className = "actions";

  if (lane.lifecycle.discarded) {
    actions.append(button("Wake", { type: "wake", tabId: lane.tabId }));
  } else {
    actions.append(
      button(
        "Discard",
        { type: "discard", tabId: lane.tabId },
        lane.manualDiscard?.eligible !== true,
      ),
    );
  }

  if (lane.lifecycle.autoDiscardable) {
    actions.append(button("Protect", { type: "set-protection", tabId: lane.tabId, protected: true }));
  } else {
    actions.append(button("Allow discard", { type: "set-protection", tabId: lane.tabId, protected: false }));
  }

  card.append(heading, state, decision, actions);
  return card;
}

async function refresh() {
  refreshButton.disabled = true;
  fixedStatus("Reading browser lifecycle…");
  const response = await send({ type: "list" });
  lanesRoot.replaceChildren();

  if (response === null || response.ok !== true || !Array.isArray(response.lanes)) {
    fixedStatus("Lifecycle read failed.");
    refreshButton.disabled = false;
    return;
  }

  for (const lane of response.lanes) {
    lanesRoot.append(renderLane(lane));
  }

  const suffix = response.truncated ? " · list truncated" : "";
  fixedStatus(`${response.lanes.length} lanes · ${response.unprojectable ?? 0} unavailable${suffix}`);
  refreshButton.disabled = false;
}

refreshButton.addEventListener("click", refresh);
void refresh();
