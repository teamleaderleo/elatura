// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  parseApplicationLaneDescriptorV1,
  parseApplicationLaneEventV1,
  parseApplicationLaneRequestV1,
  parseApplicationLaneResponseV1,
} from "../src/application-lane.js";

const descriptor = {
  version: 1,
  laneRef: "elatura:lane:chat-a",
  generation: 7,
  adapter: { id: "chatgpt", version: "1" },
  capabilities: ["screenshot", "events", "activate", "observe"],
  state: "active",
  observedAt: "2026-08-26T17:00:00.000Z",
} as const;

const event = {
  version: 1,
  eventId: "elatura:event:chat-a:42",
  laneRef: descriptor.laneRef,
  laneGeneration: descriptor.generation,
  eventType: "changed",
  observedAt: "2026-08-26T17:01:00.000Z",
  confidence: "exact",
  freshness: "fresh",
  sourceRefs: ["elatura:observation:42", "elatura:signal:42"],
  grantsWorkAuthority: false,
  authorizesWorkDispatch: false,
} as const;

const statusRequest = {
  version: 1,
  requestId: "request:status:42",
  laneRef: descriptor.laneRef,
  laneGeneration: descriptor.generation,
  operation: "status",
  payload: {},
} as const;

const unavailableResponse = {
  version: 1,
  requestId: "request:status:42",
  laneRef: descriptor.laneRef,
  laneGeneration: descriptor.generation,
  operation: "status",
  outcome: "unavailable",
  state: "unavailable",
  observedAt: "2026-08-26T17:03:00.000Z",
  payload: null,
  sourceRefs: [],
  grantsWorkAuthority: false,
  authorizesWorkDispatch: false,
} as const;

function errorText(operation: () => unknown): string {
  try {
    operation();
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function throwingProxy<T extends object>(
  target: T,
  trap: "getPrototypeOf" | "ownKeys" | "getOwnPropertyDescriptor",
): T {
  const handler: ProxyHandler<T> = {};
  if (trap === "getPrototypeOf") {
    handler.getPrototypeOf = () => {
      throw new Error("PRIVATE application-lane getPrototypeOf trap");
    };
  } else if (trap === "ownKeys") {
    handler.ownKeys = () => {
      throw new Error("PRIVATE application-lane ownKeys trap");
    };
  } else {
    handler.getOwnPropertyDescriptor = () => {
      throw new Error("PRIVATE application-lane descriptor trap");
    };
  }
  return new Proxy(target, handler);
}

describe("application lane contract", () => {
  it("keeps durable lane identity independent from browser projection identity", () => {
    const parsed = parseApplicationLaneDescriptorV1(descriptor);

    expect(parsed).toMatchObject({
      laneRef: "elatura:lane:chat-a",
      generation: 7,
      state: "active",
      adapter: { id: "chatgpt", version: "1" },
    });
    expect(parsed.capabilities).toEqual(["activate", "events", "observe", "screenshot"]);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.capabilities)).toBe(true);

    expect(() => parseApplicationLaneDescriptorV1({ ...descriptor, tabId: 123 })).toThrow(
      "unsupported field tabId",
    );
  });

  it("uses the product signal vocabulary with explicit confidence and freshness", () => {
    expect(parseApplicationLaneEventV1({
      ...event,
      eventType: "possible_completion",
      confidence: "probable",
    })).toMatchObject({
      eventType: "possible_completion",
      confidence: "probable",
      freshness: "fresh",
    });
    expect(parseApplicationLaneEventV1({
      ...event,
      eventType: "discarded_or_unavailable",
      freshness: "stale",
    })).toMatchObject({
      eventType: "discarded_or_unavailable",
      freshness: "stale",
    });
  });

  it("makes browser events explicitly authority-free", () => {
    expect(parseApplicationLaneEventV1(event)).toMatchObject({
      laneRef: descriptor.laneRef,
      laneGeneration: 7,
      eventType: "changed",
      grantsWorkAuthority: false,
      authorizesWorkDispatch: false,
    });

    expect(() => parseApplicationLaneEventV1({ ...event, grantsWorkAuthority: true })).toThrow(
      "zero work authority",
    );
    expect(() => parseApplicationLaneEventV1({ ...event, authorizesWorkDispatch: true })).toThrow(
      "zero work dispatch",
    );
  });

  it("binds every operation to the durable lane generation", () => {
    const request = parseApplicationLaneRequestV1({
      version: 1,
      requestId: "request:observe:42",
      laneRef: descriptor.laneRef,
      laneGeneration: 7,
      operation: "observe",
      payload: {
        maxItems: 24,
        maxTextCodeUnits: 32_768,
        maxSerializedBytes: 65_536,
      },
    });

    expect(request).toMatchObject({
      laneRef: descriptor.laneRef,
      laneGeneration: 7,
      operation: "observe",
      payload: { maxItems: 24 },
    });
    expect(Object.isFrozen(request.payload)).toBe(true);
  });

  it("keeps selectors and browser handles outside operation payloads", () => {
    expect(() => parseApplicationLaneRequestV1({
      version: 1,
      requestId: "request:activate:42",
      laneRef: descriptor.laneRef,
      laneGeneration: 7,
      operation: "activate",
      payload: { tabId: 123 },
    })).toThrow("unsupported field tabId");

    expect(() => parseApplicationLaneRequestV1({
      version: 1,
      requestId: "request:observe:43",
      laneRef: descriptor.laneRef,
      laneGeneration: 7,
      operation: "observe",
      payload: {
        maxItems: 24,
        maxTextCodeUnits: 32_768,
        maxSerializedBytes: 65_536,
        selector: "[data-message-id]",
      },
    })).toThrow("unsupported field selector");
  });

  it("admits one bounded observation envelope without assigning work meaning", () => {
    const response = parseApplicationLaneResponseV1({
      version: 1,
      requestId: "request:observe:42",
      laneRef: descriptor.laneRef,
      laneGeneration: 7,
      operation: "observe",
      outcome: "ok",
      state: "active",
      observedAt: "2026-08-26T17:02:00.000Z",
      payload: {
        observationRef: "elatura:observation:43",
        freshness: "fresh",
        contentType: "application/elatura-observation+json",
        content: {
          entries: [{ kind: "status", text: "synthetic-current-region" }],
        },
        omitted: true,
        sourceRefs: ["elatura:representation:43"],
      },
      sourceRefs: ["elatura:observation:43"],
      grantsWorkAuthority: false,
      authorizesWorkDispatch: false,
    });

    expect(response).toMatchObject({
      outcome: "ok",
      operation: "observe",
      grantsWorkAuthority: false,
      authorizesWorkDispatch: false,
      payload: { observationRef: "elatura:observation:43", omitted: true },
    });
    expect(Object.isFrozen(response.payload)).toBe(true);
  });

  it("returns closed unavailable, drift, and recovery outcomes with no success payload", () => {
    for (const [outcome, state] of [
      ["unavailable", "unavailable"],
      ["drifted", "drifted"],
      ["recovery_needed", "recovery_needed"],
      ["unsupported", "active"],
    ] as const) {
      expect(parseApplicationLaneResponseV1({
        version: 1,
        requestId: `request:${outcome}:42`,
        laneRef: descriptor.laneRef,
        laneGeneration: 7,
        operation: "status",
        outcome,
        state,
        observedAt: "2026-08-26T17:03:00.000Z",
        payload: null,
        sourceRefs: [],
        grantsWorkAuthority: false,
        authorizesWorkDispatch: false,
      })).toMatchObject({ outcome, state, payload: null });
    }
  });

  it("represents screenshot and activation as receipts instead of browser handles", () => {
    const screenshot = parseApplicationLaneResponseV1({
      version: 1,
      requestId: "request:screenshot:42",
      laneRef: descriptor.laneRef,
      laneGeneration: 7,
      operation: "screenshot",
      outcome: "ok",
      state: "active",
      observedAt: "2026-08-26T17:04:00.000Z",
      payload: { screenshotRef: "elatura:screenshot:42", mediaType: "image/png", width: 1280, height: 720 },
      sourceRefs: ["elatura:projection-receipt:42"],
      grantsWorkAuthority: false,
      authorizesWorkDispatch: false,
    });
    const activation = parseApplicationLaneResponseV1({
      version: 1,
      requestId: "request:activate:42",
      laneRef: descriptor.laneRef,
      laneGeneration: 7,
      operation: "activate",
      outcome: "ok",
      state: "active",
      observedAt: "2026-08-26T17:04:01.000Z",
      payload: { receiptRef: "elatura:activation:42" },
      sourceRefs: ["elatura:projection-receipt:43"],
      grantsWorkAuthority: false,
      authorizesWorkDispatch: false,
    });

    expect(screenshot.payload).toMatchObject({ screenshotRef: "elatura:screenshot:42", width: 1280, height: 720 });
    expect(activation.payload).toEqual({ receiptRef: "elatura:activation:42" });
  });

  it("never executes caller accessors while parsing protocol objects", () => {
    let getterReads = 0;
    const hostile = { ...event } as Record<string, unknown>;
    Object.defineProperty(hostile, "eventType", {
      enumerable: true,
      get() {
        getterReads += 1;
        return "changed";
      },
    });

    expect(() => parseApplicationLaneEventV1(hostile)).toThrow("enumerable data properties");
    expect(getterReads).toBe(0);
  });

  it("contains top-level Proxy reflection failures for every public envelope", () => {
    const cases = [
      ["Application lane descriptor", parseApplicationLaneDescriptorV1, { ...descriptor }],
      ["Application lane event", parseApplicationLaneEventV1, { ...event }],
      ["Application lane request", parseApplicationLaneRequestV1, { ...statusRequest }],
      ["Application lane response", parseApplicationLaneResponseV1, { ...unavailableResponse }],
    ] as const;

    for (const [label, parser, value] of cases) {
      for (const trap of ["getPrototypeOf", "ownKeys", "getOwnPropertyDescriptor"] as const) {
        const text = errorText(() => parser(throwingProxy({ ...value }, trap) as never));
        expect(text).toContain(`${label} inspection failed`);
        expect(text).not.toContain("PRIVATE");
      }
    }
  });

  it("contains nested adapter and array inspection failures", () => {
    for (const trap of ["getPrototypeOf", "ownKeys", "getOwnPropertyDescriptor"] as const) {
      const adapterText = errorText(() =>
        parseApplicationLaneDescriptorV1({
          ...descriptor,
          adapter: throwingProxy({ ...descriptor.adapter }, trap),
        }),
      );
      expect(adapterText).toContain("Application adapter identity inspection failed");
      expect(adapterText).not.toContain("PRIVATE");
    }

    for (const trap of ["ownKeys", "getOwnPropertyDescriptor"] as const) {
      const capabilityText = errorText(() =>
        parseApplicationLaneDescriptorV1({
          ...descriptor,
          capabilities: throwingProxy([...descriptor.capabilities], trap),
        }),
      );
      expect(capabilityText).toContain("Lane capability list inspection failed");
      expect(capabilityText).not.toContain("PRIVATE");

      const sourceRefText = errorText(() =>
        parseApplicationLaneEventV1({
          ...event,
          sourceRefs: throwingProxy([...event.sourceRefs], trap),
        }),
      );
      expect(sourceRefText).toContain("Lane source references inspection failed");
      expect(sourceRefText).not.toContain("PRIVATE");
    }
  });

  it("derives array length from descriptors without invoking a Proxy get trap", () => {
    let capabilityLengthReads = 0;
    const capabilities = new Proxy(["events", "observe"] as const, {
      get(target, property, receiver) {
        if (property === "length") {
          capabilityLengthReads += 1;
          throw new Error("PRIVATE capability length get");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    expect(
      parseApplicationLaneDescriptorV1({ ...descriptor, capabilities }).capabilities,
    ).toEqual(["events", "observe"]);
    expect(capabilityLengthReads).toBe(0);

    let sourceRefLengthReads = 0;
    const sourceRefs = new Proxy(["elatura:signal:42"] as const, {
      get(target, property, receiver) {
        if (property === "length") {
          sourceRefLengthReads += 1;
          throw new Error("PRIVATE source-ref length get");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    expect(
      parseApplicationLaneEventV1({ ...event, sourceRefs }).sourceRefs,
    ).toEqual(["elatura:signal:42"]);
    expect(sourceRefLengthReads).toBe(0);
  });
});
