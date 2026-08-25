// SPDX-License-Identifier: MPL-2.0

/**
 * Prescribed deterministic probe plans for the synthetic companion browser
 * surface (#83 benchmark packet).
 *
 * The page's switch and open/close probes share these exact loops, constants,
 * and transcript lines with the repository's integration tests, so the
 * documented procedure and the tested procedure cannot drift apart. Every
 * plan derives its emitted-sample cardinality from explicit constants and
 * refuses to run when that cardinality would fall outside the run-manifest
 * schema's admission window (`MINIMUM_PLATEAU_SAMPLES`..`MAXIMUM_PROBE_SAMPLES`),
 * so following the runbook can never produce artifacts that fail validation.
 *
 * Each probe also performs unrecorded warm-up repetitions until the browser
 * request ledger's bounded FIFO cache has reached its steady state, so the
 * recorded samples observe sustained behavior rather than measurement
 * start-up. Warm-up emits no samples and is bound in the transcript header.
 *
 * Sample transcription stays complete: one raw sample line per observation,
 * in order, plus a header that binds the exact round/cycle/sample counts.
 * The header is evidence; the final verdict line rendered by the page is a
 * human summary and never substitutes for the numbered lines.
 */
import {
  MINIMUM_PLATEAU_SAMPLES,
  type CompanionPlateauSample,
} from "./plateau.js";
import { DEFAULT_COMPANION_BROWSER_LEDGER_POLICY } from "./browser-request-ledger.js";

/**
 * Completed switching rounds in the prescribed switch probe. Each round opens
 * every served conversation exactly once and emits one raw sample per open,
 * so a single-conversation server emits 8 samples (>= 6 schema floor).
 */
export const SWITCH_PROBE_ROUNDS = 8;

/**
 * Completed open/close cycles in the prescribed open/close probe. Each cycle
 * emits exactly two raw samples (one after open, one after close), so the
 * probe always emits 32 samples (= schema ceiling, admissible).
 */
export const OPEN_CLOSE_PROBE_CYCLES = 16;

/** Raw samples emitted by one completed open/close cycle. */
export const SAMPLES_PER_OPEN_CLOSE_CYCLE = 2;

/**
 * Upper bound on recorded samples per probe in the shipped run-manifest
 * contract (schema `samples.maxItems`, mirrored by
 * `MAX_PROBE_SAMPLES` in benchmarks/src/companion-browser-manifest.ts; parity
 * is asserted by test).
 */
export const MAXIMUM_PROBE_SAMPLES = 32;

/**
 * Most conversations a single switch-probe run admits: at this count the
 * derived emission lands exactly on the schema ceiling. Serving more
 * conversations than this makes the prescribed probe refuse instead of
 * emitting an inadmissible artifact.
 */
export const MAX_SWITCH_PROBE_CONVERSATIONS =
  Math.floor(MAXIMUM_PROBE_SAMPLES / SWITCH_PROBE_ROUNDS);

/**
 * Unrecorded warm-up admissions exceed the browser request ledger's FIFO
 * cache capacity, so every recorded sample observes the cache at its bounded
 * steady state instead of its initial fill-up ramp. Without warm-up, an
 * honestly transcribed prescribed run would show monotonic cache growth that
 * reflects measurement start-up, not retained-state leakage.
 */
const WARMUP_ADMISSIONS = DEFAULT_COMPANION_BROWSER_LEDGER_POLICY.maxCacheEntries + 1;

/**
 * Warm-up opens for one switch-probe run: whole rounds over the conversation
 * list, so the recorded phase starts aligned with the warm-up's rotation and
 * each admission evicts a same-sized same-conversation entry.
 */
export function switchProbeWarmupOpens(conversationCount: number): number {
  if (!Number.isSafeInteger(conversationCount) || conversationCount < 1) {
    throw new TypeError(
      `switch probe requires a positive integer conversation count, received ${String(conversationCount)}.`,
    );
  }
  return Math.ceil(WARMUP_ADMISSIONS / conversationCount) * conversationCount;
}

/** Warm-up open/close cycles before the recorded cycles (two admissions each). */
export function openCloseProbeWarmupCycles(): number {
  return Math.ceil(WARMUP_ADMISSIONS / SAMPLES_PER_OPEN_CLOSE_CYCLE);
}

export type ProbeKind = "switch-probe" | "open-close-probe";

export type ProbePlan = Readonly<{
  kind: ProbeKind;
  /** Switch probe only: completed rounds over the served conversations. */
  rounds?: number;
  /** Switch probe only: conversations actually cycled per round. */
  conversations?: number;
  /** Unrecorded warm-up opens (switch) or cycles (open/close). */
  warmup?: number;
  /** Completed recorded probe repetitions; one cycle yields at most two samples. */
  cycles: number;
  /** Open/close probe only: raw samples per cycle (before/after pair). */
  samplesPerCycle?: number;
  /** Total raw samples the plan emits. */
  samples: number;
}>;

/**
 * Plans a switch probe for `conversationCount` served conversations and
 * refuses any configuration whose derived emission falls outside the
 * manifest schema admission window. One open is one cycle and emits exactly
 * one sample, so `cycles === samples` by construction.
 */
export function planSwitchProbe(conversationCount: number): ProbePlan {
  if (!Number.isSafeInteger(conversationCount) || conversationCount < 1) {
    throw new TypeError(
      `switch probe requires a positive integer conversation count, received ${String(conversationCount)}.`,
    );
  }
  const samples = SWITCH_PROBE_ROUNDS * conversationCount;
  if (
    samples < MINIMUM_PLATEAU_SAMPLES ||
    samples > MAXIMUM_PROBE_SAMPLES
  ) {
    throw new TypeError(
      `switch probe would emit ${samples} samples for ${conversationCount} conversation(s); ` +
        `the manifest contract admits ${MINIMUM_PLATEAU_SAMPLES}-${MAXIMUM_PROBE_SAMPLES}.`,
    );
  }
  return Object.freeze({
    kind: "switch-probe",
    rounds: SWITCH_PROBE_ROUNDS,
    conversations: conversationCount,
    warmup: switchProbeWarmupOpens(conversationCount),
    cycles: samples,
    samples,
  });
}

/**
 * Plans the prescribed open/close probe. The constant pair is chosen so the
 * derived emission lands exactly on the schema ceiling; the assertion below
 * keeps that binding true if either constant is ever retuned.
 */
export function planOpenCloseProbe(): ProbePlan {
  const samples = OPEN_CLOSE_PROBE_CYCLES * SAMPLES_PER_OPEN_CLOSE_CYCLE;
  if (
    samples < MINIMUM_PLATEAU_SAMPLES ||
    samples > MAXIMUM_PROBE_SAMPLES
  ) {
    throw new TypeError(
      `open/close probe would emit ${samples} samples; ` +
        `the manifest contract admits ${MINIMUM_PLATEAU_SAMPLES}-${MAXIMUM_PROBE_SAMPLES}.`,
    );
  }
  return Object.freeze({
    kind: "open-close-probe",
    cycles: OPEN_CLOSE_PROBE_CYCLES,
    samplesPerCycle: SAMPLES_PER_OPEN_CLOSE_CYCLE,
    warmup: openCloseProbeWarmupCycles(),
    samples,
  });
}

export type SwitchProbeIo<S extends CompanionPlateauSample> = Readonly<{
  conversationIds: readonly string[];
  openConversation: (conversationId: string) => Promise<void>;
  sampleWorkingSet: () => S;
}>;

export type OpenCloseProbeIo<S extends CompanionPlateauSample> = Readonly<{
  conversationId: string;
  openConversation: (conversationId: string) => Promise<void>;
  closeConversation: (conversationId: string) => Promise<void>;
  sampleWorkingSet: () => S;
}>;

export type ProbeRun<S extends CompanionPlateauSample> = Readonly<{
  plan: ProbePlan;
  samples: readonly S[];
}>;

/**
 * Executes the prescribed switch probe: whole rounds of unrecorded warm-up
 * opens until the ledger cache reaches its bounded steady state, then
 * `SWITCH_PROBE_ROUNDS` recorded rounds over every served conversation,
 * sampling the working set after each open. The plan is checked before the
 * first sample is taken, so a refused configuration never emits partial
 * evidence.
 */
export async function runSwitchProbe<S extends CompanionPlateauSample>(
  io: SwitchProbeIo<S>,
): Promise<ProbeRun<S>> {
  const plan = planSwitchProbe(io.conversationIds.length);
  const warmupOpens = switchProbeWarmupOpens(io.conversationIds.length);
  for (let index = 0; index < warmupOpens; index += 1) {
    await io.openConversation(io.conversationIds[index % io.conversationIds.length]!);
  }
  const samples: S[] = [];
  for (let round = 0; round < SWITCH_PROBE_ROUNDS; round += 1) {
    for (const conversationId of io.conversationIds) {
      await io.openConversation(conversationId);
      samples.push(io.sampleWorkingSet());
    }
  }
  return Object.freeze({ plan, samples: Object.freeze(samples) });
}

/**
 * Executes the prescribed open/close probe: unrecorded warm-up cycles until
 * the ledger cache reaches its bounded steady state, then
 * `OPEN_CLOSE_PROBE_CYCLES` recorded cycles of one open followed by one
 * close, sampling the working set after each half-cycle. The plan is checked
 * before the first sample is taken.
 */
export async function runOpenCloseProbe<S extends CompanionPlateauSample>(
  io: OpenCloseProbeIo<S>,
): Promise<ProbeRun<S>> {
  const plan = planOpenCloseProbe();
  const warmupCycles = openCloseProbeWarmupCycles();
  for (let index = 0; index < warmupCycles; index += 1) {
    await io.openConversation(io.conversationId);
    await io.closeConversation(io.conversationId);
  }
  const samples: S[] = [];
  for (let cycle = 0; cycle < OPEN_CLOSE_PROBE_CYCLES; cycle += 1) {
    await io.openConversation(io.conversationId);
    samples.push(io.sampleWorkingSet());
    await io.closeConversation(io.conversationId);
    samples.push(io.sampleWorkingSet());
  }
  return Object.freeze({ plan, samples: Object.freeze(samples) });
}

/**
 * Evidence header binding the exact plan counts. Operators transcribe the
 * declared cycles straight from this line.
 */
export function probeTranscriptHeader(plan: ProbePlan): string {
  if (plan.kind === "switch-probe") {
    return (
      `${plan.kind} rounds=${plan.rounds} conversations=${plan.conversations} ` +
      `warmup-opens=${plan.warmup} cycles=${plan.cycles} samples=${plan.samples}`
    );
  }
  return (
    `${plan.kind} cycles=${plan.cycles} warmup-cycles=${plan.warmup} ` +
    `samples-per-cycle=${plan.samplesPerCycle} samples=${plan.samples}`
  );
}

/**
 * Full evidence transcript: the bound header followed by every raw sample
 * line, numbered in emission order. Nothing is hidden, aggregated, or
 * truncated; the page appends only its human-summary verdict line below it.
 */
export function probeTranscriptLines<S extends CompanionPlateauSample>(
  plan: ProbePlan,
  samples: readonly S[],
): string[] {
  if (samples.length !== plan.samples) {
    throw new TypeError(
      `probe transcript expected ${plan.samples} samples, received ${samples.length}.`,
    );
  }
  return [
    probeTranscriptHeader(plan),
    ...samples.map((sample, index) => `${index} ${JSON.stringify(sample)}`),
  ];
}
