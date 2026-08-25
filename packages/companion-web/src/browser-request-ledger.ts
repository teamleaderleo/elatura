// SPDX-License-Identifier: MPL-2.0

/**
 * Separately bounded browser request/cache accounting.
 *
 * This ledger is independent of companion, client, and render state: it tracks
 * only the static surface's own protocol requests and their response-byte
 * footprint, with deterministic FIFO eviction and fixed refusal counters. It
 * retains entry keys, operation tokens, and byte counts only — never bodies,
 * headers, conversation content, or credentials.
 */
export type CompanionBrowserLedgerPolicy = Readonly<{
  maxLogEntries: number;
  maxCacheEntries: number;
  maxCacheEntryBytes: number;
  maxCacheTotalBytes: number;
}>;

export const DEFAULT_COMPANION_BROWSER_LEDGER_POLICY: CompanionBrowserLedgerPolicy =
  Object.freeze({
    maxLogEntries: 128,
    maxCacheEntries: 64,
    maxCacheEntryBytes: 2_097_152,
    maxCacheTotalBytes: 4_194_304,
  });

export type CompanionBrowserRequestRecord = Readonly<{
  entryKey: string;
  operationToken: string;
  requestBytes: number;
  responseBytes: number;
}>;

export type CompanionBrowserLedgerSnapshot = Readonly<{
  dispatchedRequestCount: number;
  completedRequestCount: number;
  failedRequestCount: number;
  cancelledRequestCount: number;
  refusedOverLimitRequestCount: number;
  cacheEntryCount: number;
  cacheTotalBytes: number;
  cacheEvictedEntryCount: number;
  logEntryCount: number;
}>;

const LEDGER_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function resolvePolicy(
  input: Partial<CompanionBrowserLedgerPolicy> | undefined,
): CompanionBrowserLedgerPolicy {
  const resolved = { ...DEFAULT_COMPANION_BROWSER_LEDGER_POLICY, ...input };
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`${name} must be a positive safe integer.`);
    }
  }
  return Object.freeze(resolved);
}

function validToken(value: unknown): value is string {
  return typeof value === "string" && LEDGER_TOKEN.test(value);
}

function validByteCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export class BoundedBrowserRequestLedger {
  readonly #policy: CompanionBrowserLedgerPolicy;
  readonly #cache = new Map<string, number>();
  readonly #log: CompanionBrowserRequestRecord[] = [];
  #dispatchedRequestCount = 0;
  #completedRequestCount = 0;
  #failedRequestCount = 0;
  #cancelledRequestCount = 0;
  #refusedOverLimitRequestCount = 0;
  #cacheEvictedEntryCount = 0;

  constructor(policy?: Partial<CompanionBrowserLedgerPolicy>) {
    this.#policy = resolvePolicy(policy);
  }

  get snapshot(): CompanionBrowserLedgerSnapshot {
    return Object.freeze({
      dispatchedRequestCount: this.#dispatchedRequestCount,
      completedRequestCount: this.#completedRequestCount,
      failedRequestCount: this.#failedRequestCount,
      cancelledRequestCount: this.#cancelledRequestCount,
      refusedOverLimitRequestCount: this.#refusedOverLimitRequestCount,
      cacheEntryCount: this.#cache.size,
      cacheTotalBytes: this.#cacheTotalBytes(),
      cacheEvictedEntryCount: this.#cacheEvictedEntryCount,
      logEntryCount: this.#log.length,
    });
  }

  /**
   * Records one settled request. Invalid identifiers or negative/unsafe byte
   * counts return false and nothing is counted or logged. A valid record is
   * always logged and counted as dispatched; when its byte footprint exceeds
   * the per-entry cache bound it increments refusedOverLimitRequestCount and
   * returns true WITHOUT entering the cache (the request did settle, it was
   * only too large to cache). Otherwise the footprint is admitted into the
   * bounded FIFO cache and the request counts as completed.
   */
  recordCompletedRequest(
    entryKey: string,
    operationToken: string,
    requestBytes: number,
    responseBytes: number,
  ): boolean {
    if (
      !validToken(entryKey) ||
      !validToken(operationToken) ||
      !validByteCount(requestBytes) ||
      !validByteCount(responseBytes)
    ) {
      return false;
    }
    this.#dispatchedRequestCount += 1;
    this.#pushLog(entryKey, operationToken, requestBytes, responseBytes);
    if (
      responseBytes > this.#policy.maxCacheEntryBytes ||
      requestBytes > this.#policy.maxCacheEntryBytes
    ) {
      this.#refusedOverLimitRequestCount += 1;
      return true;
    }
    this.#admitCache(entryKey, responseBytes);
    this.#completedRequestCount += 1;
    return true;
  }

  recordFailedRequest(operationToken: string): void {
    this.#dispatchedRequestCount += 1;
    this.#failedRequestCount += 1;
    if (validToken(operationToken)) {
      this.#pushLog("failed", operationToken, 0, 0);
    }
  }

  recordCancelledRequest(operationToken: string): void {
    this.#dispatchedRequestCount += 1;
    this.#cancelledRequestCount += 1;
    if (validToken(operationToken)) {
      this.#pushLog("cancelled", operationToken, 0, 0);
    }
  }

  /** Clears volatile request-log and cached byte counts; counters remain. */
  resetVolatileState(): void {
    this.#cache.clear();
    this.#log.length = 0;
  }

  #pushLog(
    entryKey: string,
    operationToken: string,
    requestBytes: number,
    responseBytes: number,
  ): void {
    this.#log.push(
      Object.freeze({ entryKey, operationToken, requestBytes, responseBytes }),
    );
    while (this.#log.length > this.#policy.maxLogEntries) {
      this.#log.shift();
    }
  }

  #admitCache(entryKey: string, responseBytes: number): void {
    const previous = this.#cache.get(entryKey);
    if (previous !== undefined) {
      this.#cache.delete(entryKey);
    }
    this.#cache.set(entryKey, responseBytes);
    let total = this.#cacheTotalBytes();
    while (total > this.#policy.maxCacheTotalBytes || this.#cache.size > this.#policy.maxCacheEntries) {
      const oldest = this.#cache.keys().next();
      if (oldest.done) break;
      const evicted = this.#cache.get(oldest.value)!;
      this.#cache.delete(oldest.value);
      total -= evicted;
      this.#cacheEvictedEntryCount += 1;
    }
  }

  #cacheTotalBytes(): number {
    let total = 0;
    for (const bytes of this.#cache.values()) total += bytes;
    return total;
  }
}
