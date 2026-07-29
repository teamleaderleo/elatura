// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  createTransformOptInController,
  TRANSFORM_OPT_IN_ACKNOWLEDGEMENTS,
} from "../src/transform-opt-in.js";

describe("session-local transform opt-in intent", () => {
  it("starts unrecorded and can never authorize transformation", () => {
    const controller = createTransformOptInController();
    expect(controller.getState()).toEqual({
      schemaVersion: 1,
      recorded: false,
      reason: "build-default",
      generation: 0,
      acknowledgementCount: 0,
      authorizesTransform: false,
    });
  });

  it("requires the exact fixed acknowledgement set without free text", () => {
    const controller = createTransformOptInController();
    for (const invalid of [
      undefined,
      null,
      [],
      ["session-local-only"],
      [...TRANSFORM_OPT_IN_ACKNOWLEDGEMENTS, "extra"],
      [
        "session-local-only",
        "future-transform-risk",
        "private conversation title",
      ],
      [
        "session-local-only",
        "session-local-only",
        "emergency-disable-available",
      ],
    ]) {
      expect(() => controller.record(invalid)).toThrow(/exact fixed acknowledgement set/);
    }

    expect(
      controller.record([
        "emergency-disable-available",
        "session-local-only",
        "future-transform-risk",
      ]),
    ).toEqual({
      schemaVersion: 1,
      recorded: true,
      reason: "user-recorded",
      generation: 1,
      acknowledgementCount: 3,
      authorizesTransform: false,
    });
  });

  it("revokes intent through either user action or emergency disable", () => {
    const controller = createTransformOptInController();
    controller.record(TRANSFORM_OPT_IN_ACKNOWLEDGEMENTS);
    expect(controller.revoke("user-revoked")).toMatchObject({
      recorded: false,
      reason: "user-revoked",
      generation: 2,
      acknowledgementCount: 0,
      authorizesTransform: false,
    });
    controller.record(TRANSFORM_OPT_IN_ACKNOWLEDGEMENTS);
    expect(controller.revoke("emergency-disable")).toMatchObject({
      recorded: false,
      reason: "emergency-disable",
      generation: 4,
      acknowledgementCount: 0,
      authorizesTransform: false,
    });
  });
});
