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
});
