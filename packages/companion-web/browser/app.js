// SPDX-License-Identifier: MPL-2.0
/**
 * Thin deterministic glue for the synthetic companion browser surface.
 *
 * Every rendered value is plain text mounted with createTextNode/textContent;
 * no handler closes over a source entry, and all state flows from the latest
 * controller/ledger snapshots. Requests go to one fixed same-origin protocol
 * path with credentials omitted; the bounded ledger accounts every request.
 */
import { CompanionWebController } from "/vendor/@elatura/companion-web/controller.js";
import { BoundedBrowserRequestLedger } from "/vendor/@elatura/companion-web/browser-request-ledger.js";
import { HttpCompanionTransport } from "/vendor/@elatura/companion-web/http-companion-transport.js";
import {
  evaluateWorkingSetPlateau,
} from "/vendor/@elatura/companion-web/plateau.js";
import {
  projectCompanionBrowserViewModel,
} from "/vendor/@elatura/companion-web/view-model.js";

const PROTOCOL_PATH = "/companion/v1";

async function post(url, body, signal) {
  const response = await fetch(url, {
    body,
    cache: "no-store",
    credentials: "omit",
    headers: { "content-type": "application/json" },
    method: "POST",
    mode: "same-origin",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal,
  });
  if (!response.ok) throw new Error(`refused-${response.status}`);
  return response.text();
}

const ledger = new BoundedBrowserRequestLedger();
let transport = null;
let controller = null;
let lastUsage = null;
let lastResult = null;

const elements = Object.fromEntries(
  [
    "status-token", "freshness-token", "diagnostic-token", "counters",
    "conversation-list", "refresh-list", "timeline-section", "timeline-rows",
    "timeline-controls", "timeline-truncated-note", "page-older", "page-newer",
    "close-conversation", "navigation-section", "navigation-details",
    "code-section", "code-text", "search-form", "search-input",
    "search-results", "search-truncated-note", "revoke-session",
    "run-switch-probe", "run-open-close-probe", "probe-output",
  ].map((id) => [id, document.getElementById(id)]),
);

function setText(element, value) {
  element.replaceChildren(document.createTextNode(value));
}

function button(label, attributes) {
  const node = document.createElement("button");
  node.type = "button";
  for (const [name, value] of Object.entries(attributes)) {
    node.setAttribute(name, String(value));
  }
  setText(node, label);
  return node;
}

function render(model) {
  setText(elements["status-token"], model.statusToken);
  const freshness = elements["freshness-token"];
  if (model.freshnessToken === null) {
    freshness.setAttribute("hidden", "");
  } else {
    freshness.removeAttribute("hidden");
    setText(freshness, `freshness:${model.freshnessToken}`);
  }
  const diagnostic = elements["diagnostic-token"];
  if (model.lastErrorToken === null || lastResult?.outcome === "applied") {
    diagnostic.setAttribute("hidden", "");
  } else {
    diagnostic.removeAttribute("hidden");
    setText(diagnostic, `diagnostic:${model.lastErrorToken}`);
  }

  elements.counters.replaceChildren(
    ...model.counters.map(([name, value]) => {
      const term = document.createElement("dt");
      setText(term, name);
      const detail = document.createElement("dd");
      setText(detail, String(value));
      return [term, detail];
    }).flat(),
  );

  elements["conversation-list"].replaceChildren(
    ...model.conversations.map((conversation) => {
      const item = document.createElement("li");
      const openButton = button(
        `${conversation.id} entries=${conversation.entryCount} freshness=${conversation.freshnessToken}`,
        { "data-action": "open", "data-conversation-id": conversation.id },
      );
      item.appendChild(openButton);
      return item;
    }),
  );

  elements["timeline-section"].hidden = model.timelineRows.length === 0 && model.cursor === null;
  elements["page-older"].disabled = !model.hasBefore;
  elements["page-newer"].disabled = !model.hasAfter;
  elements["timeline-truncated-note"].hidden = !model.timelineTruncated;
  elements["timeline-rows"].replaceChildren(
    ...model.timelineRows.map((row) => {
      const item = document.createElement("li");
      const meta = document.createElement("div");
      meta.className = "row-meta";
      setText(
        meta,
        `#${row.sequence} ${row.kindToken}${row.active ? " active" : ""}` +
          ` children=${row.childCount}${row.textTruncated ? " truncated" : ""}`,
      );
      item.appendChild(meta);
      const text = document.createElement("div");
      text.className = "row-text";
      setText(text, row.textPreview);
      item.appendChild(text);
      if (row.jumpBackReference !== null) {
        const jumpBack = document.createElement("div");
        jumpBack.className = "jump-back";
        setText(jumpBack, `jump-back ${row.jumpBackReference.length} code units`);
        item.appendChild(jumpBack);
      }
      const actions = document.createElement("div");
      actions.className = "row-meta";
      if (row.codeBlockCount > 0) {
        for (let index = 0; index < row.codeBlockCount; index += 1) {
          actions.appendChild(button(`code[${index}]`, {
            "data-action": "code",
            "data-conversation-id": currentConversationId() ?? "",
            "data-entry-id": row.id,
            "data-block-index": index,
          }));
        }
      }
      if (row.parentId !== null) {
        actions.appendChild(button("parent", {
          "data-action": "navigate",
          "data-conversation-id": currentConversationId() ?? "",
          "data-entry-id": row.parentId,
        }));
      }
      if (row.childCount > 0) {
        actions.appendChild(button("children", {
          "data-action": "navigate",
          "data-conversation-id": currentConversationId() ?? "",
          "data-entry-id": row.id,
        }));
      }
      actions.appendChild(button("inspect", {
        "data-action": "navigate",
        "data-conversation-id": currentConversationId() ?? "",
        "data-entry-id": row.id,
      }));
      if (actions.childCount > 0) item.appendChild(actions);
      return item;
    }),
  );

  const navigation = model.navigation;
  elements["navigation-section"].hidden = navigation === null;
  if (navigation !== null) {
    const rows = [
      ["entry", navigation.entryId],
      ["parent", navigation.parentId ?? "none"],
      ["childIds", navigation.childIds.join(", ")],
      ["childCount", navigation.childCount],
      ["siblingCount", navigation.siblingCount],
      ["activePath", navigation.activePath.join(" -> ")],
      ["jumpBack", navigation.jumpBackReference === null
        ? "none"
        : `${navigation.jumpBackReference.length} code units`],
    ];
    const details = elements["navigation-details"];
    details.replaceChildren(
      ...rows.map(([term, value]) => {
        const dt = document.createElement("dt");
        setText(dt, term);
        const dd = document.createElement("dd");
        setText(dd, String(value));
        return [dt, dd];
      }).flat(),
    );
    if (navigation.activePath[0] !== undefined) {
      const pathItem = document.createElement("dd");
      pathItem.appendChild(button("open active-path head", {
        "data-action": "open-at",
        "data-conversation-id": navigation.conversationId,
        "data-entry-id": navigation.activePath[0],
      }));
      details.appendChild(pathItem);
    }
  }

  elements["code-section"].hidden = model.codeState === null;
  if (model.codeState !== null) {
    setText(elements["code-text"], model.codeState.text);
  }

  elements["search-results"].replaceChildren(
    ...model.searchResults.map((result) => {
      const item = document.createElement("li");
      const openAtButton = button(result.snippetPreview, {
        "data-action": "open-at",
        "data-conversation-id": currentConversationId() ?? "",
        "data-entry-id": result.entryId,
      });
      item.appendChild(openAtButton);
      return item;
    }),
  );
  elements["search-truncated-note"].hidden = !model.searchTruncated;

  elements["revoke-session"].disabled =
    model.counters.find(([name]) => name === "transportInFlight")?.[1] > 0;
}

function currentConversationId() {
  return controller?.snapshot.render.conversationId ?? null;
}

function apply(result) {
  lastResult = result;
  lastUsage = result.usage ?? lastUsage;
  refresh();
}

function refresh() {
  if (!controller) return;
  render(projectCompanionBrowserViewModel({
    snapshot: controller.snapshot,
    usage: lastUsage,
    ledger: ledger.snapshot,
  }));
}

async function guarded(action) {
  try {
    apply(await action());
  } catch {
    refresh();
  }
}

elements["refresh-list"].addEventListener("click", () => {
  void guarded(() => controller.list(null, 100));
});

elements["conversation-list"].addEventListener("click", (event) => {
  const target = event.target.closest("[data-action='open']");
  if (!(target instanceof HTMLButtonElement)) return;
  const conversationId = target.getAttribute("data-conversation-id");
  if (conversationId) void guarded(() => controller.open(conversationId));
});

elements["timeline-controls"].addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;
  const conversationId = currentConversationId();
  const cursor = controller.snapshot.client.page?.cursor ?? null;
  if (target.id === "page-older" && conversationId && cursor) {
    void guarded(() => controller.page(conversationId, cursor, "before"));
  } else if (target.id === "page-newer" && conversationId && cursor) {
    void guarded(() => controller.page(conversationId, cursor, "after"));
  } else if (target.id === "close-conversation" && conversationId) {
    void guarded(() => controller.close(conversationId));
  }
});

document.body.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action='code'],[data-action='navigate'],[data-action='open-at']");
  if (!(target instanceof HTMLButtonElement)) return;
  const conversationId = target.getAttribute("data-conversation-id");
  const entryId = target.getAttribute("data-entry-id");
  if (!conversationId || !entryId) return;
  const action = target.getAttribute("data-action");
  if (action === "code") {
    const blockIndex = Number(target.getAttribute("data-block-index"));
    void guarded(() => controller.code(conversationId, entryId, blockIndex));
  } else if (action === "navigate") {
    void guarded(async () => {
      const navigated = await controller.navigate(conversationId, entryId);
      if (navigated.outcome === "applied") {
        return controller.open(conversationId, { anchorEntryId: entryId });
      }
      return navigated;
    });
  } else {
    void guarded(() => controller.open(conversationId, { anchorEntryId: entryId }));
  }
});

elements["search-form"].addEventListener("submit", (event) => {
  event.preventDefault();
  const conversationId = currentConversationId();
  const query = elements["search-input"].value.trim();
  if (!conversationId || query.length === 0) return;
  void guarded(() => controller.search(conversationId, query, 50));
});

elements["revoke-session"].addEventListener("click", () => {
  void guarded(() => controller.revoke());
});

function sampleWorkingSet() {
  const workingSet = controller.workingSetSnapshot;
  const ledgerSnapshot = ledger.snapshot;
  return {
    residentConversations: lastUsage?.residentConversationCount ?? 0,
    residentRecords: lastUsage?.residentRecordCount ?? 0,
    residentEntries: lastUsage?.residentEntryCount ?? 0,
    renderedRows: workingSet.renderMountedTimelineRowCount,
    retainedClientRecords:
      controller.snapshot.client.conversations.length +
      (controller.snapshot.client.page?.entries.length ?? 0) +
      controller.snapshot.client.searchResults.length +
      (controller.snapshot.client.code === null ? 0 : 1),
    cacheEntries: ledgerSnapshot.cacheEntryCount,
    cacheBytes: ledgerSnapshot.cacheTotalBytes,
    artifactBytes: workingSet.renderEstimatedArtifactBytes,
  };
}

function probeVerdictText(label, samples) {
  const verdict = evaluateWorkingSetPlateau(samples);
  const lines = samples.map((sample, index) =>
    `${index} ${JSON.stringify(sample)}`,
  );
  lines.push(
    verdict.ok
      ? `${label}: plateau-ok firstHalfMax=${JSON.stringify(verdict.firstHalfMaxima)}`
      : `${label}: plateau-failed ${verdict.failures.map((failure) => `${failure.code}:${failure.field}`).join(",")}`,
  );
  return lines.join("\n");
}

elements["run-switch-probe"].addEventListener("click", () => {
  void (async () => {
    elements["probe-output"].replaceChildren();
    const ids = controller.snapshot.client.conversations.map((item) => item.id);
    if (ids.length === 0) return;
    const samples = [];
    for (let round = 0; round < 3; round += 1) {
      for (const id of ids) {
        const opened = await controller.open(id);
        lastUsage = opened.usage ?? lastUsage;
        samples.push(sampleWorkingSet());
      }
    }
    setText(elements["probe-output"], probeVerdictText("switch-probe", samples));
    refresh();
  })();
});

elements["run-open-close-probe"].addEventListener("click", () => {
  void (async () => {
    elements["probe-output"].replaceChildren();
    const id = currentConversationId()
      ?? controller.snapshot.client.conversations[0]?.id ?? null;
    if (!id) return;
    const samples = [];
    for (let cycle = 0; cycle < 24; cycle += 1) {
      await controller.open(id);
      samples.push(sampleWorkingSet());
      await controller.close(id);
      samples.push(sampleWorkingSet());
    }
    ledger.resetVolatileState();
    setText(elements["probe-output"], probeVerdictText("open-close-probe", samples));
    refresh();
  })();
});

async function start() {
  const sessionResponse = await fetch("/companion/v1/session", {
    cache: "no-store",
    credentials: "omit",
    mode: "same-origin",
  });
  if (!sessionResponse.ok) throw new Error(`refused-${sessionResponse.status}`);
  const sessionInfo = await sessionResponse.json();
  if (
    typeof sessionInfo.sessionId !== "string" ||
    typeof sessionInfo.protocolVersion !== "number"
  ) {
    throw new Error("invalid-session-info");
  }
  transport = new HttpCompanionTransport({
    origin: window.location.origin,
    ledger,
    post,
  });
  controller = new CompanionWebController({
    sessionId: sessionInfo.sessionId,
    transport,
  });
  refresh();
  await guarded(() => controller.list(null, 100));
}

start().catch(() => {
  setText(elements["status-token"], "protocol-error");
});
