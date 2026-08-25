// SPDX-License-Identifier: MPL-2.0

/**
 * Deterministic plateau evaluation for repeated conversation switching and
 * open/close probes.
 *
 * A probe passes only when every tracked counter stays inside its hard bound
 * and the second half of the samples never exceeds the first half. A monotonic
 * retained-state, rendered-row, artifact-byte, or cache trend therefore fails
 * with a fixed code instead of being narrated away.
 */
export const PLATEAU_TRACKED_FIELDS = [
  "residentConversations",
  "residentRecords",
  "residentEntries",
  "renderedRows",
  "retainedClientRecords",
  "cacheEntries",
  "cacheBytes",
  "artifactBytes",
] as const;

export type PlateauTrackedField = (typeof PLATEAU_TRACKED_FIELDS)[number];

export type CompanionPlateauSample = Readonly<
  Record<PlateauTrackedField, number>
>;

export const DEFAULT_PLATEAU_HARD_BOUNDS: Readonly<
  Record<PlateauTrackedField, number>
> = Object.freeze({
  residentConversations: 3,
  residentRecords: 8,
  residentEntries: 256,
  renderedRows: 50,
  retainedClientRecords: 209,
  cacheEntries: 64,
  cacheBytes: 4_194_304,
  artifactBytes: 2_097_152,
});

export type PlateauFailure = Readonly<{
  code: "insufficient-samples" | "over-hard-bound" | "monotonic-growth";
  field: string;
}>;

export type PlateauVerdict = Readonly<{
  ok: boolean;
  failures: readonly PlateauFailure[];
  firstHalfMaxima: Readonly<Record<PlateauTrackedField, number>>;
  secondHalfMaxima: Readonly<Record<PlateauTrackedField, number>>;
}>;

export type PlateauEvaluationOptions = Readonly<{
  minimumSamples?: number;
  hardBounds?: Partial<Record<PlateauTrackedField, number>>;
}>;

function isPlateauSample(value: unknown): value is CompanionPlateauSample {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return PLATEAU_TRACKED_FIELDS.every((field) => {
    const candidate = (value as Record<string, unknown>)[field];
    return (
      typeof candidate === "number" &&
      Number.isSafeInteger(candidate) &&
      candidate >= 0
    );
  });
}

export function evaluateWorkingSetPlateau(
  samples: readonly unknown[],
  options: PlateauEvaluationOptions = {},
): PlateauVerdict {
  const minimumSamples = options.minimumSamples ?? 6;
  const bounds = { ...DEFAULT_PLATEAU_HARD_BOUNDS, ...options.hardBounds };
  const valid = samples.filter(isPlateauSample);
  if (valid.length < minimumSamples || valid.length < 4) {
    return Object.freeze({
      ok: false,
      failures: Object.freeze([
        Object.freeze({
          code: "insufficient-samples" as const,
          field: `samples:${valid.length}`,
        }),
      ]),
      firstHalfMaxima: zeroMaxima(),
      secondHalfMaxima: zeroMaxima(),
    });
  }

  const half = Math.floor(valid.length / 2);
  const firstHalf = valid.slice(0, half);
  const secondHalf = valid.slice(half);
  const firstHalfMaxima = maximaOf(firstHalf);
  const secondHalfMaxima = maximaOf(secondHalf);

  const failures: PlateauFailure[] = [];
  for (const field of PLATEAU_TRACKED_FIELDS) {
    for (const sample of valid) {
      if (sample[field] > bounds[field]) {
        failures.push(Object.freeze({ code: "over-hard-bound", field }));
        break;
      }
    }
    if (secondHalfMaxima[field] > firstHalfMaxima[field]) {
      failures.push(Object.freeze({ code: "monotonic-growth", field }));
    }
  }

  return Object.freeze({
    ok: failures.length === 0,
    failures: Object.freeze(failures),
    firstHalfMaxima,
    secondHalfMaxima,
  });
}

function zeroMaxima(): Record<PlateauTrackedField, number> {
  return {
    residentConversations: 0,
    residentRecords: 0,
    residentEntries: 0,
    renderedRows: 0,
    retainedClientRecords: 0,
    cacheEntries: 0,
    cacheBytes: 0,
    artifactBytes: 0,
  };
}

function maximaOf(
  samples: readonly CompanionPlateauSample[],
): Record<PlateauTrackedField, number> {
  const maxima = zeroMaxima();
  for (const sample of samples) {
    for (const field of PLATEAU_TRACKED_FIELDS) {
      if (sample[field] > maxima[field]) maxima[field] = sample[field];
    }
  }
  return maxima;
}
