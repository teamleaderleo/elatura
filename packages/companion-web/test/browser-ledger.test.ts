// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  BoundedBrowserRequestLedger,
  DEFAULT_COMPANION_BROWSER_LEDGER_POLICY,
} from "../src/browser-request-ledger.js";

describe("BoundedBrowserRequestLedger", () => {
  it("records completed requests and admits bounded cache entries", () => {
    const ledger = new BoundedBrowserRequestLedger();
    expect(
      ledger.recordCompletedRequest("web-1", "op-list", 128, 2_048),
    ).toBe(true);
    const snapshot = ledger.snapshot;
    expect(snapshot.dispatchedRequestCount).toBe(1);
    expect(snapshot.completedRequestCount).toBe(1);
    expect(snapshot.cacheEntryCount).toBe(1);
    expect(snapshot.cacheTotalBytes).toBe(2_048);
    expect(snapshot.logEntryCount).toBe(1);
  });

  it("evicts the oldest entry deterministically when the entry cap is hit", () => {
    const ledger = new BoundedBrowserRequestLedger({ maxCacheEntries: 3 });
    for (let index = 0; index < 4; index += 1) {
      ledger.recordCompletedRequest(`web-${index}`, "op-open", 16, 64);
    }
    const snapshot = ledger.snapshot;
    expect(snapshot.completedRequestCount).toBe(4);
    expect(snapshot.cacheEntryCount).toBe(3);
    expect(snapshot.cacheEvictedEntryCount).toBe(1);
    expect(snapshot.logEntryCount).toBe(4);
  });

  it("enforces the total byte bound with FIFO eviction", () => {
    const ledger = new BoundedBrowserRequestLedger({
      maxCacheEntries: 16,
      maxCacheTotalBytes: 300,
      maxCacheEntryBytes: 256,
    });
    ledger.recordCompletedRequest("web-a", "op-page", 8, 100);
    ledger.recordCompletedRequest("web-b", "op-page", 8, 150);
    ledger.recordCompletedRequest("web-c", "op-page", 8, 200);
    const snapshot = ledger.snapshot;
    expect(snapshot.cacheEvictedEntryCount).toBeGreaterThanOrEqual(1);
    expect(snapshot.cacheTotalBytes).toBeLessThanOrEqual(300);
  });

  it("refuses oversized entries into a fixed refusal counter without caching", () => {
    const ledger = new BoundedBrowserRequestLedger({ maxCacheEntryBytes: 64 });
    expect(
      ledger.recordCompletedRequest("web-big", "op-search", 16, 65),
    ).toBe(true);
    const snapshot = ledger.snapshot;
    expect(snapshot.refusedOverLimitRequestCount).toBe(1);
    expect(snapshot.cacheEntryCount).toBe(0);
    expect(snapshot.dispatchedRequestCount).toBe(1);
    expect(snapshot.logEntryCount).toBe(1);
  });

  it("rejects hostile identifiers and negative byte counts outright", () => {
    const ledger = new BoundedBrowserRequestLedger();
    expect(ledger.recordCompletedRequest("../escape", "op-list", 1, 1)).toBe(false);
    expect(ledger.recordCompletedRequest("web-1", "not a token", 1, 1)).toBe(false);
    expect(ledger.recordCompletedRequest("web-1", "op-list", -1, 1)).toBe(false);
    expect(ledger.recordCompletedRequest("web-1", "op-list", 1, Number.NaN)).toBe(false);
    expect(ledger.snapshot.dispatchedRequestCount).toBe(0);
    expect(ledger.snapshot.cacheEntryCount).toBe(0);
  });

  it("tracks failed and cancelled requests with zero-byte log rows", () => {
    const ledger = new BoundedBrowserRequestLedger();
    ledger.recordFailedRequest("op-code");
    ledger.recordCancelledRequest("op-timeline");
    const snapshot = ledger.snapshot;
    expect(snapshot.failedRequestCount).toBe(1);
    expect(snapshot.cancelledRequestCount).toBe(1);
    expect(snapshot.dispatchedRequestCount).toBe(2);
    expect(snapshot.logEntryCount).toBe(2);
  });

  it("bounds the request log ring independently of traffic volume", () => {
    const ledger = new BoundedBrowserRequestLedger({ maxLogEntries: 5 });
    for (let index = 0; index < 40; index += 1) {
      ledger.recordFailedRequest(`op-cycle-${index % 4}`);
    }
    const snapshot = ledger.snapshot;
    expect(snapshot.logEntryCount).toBe(5);
    expect(snapshot.dispatchedRequestCount).toBe(40);
  });

  it("clears volatile state while keeping monotonic counters", () => {
    const ledger = new BoundedBrowserRequestLedger();
    ledger.recordCompletedRequest("web-1", "op-list", 32, 512);
    const before = ledger.snapshot;
    ledger.resetVolatileState();
    const after = ledger.snapshot;
    expect(after.cacheEntryCount).toBe(0);
    expect(after.cacheTotalBytes).toBe(0);
    expect(after.logEntryCount).toBe(0);
    expect(after.dispatchedRequestCount).toBe(before.dispatchedRequestCount);
    expect(after.completedRequestCount).toBe(before.completedRequestCount);
  });

  it("validates policy values strictly", () => {
    expect(() => new BoundedBrowserRequestLedger({ maxCacheEntries: 0 })).toThrow(RangeError);
    expect(() => new BoundedBrowserRequestLedger({ maxLogEntries: 1.5 })).toThrow(RangeError);
    expect(DEFAULT_COMPANION_BROWSER_LEDGER_POLICY.maxCacheEntries).toBeGreaterThan(0);
  });
});
