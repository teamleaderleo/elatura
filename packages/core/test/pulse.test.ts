// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  BoundedPulseReportLedger,
  PULSE_PROTOCOL_VERSION,
  decidePulseRetry,
  parsePulseDefinitions,
  planPulseDispatches,
  pulseDueAt,
  pulseRepositoryKey,
  pulseWindow,
  type PulseDefinition,
  type PulseJob,
} from "../src/pulse.js";

function definition(
  overrides: Partial<PulseDefinition> = {},
): PulseDefinition {
  return {
    id: "repo-maintenance",
    enabled: true,
    cadenceMs: 60_000,
    jitterMs: 0,
    promptVariants: [
      { id: "advance", text: "Inspect the repository and advance the most useful open work." },
      { id: "research", text: "Research one blocker and publish a concise terminal report." },
    ],
    repositoryAllowlist: [
      { owner: "teamleaderleo", name: "elatura", ref: "main" },
      { owner: "teamleaderleo", name: "fieldwork", ref: "main" },
    ],
    provider: { id: "synthetic-provider", version: "1" },
    maxConcurrentJobs: 1,
    dailyRequestBudget: 8,
    ...overrides,
  };
}

function job(
  state: PulseJob["state"],
  revision: number,
  overrides: Partial<PulseJob> = {},
): PulseJob {
  const terminal = ["complete", "incomplete", "failed", "cancelled"].includes(state);
  return {
    version: PULSE_PROTOCOL_VERSION,
    id: `job-${revision}`,
    pulseId: "repo-maintenance",
    revision,
    idempotencyKey: `pulse-v1:repo-maintenance:${revision}:abcd1234`,
    repository: { owner: "teamleaderleo", name: "elatura", ref: "main" },
    baseRevision: "9108e506cc18876b11100ead1d522a0a4b167c61",
    provider: { id: "synthetic-provider", version: "1" },
    promptVariantId: "advance",
    state,
    attempt: 1,
    startedAt: 100,
    lastHeartbeatAt: 110,
    completedAt: terminal ? 120 : null,
    retryAfter: null,
    terminalReport: state === "complete" ? "Implemented the bounded pulse core and passed tests." : null,
    artifactReferences:
      state === "complete"
        ? [{ kind: "pull-request", value: "https://github.com/teamleaderleo/elatura/pull/91" }]
        : [],
    usage: { requests: 1, inputTokens: 10, outputTokens: 20, costMicros: 30 },
    ...overrides,
  };
}

describe("pulse definition admission", () => {
  it("copies exact bounded definitions without invoking accessors", () => {
    let invoked = false;
    const hostile = Object.defineProperty(
      { ...definition() },
      "provider",
      {
        enumerable: true,
        get() {
          invoked = true;
          return { id: "hostile", version: "1" };
        },
      },
    );

    expect(() => parsePulseDefinitions([hostile])).toThrow(/own data|bounded/u);
    expect(invoked).toBe(false);
  });

  it("rejects duplicate prompt ids and jitter outside cadence", () => {
    expect(() =>
      parsePulseDefinitions([
        definition({
          promptVariants: [
            { id: "same", text: "one" },
            { id: "same", text: "two" },
          ],
        }),
      ]),
    ).toThrow(/bounded/u);

    expect(() =>
      parsePulseDefinitions([definition({ jitterMs: 60_000 })]),
    ).toThrow(/jitter/u);
  });
});

describe("pulse planning", () => {
  it("selects repository and prompt deterministically for one window", () => {
    const definitions = [definition()];
    const first = planPulseDispatches(definitions, { now: 120_000 });
    const second = planPulseDispatches(definitions, { now: 120_000 });

    expect(first).toEqual(second);
    expect(first.dispatches).toHaveLength(1);
    expect(first.dispatches[0]).toMatchObject({
      pulseId: "repo-maintenance",
      window: 2,
      dueAt: 120_000,
      provider: { id: "synthetic-provider", version: "1" },
    });
    expect(first.dispatches[0]?.prompt.length).toBeGreaterThan(0);
    expect(first.dispatches[0]?.idempotencyKey).toMatch(/^pulse-v1:/u);
  });

  it("suppresses duplicate windows and creates zero additional dispatches", () => {
    const first = planPulseDispatches([definition()], { now: 180_000 });
    const key = first.dispatches[0]?.idempotencyKey;
    expect(key).toBeDefined();

    const repeated = planPulseDispatches([definition()], {
      now: 180_000,
      dispatchedIdempotencyKeys: key ? [key] : [],
    });
    expect(repeated.dispatches).toHaveLength(0);
    expect(repeated.deferred).toEqual([
      { pulseId: "repo-maintenance", reason: "already-dispatched" },
    ]);
  });

  it("enforces pulse, provider, repository, global, and daily limits", () => {
    const selected = planPulseDispatches([definition()], { now: 240_000 }).dispatches[0];
    expect(selected).toBeDefined();
    const repositoryKey = selected
      ? pulseRepositoryKey(selected.repository)
      : "teamleaderleo/elatura@main";

    const pulseBlocked = planPulseDispatches([definition()], {
      now: 240_000,
      activeJobs: [
        {
          pulseId: "repo-maintenance",
          providerId: "synthetic-provider",
          repositoryKey,
        },
      ],
    });
    expect(pulseBlocked.deferred[0]?.reason).toBe("pulse-concurrency");

    const budgetBlocked = planPulseDispatches([definition()], {
      now: 240_000,
      dailyUsage: [{ pulseId: "repo-maintenance", requestCount: 8 }],
    });
    expect(budgetBlocked.deferred[0]?.reason).toBe("daily-budget");

    const providerBlocked = planPulseDispatches(
      [definition({ maxConcurrentJobs: 2 })],
      {
        now: 240_000,
        activeJobs: [
          {
            pulseId: "another-pulse",
            providerId: "synthetic-provider",
            repositoryKey: "other/repo@main",
          },
        ],
      },
      { maxProviderActiveJobs: 1 },
    );
    expect(providerBlocked.deferred[0]?.reason).toBe("provider-concurrency");

    const repositoryBlocked = planPulseDispatches(
      [definition({ maxConcurrentJobs: 2 })],
      {
        now: 240_000,
        activeJobs: [
          {
            pulseId: "another-pulse",
            providerId: "other-provider",
            repositoryKey,
          },
        ],
      },
      { maxRepositoryActiveJobs: 1 },
    );
    expect(repositoryBlocked.deferred[0]?.reason).toBe("repository-concurrency");

    const globalBlocked = planPulseDispatches(
      [definition({ maxConcurrentJobs: 2 })],
      {
        now: 240_000,
        activeJobs: [
          {
            pulseId: "another-pulse",
            providerId: "other-provider",
            repositoryKey: "other/repo@main",
          },
        ],
      },
      { maxActiveJobs: 1 },
    );
    expect(globalBlocked.deferred[0]?.reason).toBe("global-concurrency");
  });

  it("uses bounded deterministic jitter", () => {
    const parsed = parsePulseDefinitions([
      definition({ cadenceMs: 120_000, jitterMs: 30_000 }),
    ])[0];
    expect(parsed).toBeDefined();
    if (!parsed) return;

    const window = pulseWindow(parsed, 240_000);
    const dueAt = pulseDueAt(parsed, window);
    expect(window).toBe(2);
    expect(dueAt).toBeGreaterThanOrEqual(240_000);
    expect(dueAt).toBeLessThan(270_001);
    expect(pulseDueAt(parsed, window)).toBe(dueAt);
  });
});

describe("pulse retry decisions", () => {
  it("honors bounded provider retry-after exactly", () => {
    expect(decidePulseRetry(10_000, 1, 12_345)).toEqual({
      action: "retry",
      retryAt: 22_345,
    });
  });

  it("uses bounded exponential retry and pauses at hard limits", () => {
    expect(
      decidePulseRetry(10_000, 3, null, {
        minRetryMs: 1_000,
        maxRetryMs: 10_000,
      }),
    ).toEqual({ action: "retry", retryAt: 14_000 });

    expect(decidePulseRetry(10_000, 8, null)).toEqual({
      action: "pause",
      reason: "attempt-limit",
    });
    expect(
      decidePulseRetry(10_000, 1, 100_001, { maxRetryMs: 100_000 }),
    ).toEqual({ action: "pause", reason: "retry-after-limit" });
  });
});

describe("bounded pulse report ledger", () => {
  it("retains one active and one latest terminal job per lane", () => {
    const ledger = new BoundedPulseReportLedger();
    expect(ledger.publish(job("running", 1)).applied).toBe(true);
    expect(ledger.snapshot.lanes[0]).toMatchObject({
      pulseId: "repo-maintenance",
      active: { revision: 1, state: "running" },
      latestTerminal: null,
    });

    expect(ledger.publish(job("complete", 1)).applied).toBe(true);
    expect(ledger.snapshot.lanes[0]).toMatchObject({
      active: null,
      latestTerminal: {
        revision: 1,
        state: "complete",
        terminalReport: "Implemented the bounded pulse core and passed tests.",
      },
    });

    expect(ledger.publish(job("running", 1)).applied).toBe(false);
    expect(ledger.snapshot.lanes[0]?.active).toBeNull();

    expect(ledger.publish(job("running", 2)).applied).toBe(true);
    expect(ledger.snapshot.lanes[0]).toMatchObject({
      active: { revision: 2, state: "running" },
      latestTerminal: { revision: 1, state: "complete" },
    });

    expect(ledger.publish(job("failed", 2)).applied).toBe(true);
    expect(ledger.snapshot.lanes[0]).toMatchObject({
      active: null,
      latestTerminal: { revision: 2, state: "failed" },
    });
  });

  it("returns cloned snapshots and enforces report and lane bounds", () => {
    const ledger = new BoundedPulseReportLedger({
      maxLedgerLanes: 1,
      maxTerminalReportCodeUnits: 16,
    });
    ledger.publish(
      job("complete", 1, {
        terminalReport: "done",
        artifactReferences: [],
      }),
    );
    const snapshot = ledger.snapshot;
    const terminal = snapshot.lanes[0]?.latestTerminal;
    expect(terminal?.terminalReport).toBe("done");

    expect(() =>
      ledger.publish(
        job("complete", 2, {
          terminalReport: "this report exceeds sixteen code units",
        }),
      ),
    ).toThrow(/terminal report/u);

    expect(() =>
      ledger.publish(
        job("running", 1, {
          id: "job-other",
          pulseId: "other-pulse",
          idempotencyKey: "pulse-v1:other-pulse:1:abcd1234",
        }),
      ),
    ).toThrow(/lane limit/u);
  });
});
