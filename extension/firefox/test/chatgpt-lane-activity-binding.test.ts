// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  FirefoxChatGptActivityBindingRuntimeV1,
  type FirefoxChatGptActivityResponseEnvelopeV1,
} from "../src/chatgpt-lane-activity-binding.js";
import type { FirefoxChatGptLaneActivityObservationV1 } from "../src/chatgpt-lane-activity-producer.js";

const TARGET = Object.freeze({ laneRef: "elatura:lane:firefox-a", laneGeneration: 7 });
const NEXT = Object.freeze({ laneRef: TARGET.laneRef, laneGeneration: 8 });
const OTHER = Object.freeze({ laneRef: "elatura:lane:firefox-b", laneGeneration: 1 });
const REF_A = "11111111-1111-4111-8111-111111111111";
const REF_B = "22222222-2222-4222-8222-222222222222";

function observation(target = TARGET): FirefoxChatGptLaneActivityObservationV1 {
  return Object.freeze({
    version: 1,
    laneRef: target.laneRef,
    laneGeneration: target.laneGeneration,
    observedAtMs: 1_000,
    source: "reviewed-live-sentinel",
    confidence: "probable",
    generation: "inactive",
    composer: "clean",
    composition: "inactive",
    modal: "inactive",
    mediaOrDevice: "unknown",
    download: "unknown",
    otherTransient: "unknown",
    grantsWorkAuthority: false,
    authorizesWorkDispatch: false,
  });
}

function envelope(
  projectionRef = REF_A,
  value = observation(),
): FirefoxChatGptActivityResponseEnvelopeV1 {
  return Object.freeze({ projectionRef, observation: value });
}

describe("Firefox ChatGPT activity projection binding", () => {
  it("samples only the exact bound current tab projection", async () => {
    const runtime = new FirefoxChatGptActivityBindingRuntimeV1();
    runtime.registerProjection(17, REF_A);
    expect(runtime.bind(TARGET, 17, REF_A)).toMatchObject({ status: "bound" });

    const calls: unknown[] = [];
    const result = await runtime.sample(TARGET, async (tabId, projectionRef, target) => {
      calls.push([tabId, projectionRef, target]);
      return envelope();
    });

    expect(calls).toEqual([[17, REF_A, TARGET]]);
    expect(result.receipt).toMatchObject({
      status: "observed",
      grantsWorkAuthority: false,
      authorizesWorkDispatch: false,
    });
    expect(result.observation).toEqual(observation());
  });

  it("refuses a lane bind to a stale or wrong tab projection", () => {
    const runtime = new FirefoxChatGptActivityBindingRuntimeV1();
    runtime.registerProjection(17, REF_A);
    expect(runtime.bind(TARGET, 18, REF_A)).toMatchObject({ status: "stale_projection" });
    expect(runtime.bind(TARGET, 17, REF_B)).toMatchObject({ status: "stale_projection" });
  });

  it("makes a higher generation an unbound tombstone before a replacement projection is trusted", async () => {
    const runtime = new FirefoxChatGptActivityBindingRuntimeV1();
    runtime.registerProjection(17, REF_A);
    expect(runtime.bind(TARGET, 17, REF_A)).toMatchObject({ status: "bound" });
    expect(runtime.observeTarget(NEXT)).toMatchObject({ status: "unbound" });
    expect(runtime.bind(TARGET, 17, REF_A)).toMatchObject({ status: "stale_generation" });

    let called = false;
    const stale = await runtime.sample(TARGET, async () => {
      called = true;
      return envelope();
    });
    expect(stale.receipt.status).toBe("stale_generation");
    expect(called).toBe(false);
  });

  it("invalidates a same-tab binding when a new content-document projection registers", async () => {
    const runtime = new FirefoxChatGptActivityBindingRuntimeV1();
    runtime.registerProjection(17, REF_A);
    runtime.bind(TARGET, 17, REF_A);
    runtime.registerProjection(17, REF_B);

    const result = await runtime.sample(TARGET, async () => envelope());
    expect(result.receipt.status).toBe("unbound");
    expect(runtime.currentProjection(17)).toBe(REF_B);
  });

  it("refuses one current projection being owned by two lanes", () => {
    const runtime = new FirefoxChatGptActivityBindingRuntimeV1();
    runtime.registerProjection(17, REF_A);
    expect(runtime.bind(TARGET, 17, REF_A).status).toBe("bound");
    expect(runtime.bind(OTHER, 17, REF_A).status).toBe("projection_in_use");
  });

  it("drops an in-flight sample when the projection changes before the reply resolves", async () => {
    const runtime = new FirefoxChatGptActivityBindingRuntimeV1();
    runtime.registerProjection(17, REF_A);
    runtime.bind(TARGET, 17, REF_A);

    let resolveResponse!: (value: unknown) => void;
    const pending = runtime.sample(
      TARGET,
      () => new Promise((resolve) => {
        resolveResponse = resolve;
      }),
    );
    runtime.registerProjection(17, REF_B);
    resolveResponse(envelope());

    const result = await pending;
    expect(result.receipt.status).toBe("stale_projection");
    expect(result.observation).toBeNull();
  });

  it("refuses a reply that echoes a different projection or lane target", async () => {
    const runtime = new FirefoxChatGptActivityBindingRuntimeV1();
    runtime.registerProjection(17, REF_A);
    runtime.bind(TARGET, 17, REF_A);

    const wrongProjection = await runtime.sample(TARGET, async () => envelope(REF_B));
    expect(wrongProjection.receipt.status).toBe("response_mismatch");

    const wrongLane = await runtime.sample(
      TARGET,
      async () => envelope(REF_A, observation(OTHER)),
    );
    expect(wrongLane.receipt.status).toBe("response_mismatch");
  });

  it("rejects decorated content-bearing replies and accessor-backed sentinel fields", async () => {
    const runtime = new FirefoxChatGptActivityBindingRuntimeV1();
    runtime.registerProjection(17, REF_A);
    runtime.bind(TARGET, 17, REF_A);

    const decorated = { ...observation(), transcriptText: "synthetic-private-canary" };
    const decoratedResult = await runtime.sample(TARGET, async () => ({
      projectionRef: REF_A,
      observation: decorated,
    }));
    expect(decoratedResult.receipt.status).toBe("response_mismatch");
    expect(JSON.stringify(decoratedResult)).not.toContain("synthetic-private-canary");

    let reads = 0;
    const hostile = { ...observation() } as Record<string, unknown>;
    Object.defineProperty(hostile, "laneRef", {
      enumerable: true,
      get() {
        reads += 1;
        return TARGET.laneRef;
      },
    });
    const hostileResult = await runtime.sample(TARGET, async () => ({
      projectionRef: REF_A,
      observation: hostile,
    }));
    expect(hostileResult.receipt.status).toBe("response_mismatch");
    expect(reads).toBe(0);
  });

  it("clears all currentness on runtime restart", async () => {
    const runtime = new FirefoxChatGptActivityBindingRuntimeV1();
    runtime.registerProjection(17, REF_A);
    runtime.bind(TARGET, 17, REF_A);
    runtime.clear();

    expect(runtime.currentProjection(17)).toBeNull();
    const result = await runtime.sample(TARGET, async () => envelope());
    expect(result.receipt.status).toBe("stale_generation");
  });
});
