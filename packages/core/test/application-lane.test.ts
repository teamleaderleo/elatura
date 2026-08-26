// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  bindApplicationLaneProjection,
  createApplicationLane,
  loseApplicationLaneProjection,
  updateApplicationLaneProjectionState,
} from "../src/application-lane.js";

describe("application lane projection state", () => {
  it("preserves logical lane identity across projection loss and recovery", () => {
    const created = createApplicationLane({
      laneKey: "lane.chatgpt.001",
      applicationClass: "chatgpt",
      targetToken: "target.conv.001",
    });
    const first = bindApplicationLaneProjection(created, {
      projectionToken: "projection.local.001",
      browserClass: "gecko",
    });
    const lost = loseApplicationLaneProjection(first, "restart");
    const recovered = bindApplicationLaneProjection(lost, {
      projectionToken: "projection.local.002",
      browserClass: "gecko",
      state: "background",
    });

    expect(recovered.laneKey).toBe(created.laneKey);
    expect(recovered.targetToken).toBe(created.targetToken);
    expect(recovered.projection?.generation).toBe(2);
    expect(recovered.projection?.projectionToken).toBe("projection.local.002");
    expect(recovered.pendingRecovery).toBe(false);
    expect(recovered.availability).toBe("available");
    expect(recovered.projectionStats).toEqual({
      bindings: 2,
      replacements: 1,
      losses: 1,
      recoveries: 1,
    });
  });

  it("keeps parking and discard state on the projection rather than lane identity", () => {
    const lane = bindApplicationLaneProjection(
      createApplicationLane({
        laneKey: "lane.docs.001",
        applicationClass: "google-docs",
      }),
      { projectionToken: "projection.docs.001", browserClass: "chromium" },
    );
    const parked = updateApplicationLaneProjectionState(lane, "parked");
    expect(parked.laneKey).toBe(lane.laneKey);
    expect(parked.availability).toBe("parked");
    expect(parked.projection?.state).toBe("parked");

    const discarded = updateApplicationLaneProjectionState(parked, "discarded");
    expect(discarded.availability).toBe("discarded");
    expect(discarded.projectionGeneration).toBe(1);
  });

  it("requires a fresh opaque projection token for each replacement", () => {
    const lane = bindApplicationLaneProjection(
      createApplicationLane({
        laneKey: "lane.chat.002",
        applicationClass: "chatgpt",
      }),
      { projectionToken: "projection.same", browserClass: "gecko" },
    );
    expect(() =>
      bindApplicationLaneProjection(lane, {
        projectionToken: "projection.same",
        browserClass: "gecko",
      }),
    ).toThrow(/must change/u);
  });

  it("refuses URL-like or whitespace-bearing lane identity tokens", () => {
    expect(() =>
      createApplicationLane({
        laneKey: "https://chatgpt.com/c/private",
        applicationClass: "chatgpt",
      }),
    ).toThrow(/opaque token/u);
    expect(() =>
      createApplicationLane({
        laneKey: "lane ok",
        applicationClass: "chatgpt",
      }),
    ).toThrow(/opaque token/u);
  });
});
