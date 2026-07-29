// SPDX-License-Identifier: MPL-2.0

export type VolatileTransformStateClearer = () => void;

const clearers = new Set<VolatileTransformStateClearer>();

export function registerVolatileTransformStateClearer(
  clearer: VolatileTransformStateClearer,
): () => void {
  if (typeof clearer !== "function") throw new TypeError("Volatile transform clearer must be a function.");
  clearers.add(clearer);
  return () => {
    clearers.delete(clearer);
  };
}

export function clearAllVolatileTransformState(): void {
  let failureCount = 0;
  for (const clearer of [...clearers]) {
    try {
      clearer();
    } catch {
      failureCount += 1;
    }
  }
  if (failureCount > 0) throw new Error("volatile-transform-clear-failed");
}

export function registeredVolatileTransformStateCount(): number {
  return clearers.size;
}
