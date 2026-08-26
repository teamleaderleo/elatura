// SPDX-License-Identifier: MPL-2.0
import {
  FirefoxChatGptActivityBindingRuntimeV1,
  parseFirefoxChatGptProjectionRefV1,
} from "./chatgpt-lane-activity-binding.js";
import {
  FIREFOX_CHATGPT_ACTIVITY_MESSAGE_TYPE,
  parseFirefoxChatGptLaneActivityTargetV1,
} from "./chatgpt-lane-activity-producer.js";

const REGISTER = "elatura:register-chatgpt-lane-projection" as const;
const GET_PROJECTION = "elatura:get-chatgpt-lane-projection" as const;
const OBSERVE_TARGET = "elatura:observe-chatgpt-lane-target" as const;
const BIND = "elatura:bind-chatgpt-lane-projection" as const;
const SAMPLE = "elatura:sample-bound-chatgpt-lane-activity" as const;

const runtime = new FirefoxChatGptActivityBindingRuntimeV1();

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function ownData(value: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
    throw new TypeError("Firefox activity binding message is invalid");
  }
  return descriptor.value;
}

function exactMessage(
  value: unknown,
  type: string,
  keys: readonly string[],
): Record<string, unknown> | null {
  const candidate = record(value);
  if (!candidate) return null;
  let actual: (string | symbol)[];
  try {
    actual = Reflect.ownKeys(candidate);
  } catch {
    return null;
  }
  const expected = new Set(["type", ...keys]);
  if (
    actual.length !== expected.size ||
    actual.some((key) => typeof key !== "string" || !expected.has(key))
  ) {
    return null;
  }
  try {
    return ownData(candidate, "type") === type ? candidate : null;
  } catch {
    return null;
  }
}

function exactTabId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Firefox activity tab id is invalid");
  }
  return value;
}

function fromExtensionPage(sender: BrowserMessageSender | undefined): boolean {
  return sender?.tab === undefined;
}

browser.runtime.onMessage.addListener((message, sender) => {
  const registration = exactMessage(message, REGISTER, ["projectionRef"]);
  if (registration) {
    const senderTabId = sender?.tab?.id;
    if (senderTabId === undefined) return undefined;
    try {
      runtime.registerProjection(
        exactTabId(senderTabId),
        parseFirefoxChatGptProjectionRefV1(ownData(registration, "projectionRef")),
      );
    } catch {
      return undefined;
    }
    return Promise.resolve(Object.freeze({ registered: true }));
  }

  if (!fromExtensionPage(sender)) return undefined;

  const getProjection = exactMessage(message, GET_PROJECTION, ["tabId"]);
  if (getProjection) {
    try {
      return Promise.resolve(Object.freeze({
        projectionRef: runtime.currentProjection(exactTabId(ownData(getProjection, "tabId"))),
      }));
    } catch {
      return Promise.resolve(Object.freeze({ projectionRef: null }));
    }
  }

  const observeTarget = exactMessage(message, OBSERVE_TARGET, ["target"]);
  if (observeTarget) {
    try {
      return Promise.resolve(runtime.observeTarget(ownData(observeTarget, "target")));
    } catch {
      return undefined;
    }
  }

  const bind = exactMessage(message, BIND, ["target", "tabId", "projectionRef"]);
  if (bind) {
    try {
      return Promise.resolve(runtime.bind(
        ownData(bind, "target"),
        exactTabId(ownData(bind, "tabId")),
        parseFirefoxChatGptProjectionRefV1(ownData(bind, "projectionRef")),
      ));
    } catch {
      return undefined;
    }
  }

  const sample = exactMessage(message, SAMPLE, ["target"]);
  if (sample) {
    let target;
    try {
      target = parseFirefoxChatGptLaneActivityTargetV1(ownData(sample, "target"));
    } catch {
      return undefined;
    }
    return runtime.sample(target, async (tabId, projectionRef, exactTarget) => {
      return browser.tabs.sendMessage(tabId, {
        type: FIREFOX_CHATGPT_ACTIVITY_MESSAGE_TYPE,
        projectionRef,
        target: exactTarget,
      });
    });
  }

  return undefined;
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  const routeChanged = Object.prototype.hasOwnProperty.call(changeInfo, "url");
  if (changeInfo.status === "loading" || routeChanged) runtime.clearProjection(tabId);
});

browser.tabs.onRemoved.addListener((tabId) => {
  runtime.clearProjection(tabId);
});
