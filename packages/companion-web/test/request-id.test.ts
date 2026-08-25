// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  COMPANION_REQUEST_ID_WIDTH,
  COMPANION_REQUEST_ORDINAL_LIMIT_CODE,
  COMPANION_REQUEST_ORDINAL_MAX,
  formatCompanionRequestId,
  nextCompanionRequestId,
} from "../src/request-id.js";

describe("companion web request-id wire format", () => {
  it("derives the maximum ordinal intrinsically from the six-digit width", () => {
    expect(COMPANION_REQUEST_ID_WIDTH).toBe(6);
    expect(COMPANION_REQUEST_ORDINAL_MAX).toBe(999_999);
    expect(COMPANION_REQUEST_ORDINAL_MAX).toBe(
      10 ** COMPANION_REQUEST_ID_WIDTH - 1,
    );
  });

  it("formats the first valid ordinal in the stable ordinary wire form", () => {
    expect(formatCompanionRequestId(1)).toBe("web-000001");
  });

  it("formats the last valid ordinal at exactly the wire width", () => {
    const requestId = formatCompanionRequestId(COMPANION_REQUEST_ORDINAL_MAX);
    expect(requestId).toBe("web-999999");
    expect(requestId).toMatch(/^web-[0-9]{6}$/u);
    expect(requestId?.length).toBe("web-".length + COMPANION_REQUEST_ID_WIDTH);
  });

  it("refuses the first invalid ordinal without wrapping, reusing, or widening", () => {
    const requestId = formatCompanionRequestId(COMPANION_REQUEST_ORDINAL_MAX + 1);
    expect(requestId).toBeNull();
    expect(formatCompanionRequestId(1_000_000)).toBeNull();
  });

  it("refuses zero, negative, fractional, and non-finite ordinals", () => {
    for (const ordinal of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatCompanionRequestId(ordinal)).toBeNull();
    }
  });

  it("keeps the id length identical across sampled digit boundaries", () => {
    // Sampled boundaries only: no million-iteration loop.
    const sampled = [
      1, 9, 10, 99, 100, 999, 1_000, 9_999, 10_000, 99_999, 100_000,
      COMPANION_REQUEST_ORDINAL_MAX,
    ];
    expect(sampled.at(-1)).toBe(999_999);
    const lengths = new Set(
      sampled.map((ordinal) => formatCompanionRequestId(ordinal)!.length),
    );
    expect(lengths).toEqual(new Set(["web-".length + COMPANION_REQUEST_ID_WIDTH]));
  });
});

describe("companion web request-id admission gate", () => {
  it("admits the final ordinal inside the lifetime bound", () => {
    expect(nextCompanionRequestId(COMPANION_REQUEST_ORDINAL_MAX - 1)).toEqual({
      ok: true,
      requestId: "web-999999",
    });
  });

  it("closes deterministically on the first ordinal beyond the bound", () => {
    expect(nextCompanionRequestId(COMPANION_REQUEST_ORDINAL_MAX)).toEqual({
      ok: false,
      code: COMPANION_REQUEST_ORDINAL_LIMIT_CODE,
    });
    expect(nextCompanionRequestId(Number.MAX_SAFE_INTEGER)).toEqual({
      ok: false,
      code: COMPANION_REQUEST_ORDINAL_LIMIT_CODE,
    });
  });
});
