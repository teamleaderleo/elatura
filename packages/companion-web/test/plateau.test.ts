// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLATEAU_HARD_BOUNDS,
  PLATEAU_TRACKED_FIELDS,
  evaluateWorkingSetPlateau,
} from "../src/plateau.js";
import {
  PLATEAU_HARD_BOUNDS as MANIFEST_BOUNDS,
  PLATEAU_SAMPLE_FIELDS,
} from "../../../benchmarks/src/companion-browser-manifest.js";

function sample(overrides: Record<string, number> = {}) {
  return Object.freeze({
    residentConversations: 1,
    residentRecords: 2,
    residentEntries: 50,
    renderedRows: 25,
    retainedClientRecords: 60,
    cacheEntries: 8,
    cacheBytes: 4_096,
    artifactBytes: 12_288,
    ...overrides,
  });
}

describe("working-set plateau evaluation", () => {
  it("accepts a stable bounded probe", () => {
    const samples = Array.from({ length: 8 }, () => sample());
    const verdict = evaluateWorkingSetPlateau(samples);
    expect(verdict.ok).toBe(true);
    expect(verdict.failures).toEqual([]);
    expect(verdict.secondHalfMaxima).toEqual(verdict.firstHalfMaxima);
  });

  it("fails any monotonic retained-state trend with a fixed code", () => {
    const samples = [1, 2, 3, 4, 5, 6].map((step) =>
      sample({ cacheBytes: 1_000 * step }),
    );
    const verdict = evaluateWorkingSetPlateau(samples, {
      hardBounds: { cacheBytes: Number.MAX_SAFE_INTEGER },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.failures).toContainEqual({ code: "monotonic-growth", field: "cacheBytes" });
  });

  it("fails counters beyond their hard bounds", () => {
    const samples = [
      sample({ residentConversations: DEFAULT_PLATEAU_HARD_BOUNDS.residentConversations + 1 }),
      sample(),
      sample(),
      sample(),
      sample(),
      sample(),
    ];
    const verdict = evaluateWorkingSetPlateau(samples);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures).toContainEqual({
      code: "over-hard-bound",
      field: "residentConversations",
    });
  });

  it("refuses probes with too few samples instead of guessing", () => {
    const verdict = evaluateWorkingSetPlateau([sample(), sample(), sample()]);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures[0]).toMatchObject({ code: "insufficient-samples" });
  });

  it("treats malformed sample rows as missing evidence", () => {
    const verdict = evaluateWorkingSetPlateau([
      { ...sample(), cacheBytes: -1 },
      sample(),
      sample(),
      sample(),
      sample(),
      sample(),
    ]);
    expect(verdict.ok).toBe(false);
    expect(verdict.failures[0]).toMatchObject({ code: "insufficient-samples" });
  });

  it("keeps the hard-bound table identical to the benchmark manifest contract", () => {
    expect([...PLATEAU_SAMPLE_FIELDS].sort()).toEqual(
      [...PLATEAU_TRACKED_FIELDS].sort(),
    );
    for (const field of PLATEAU_TRACKED_FIELDS) {
      expect(DEFAULT_PLATEAU_HARD_BOUNDS[field]).toBe(MANIFEST_BOUNDS[field]);
    }
  });
});
