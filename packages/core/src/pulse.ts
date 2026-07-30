// SPDX-License-Identifier: MPL-2.0

export const PULSE_PROTOCOL_VERSION = 1 as const;

export type PulseProviderIdentity = Readonly<{
  id: string;
  version: string;
}>;

export type PulseRepositoryTarget = Readonly<{
  owner: string;
  name: string;
  ref: string;
}>;

export type PulsePromptVariant = Readonly<{
  id: string;
  text: string;
}>;

export type PulseDefinition = Readonly<{
  id: string;
  enabled: boolean;
  cadenceMs: number;
  jitterMs: number;
  promptVariants: readonly PulsePromptVariant[];
  repositoryAllowlist: readonly PulseRepositoryTarget[];
  provider: PulseProviderIdentity;
  maxConcurrentJobs: number;
  dailyRequestBudget: number;
}>;

export type PulseJobState =
  | "queued"
  | "running"
  | "complete"
  | "incomplete"
  | "failed"
  | "cancelled";

export type PulseArtifactReference = Readonly<{
  kind: "commit" | "branch" | "issue" | "pull-request" | "url";
  value: string;
}>;

export type PulseProviderUsage = Readonly<{
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
}>;

export type PulseJob = Readonly<{
  version: typeof PULSE_PROTOCOL_VERSION;
  id: string;
  pulseId: string;
  revision: number;
  idempotencyKey: string;
  repository: PulseRepositoryTarget;
  baseRevision: string;
  provider: PulseProviderIdentity;
  promptVariantId: string;
  state: PulseJobState;
  attempt: number;
  startedAt: number | null;
  lastHeartbeatAt: number | null;
  completedAt: number | null;
  retryAfter: number | null;
  terminalReport: string | null;
  artifactReferences: readonly PulseArtifactReference[];
  usage: PulseProviderUsage | null;
}>;

export type PulseActiveJobSummary = Readonly<{
  pulseId: string;
  providerId: string;
  repositoryKey: string;
}>;

export type PulseDailyUsage = Readonly<{
  pulseId: string;
  requestCount: number;
}>;

export type PulseSchedulerPolicy = Readonly<{
  maxDefinitions: number;
  maxPromptVariantsPerDefinition: number;
  maxPromptCodeUnits: number;
  maxRepositoriesPerDefinition: number;
  maxActiveJobs: number;
  maxProviderActiveJobs: number;
  maxRepositoryActiveJobs: number;
  maxDispatchesPerTick: number;
  minCadenceMs: number;
  maxCadenceMs: number;
  maxJitterMs: number;
  minRetryMs: number;
  maxRetryMs: number;
  maxAttempts: number;
  maxLedgerLanes: number;
  maxTerminalReportCodeUnits: number;
  maxArtifactReferences: number;
  maxArtifactValueCodeUnits: number;
}>;

export const DEFAULT_PULSE_SCHEDULER_POLICY: PulseSchedulerPolicy = Object.freeze({
  maxDefinitions: 100,
  maxPromptVariantsPerDefinition: 32,
  maxPromptCodeUnits: 16_384,
  maxRepositoriesPerDefinition: 100,
  maxActiveJobs: 16,
  maxProviderActiveJobs: 8,
  maxRepositoryActiveJobs: 2,
  maxDispatchesPerTick: 8,
  minCadenceMs: 60_000,
  maxCadenceMs: 30 * 24 * 60 * 60 * 1000,
  maxJitterMs: 24 * 60 * 60 * 1000,
  minRetryMs: 1_000,
  maxRetryMs: 24 * 60 * 60 * 1000,
  maxAttempts: 8,
  maxLedgerLanes: 100,
  maxTerminalReportCodeUnits: 65_536,
  maxArtifactReferences: 64,
  maxArtifactValueCodeUnits: 4_096,
});

export type PulseDispatchDecision = Readonly<{
  pulseId: string;
  window: number;
  dueAt: number;
  idempotencyKey: string;
  provider: PulseProviderIdentity;
  repository: PulseRepositoryTarget;
  promptVariantId: string;
  prompt: string;
}>;

export type PulseDeferredDecision = Readonly<{
  pulseId: string;
  reason:
    | "disabled"
    | "paused"
    | "not-due"
    | "already-dispatched"
    | "pulse-concurrency"
    | "daily-budget"
    | "global-concurrency"
    | "provider-concurrency"
    | "repository-concurrency"
    | "tick-limit";
}>;

export type PulsePlanningContext = Readonly<{
  now: number;
  activeJobs?: readonly PulseActiveJobSummary[];
  dailyUsage?: readonly PulseDailyUsage[];
  dispatchedIdempotencyKeys?: readonly string[];
  pausedPulseIds?: readonly string[];
}>;

export type PulsePlanningResult = Readonly<{
  dispatches: readonly PulseDispatchDecision[];
  deferred: readonly PulseDeferredDecision[];
}>;

export type PulseRetryDecision =
  | Readonly<{ action: "retry"; retryAt: number }>
  | Readonly<{
      action: "pause";
      reason: "attempt-limit" | "retry-after-limit" | "invalid-time";
    }>;

export type PulseLedgerLane = Readonly<{
  pulseId: string;
  active: PulseJob | null;
  latestTerminal: PulseJob | null;
}>;

export type PulseLedgerSnapshot = Readonly<{
  lanes: readonly PulseLedgerLane[];
}>;

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const IDEMPOTENCY_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/u;
const REPOSITORY_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const GIT_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/u;
const JOB_STATES = new Set<PulseJobState>([
  "queued",
  "running",
  "complete",
  "incomplete",
  "failed",
  "cancelled",
]);
const TERMINAL_STATES = new Set<PulseJobState>([
  "complete",
  "incomplete",
  "failed",
  "cancelled",
]);
const ARTIFACT_KINDS = new Set<PulseArtifactReference["kind"]>([
  "commit",
  "branch",
  "issue",
  "pull-request",
  "url",
]);

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownData(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor) || descriptor.get || descriptor.set) {
    throw new TypeError("Pulse records require own data properties.");
  }
  return descriptor.value;
}

function hasExactKeys(value: object, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Reflect.ownKeys(value).every(
    (key) => typeof key === "string" && allowedSet.has(key),
  );
}

function boundedText(value: unknown, maximum: number, allowEmpty = false): value is string {
  return (
    typeof value === "string" &&
    value.length <= maximum &&
    (allowEmpty || value.length > 0) &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  );
}

function copyProviderIdentity(value: unknown): PulseProviderIdentity | null {
  try {
    if (!isPlainRecord(value) || !hasExactKeys(value, ["id", "version"])) return null;
    const id = ownData(value, "id");
    const version = ownData(value, "version");
    if (typeof id !== "string" || !TOKEN.test(id)) return null;
    if (typeof version !== "string" || !TOKEN.test(version)) return null;
    return Object.freeze({ id, version });
  } catch {
    return null;
  }
}

function copyRepository(value: unknown): PulseRepositoryTarget | null {
  try {
    if (!isPlainRecord(value) || !hasExactKeys(value, ["owner", "name", "ref"])) return null;
    const owner = ownData(value, "owner");
    const name = ownData(value, "name");
    const ref = ownData(value, "ref");
    if (typeof owner !== "string" || !REPOSITORY_SEGMENT.test(owner)) return null;
    if (typeof name !== "string" || !REPOSITORY_SEGMENT.test(name)) return null;
    if (typeof ref !== "string" || !GIT_REF.test(ref) || ref.includes("..")) return null;
    return Object.freeze({ owner, name, ref });
  } catch {
    return null;
  }
}

function copyPromptVariants(
  value: unknown,
  policy: PulseSchedulerPolicy,
): readonly PulsePromptVariant[] | null {
  try {
    if (!Array.isArray(value) || value.length === 0) return null;
    if (value.length > policy.maxPromptVariantsPerDefinition) return null;
    const ids = new Set<string>();
    const copied: PulsePromptVariant[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor)) return null;
      const candidate = descriptor.value;
      if (!isPlainRecord(candidate) || !hasExactKeys(candidate, ["id", "text"])) return null;
      const id = ownData(candidate, "id");
      const text = ownData(candidate, "text");
      if (typeof id !== "string" || !TOKEN.test(id) || ids.has(id)) return null;
      if (!boundedText(text, policy.maxPromptCodeUnits)) return null;
      ids.add(id);
      copied.push(Object.freeze({ id, text }));
    }
    return Object.freeze(copied);
  } catch {
    return null;
  }
}

function copyRepositories(
  value: unknown,
  policy: PulseSchedulerPolicy,
): readonly PulseRepositoryTarget[] | null {
  try {
    if (!Array.isArray(value) || value.length === 0) return null;
    if (value.length > policy.maxRepositoriesPerDefinition) return null;
    const keys = new Set<string>();
    const copied: PulseRepositoryTarget[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor)) return null;
      const repository = copyRepository(descriptor.value);
      if (!repository) return null;
      const key = pulseRepositoryKey(repository);
      if (keys.has(key)) return null;
      keys.add(key);
      copied.push(repository);
    }
    return Object.freeze(copied);
  } catch {
    return null;
  }
}

export function resolvePulseSchedulerPolicy(
  input: Partial<PulseSchedulerPolicy> | undefined,
): PulseSchedulerPolicy {
  const resolved = { ...DEFAULT_PULSE_SCHEDULER_POLICY, ...input };
  for (const [name, value] of Object.entries(resolved)) {
    if (!positiveSafeInteger(value)) {
      throw new RangeError(`${name} must be a positive safe integer.`);
    }
  }
  if (resolved.minCadenceMs > resolved.maxCadenceMs) {
    throw new RangeError("minCadenceMs must be no greater than maxCadenceMs.");
  }
  if (resolved.minRetryMs > resolved.maxRetryMs) {
    throw new RangeError("minRetryMs must be no greater than maxRetryMs.");
  }
  return Object.freeze(resolved);
}

export function parsePulseDefinitions(
  input: unknown,
  inputPolicy?: Partial<PulseSchedulerPolicy>,
): readonly PulseDefinition[] {
  const policy = resolvePulseSchedulerPolicy(inputPolicy);
  if (!Array.isArray(input) || input.length > policy.maxDefinitions) {
    throw new TypeError("Pulse definitions must be a bounded array.");
  }
  const ids = new Set<string>();
  const definitions: PulseDefinition[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError("Pulse definitions require own array entries.");
    }
    const value = descriptor.value;
    if (
      !isPlainRecord(value) ||
      !hasExactKeys(value, [
        "id",
        "enabled",
        "cadenceMs",
        "jitterMs",
        "promptVariants",
        "repositoryAllowlist",
        "provider",
        "maxConcurrentJobs",
        "dailyRequestBudget",
      ])
    ) {
      throw new TypeError("Pulse definitions require exact own-data fields.");
    }
    const id = ownData(value, "id");
    const enabled = ownData(value, "enabled");
    const cadenceMs = ownData(value, "cadenceMs");
    const jitterMs = ownData(value, "jitterMs");
    const promptVariants = copyPromptVariants(ownData(value, "promptVariants"), policy);
    const repositoryAllowlist = copyRepositories(
      ownData(value, "repositoryAllowlist"),
      policy,
    );
    const provider = copyProviderIdentity(ownData(value, "provider"));
    const maxConcurrentJobs = ownData(value, "maxConcurrentJobs");
    const dailyRequestBudget = ownData(value, "dailyRequestBudget");
    if (typeof id !== "string" || !TOKEN.test(id) || ids.has(id)) {
      throw new TypeError("Pulse ids must be unique bounded tokens.");
    }
    if (typeof enabled !== "boolean") {
      throw new TypeError("Pulse enabled must be boolean.");
    }
    if (
      !positiveSafeInteger(cadenceMs) ||
      cadenceMs < policy.minCadenceMs ||
      cadenceMs > policy.maxCadenceMs
    ) {
      throw new RangeError("Pulse cadence is outside the configured bounds.");
    }
    if (
      !nonNegativeSafeInteger(jitterMs) ||
      jitterMs > policy.maxJitterMs ||
      jitterMs >= cadenceMs
    ) {
      throw new RangeError("Pulse jitter must be bounded below cadence.");
    }
    if (!promptVariants || !repositoryAllowlist || !provider) {
      throw new TypeError("Pulse variants, repositories, and provider must be bounded.");
    }
    if (!positiveSafeInteger(maxConcurrentJobs) || maxConcurrentJobs > policy.maxActiveJobs) {
      throw new RangeError("Pulse concurrency exceeds the scheduler policy.");
    }
    if (!positiveSafeInteger(dailyRequestBudget)) {
      throw new RangeError("Pulse daily request budget must be positive.");
    }
    ids.add(id);
    definitions.push(
      Object.freeze({
        id,
        enabled,
        cadenceMs,
        jitterMs,
        promptVariants,
        repositoryAllowlist,
        provider,
        maxConcurrentJobs,
        dailyRequestBudget,
      }),
    );
  }
  return Object.freeze(definitions);
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function chooseIndex(seed: string, length: number): number {
  return fnv1a(seed) % length;
}

export function pulseRepositoryKey(repository: PulseRepositoryTarget): string {
  return `${repository.owner}/${repository.name}@${repository.ref}`;
}

export function pulseWindow(definition: PulseDefinition, now: number): number {
  if (!finiteNonNegative(now)) throw new RangeError("Pulse time must be finite and non-negative.");
  return Math.floor(now / definition.cadenceMs);
}

export function pulseDueAt(definition: PulseDefinition, window: number): number {
  if (!nonNegativeSafeInteger(window)) throw new RangeError("Pulse window must be non-negative.");
  const offset =
    definition.jitterMs === 0
      ? 0
      : chooseIndex(`${definition.id}:${window}:jitter`, definition.jitterMs + 1);
  const dueAt = window * definition.cadenceMs + offset;
  if (!Number.isSafeInteger(dueAt)) throw new RangeError("Pulse due time exceeds safe integer bounds.");
  return dueAt;
}

export function pulseIdempotencyKey(
  definition: PulseDefinition,
  window: number,
  repository: PulseRepositoryTarget,
): string {
  const digest = fnv1a(
    `${definition.id}\u0000${window}\u0000${pulseRepositoryKey(repository)}`,
  )
    .toString(16)
    .padStart(8, "0");
  return `pulse-v1:${definition.id}:${window}:${digest}`;
}

export function planPulseDispatches(
  rawDefinitions: unknown,
  context: PulsePlanningContext,
  inputPolicy?: Partial<PulseSchedulerPolicy>,
): PulsePlanningResult {
  const policy = resolvePulseSchedulerPolicy(inputPolicy);
  const definitions = parsePulseDefinitions(rawDefinitions, policy);
  if (!finiteNonNegative(context.now)) {
    throw new RangeError("Pulse planning time must be finite and non-negative.");
  }
  const activeJobs = context.activeJobs ?? [];
  const dailyUsage = new Map(
    (context.dailyUsage ?? []).map((entry) => [entry.pulseId, entry.requestCount]),
  );
  const dispatched = new Set(context.dispatchedIdempotencyKeys ?? []);
  const paused = new Set(context.pausedPulseIds ?? []);
  const activeByPulse = new Map<string, number>();
  const activeByProvider = new Map<string, number>();
  const activeByRepository = new Map<string, number>();
  for (const job of activeJobs) {
    activeByPulse.set(job.pulseId, (activeByPulse.get(job.pulseId) ?? 0) + 1);
    activeByProvider.set(
      job.providerId,
      (activeByProvider.get(job.providerId) ?? 0) + 1,
    );
    activeByRepository.set(
      job.repositoryKey,
      (activeByRepository.get(job.repositoryKey) ?? 0) + 1,
    );
  }

  let projectedActive = activeJobs.length;
  const decisions: PulseDispatchDecision[] = [];
  const deferred: PulseDeferredDecision[] = [];
  for (const definition of definitions) {
    if (!definition.enabled) {
      deferred.push(Object.freeze({ pulseId: definition.id, reason: "disabled" }));
      continue;
    }
    if (paused.has(definition.id)) {
      deferred.push(Object.freeze({ pulseId: definition.id, reason: "paused" }));
      continue;
    }
    const window = pulseWindow(definition, context.now);
    const dueAt = pulseDueAt(definition, window);
    if (context.now < dueAt) {
      deferred.push(Object.freeze({ pulseId: definition.id, reason: "not-due" }));
      continue;
    }
    const repository = definition.repositoryAllowlist[
      chooseIndex(`${definition.id}:${window}:repository`, definition.repositoryAllowlist.length)
    ];
    const variant = definition.promptVariants[
      chooseIndex(`${definition.id}:${window}:prompt`, definition.promptVariants.length)
    ];
    if (!repository || !variant) {
      throw new TypeError("Pulse definition lost a bounded selection candidate.");
    }
    const idempotencyKey = pulseIdempotencyKey(definition, window, repository);
    if (dispatched.has(idempotencyKey)) {
      deferred.push(
        Object.freeze({ pulseId: definition.id, reason: "already-dispatched" }),
      );
      continue;
    }
    if ((activeByPulse.get(definition.id) ?? 0) >= definition.maxConcurrentJobs) {
      deferred.push(
        Object.freeze({ pulseId: definition.id, reason: "pulse-concurrency" }),
      );
      continue;
    }
    if ((dailyUsage.get(definition.id) ?? 0) >= definition.dailyRequestBudget) {
      deferred.push(Object.freeze({ pulseId: definition.id, reason: "daily-budget" }));
      continue;
    }
    if (projectedActive >= policy.maxActiveJobs) {
      deferred.push(
        Object.freeze({ pulseId: definition.id, reason: "global-concurrency" }),
      );
      continue;
    }
    if ((activeByProvider.get(definition.provider.id) ?? 0) >= policy.maxProviderActiveJobs) {
      deferred.push(
        Object.freeze({ pulseId: definition.id, reason: "provider-concurrency" }),
      );
      continue;
    }
    const repositoryKey = pulseRepositoryKey(repository);
    if ((activeByRepository.get(repositoryKey) ?? 0) >= policy.maxRepositoryActiveJobs) {
      deferred.push(
        Object.freeze({ pulseId: definition.id, reason: "repository-concurrency" }),
      );
      continue;
    }
    if (decisions.length >= policy.maxDispatchesPerTick) {
      deferred.push(Object.freeze({ pulseId: definition.id, reason: "tick-limit" }));
      continue;
    }

    decisions.push(
      Object.freeze({
        pulseId: definition.id,
        window,
        dueAt,
        idempotencyKey,
        provider: definition.provider,
        repository,
        promptVariantId: variant.id,
        prompt: variant.text,
      }),
    );
    dispatched.add(idempotencyKey);
    projectedActive += 1;
    activeByPulse.set(definition.id, (activeByPulse.get(definition.id) ?? 0) + 1);
    activeByProvider.set(
      definition.provider.id,
      (activeByProvider.get(definition.provider.id) ?? 0) + 1,
    );
    activeByRepository.set(
      repositoryKey,
      (activeByRepository.get(repositoryKey) ?? 0) + 1,
    );
    dailyUsage.set(definition.id, (dailyUsage.get(definition.id) ?? 0) + 1);
  }
  return Object.freeze({
    dispatches: Object.freeze(decisions),
    deferred: Object.freeze(deferred),
  });
}

export function decidePulseRetry(
  now: number,
  attempt: number,
  retryAfterMs: number | null,
  inputPolicy?: Partial<PulseSchedulerPolicy>,
): PulseRetryDecision {
  const policy = resolvePulseSchedulerPolicy(inputPolicy);
  if (!finiteNonNegative(now) || !positiveSafeInteger(attempt)) {
    return Object.freeze({ action: "pause", reason: "invalid-time" });
  }
  if (attempt >= policy.maxAttempts) {
    return Object.freeze({ action: "pause", reason: "attempt-limit" });
  }
  let delay: number;
  if (retryAfterMs !== null) {
    if (!positiveSafeInteger(retryAfterMs) || retryAfterMs > policy.maxRetryMs) {
      return Object.freeze({ action: "pause", reason: "retry-after-limit" });
    }
    delay = retryAfterMs;
  } else {
    const exponent = Math.min(attempt - 1, 30);
    delay = Math.min(policy.maxRetryMs, policy.minRetryMs * 2 ** exponent);
  }
  const retryAt = now + delay;
  if (!Number.isSafeInteger(retryAt)) {
    return Object.freeze({ action: "pause", reason: "invalid-time" });
  }
  return Object.freeze({ action: "retry", retryAt });
}

function copyArtifactReferences(
  value: unknown,
  policy: PulseSchedulerPolicy,
): readonly PulseArtifactReference[] | null {
  try {
    if (!Array.isArray(value) || value.length > policy.maxArtifactReferences) return null;
    const output: PulseArtifactReference[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor)) return null;
      const candidate = descriptor.value;
      if (!isPlainRecord(candidate) || !hasExactKeys(candidate, ["kind", "value"])) {
        return null;
      }
      const kind = ownData(candidate, "kind");
      const reference = ownData(candidate, "value");
      if (typeof kind !== "string" || !ARTIFACT_KINDS.has(kind as PulseArtifactReference["kind"])) {
        return null;
      }
      if (!boundedText(reference, policy.maxArtifactValueCodeUnits)) return null;
      output.push(
        Object.freeze({
          kind: kind as PulseArtifactReference["kind"],
          value: reference,
        }),
      );
    }
    return Object.freeze(output);
  } catch {
    return null;
  }
}

function copyUsage(value: unknown): PulseProviderUsage | null {
  try {
    if (value === null) return null;
    if (
      !isPlainRecord(value) ||
      !hasExactKeys(value, ["requests", "inputTokens", "outputTokens", "costMicros"])
    ) {
      throw new TypeError("invalid usage");
    }
    const requests = ownData(value, "requests");
    const inputTokens = ownData(value, "inputTokens");
    const outputTokens = ownData(value, "outputTokens");
    const costMicros = ownData(value, "costMicros");
    if (
      !nonNegativeSafeInteger(requests) ||
      !nonNegativeSafeInteger(inputTokens) ||
      !nonNegativeSafeInteger(outputTokens) ||
      !nonNegativeSafeInteger(costMicros)
    ) {
      throw new TypeError("invalid usage");
    }
    return Object.freeze({ requests, inputTokens, outputTokens, costMicros });
  } catch {
    return null;
  }
}

export function parsePulseJob(
  input: unknown,
  inputPolicy?: Partial<PulseSchedulerPolicy>,
): PulseJob {
  const policy = resolvePulseSchedulerPolicy(inputPolicy);
  try {
    const keys = [
      "version",
      "id",
      "pulseId",
      "revision",
      "idempotencyKey",
      "repository",
      "baseRevision",
      "provider",
      "promptVariantId",
      "state",
      "attempt",
      "startedAt",
      "lastHeartbeatAt",
      "completedAt",
      "retryAfter",
      "terminalReport",
      "artifactReferences",
      "usage",
    ] as const;
    if (!isPlainRecord(input) || !hasExactKeys(input, keys)) {
      throw new TypeError("Pulse job requires exact own-data fields.");
    }
    const version = ownData(input, "version");
    const id = ownData(input, "id");
    const pulseId = ownData(input, "pulseId");
    const revision = ownData(input, "revision");
    const idempotencyKey = ownData(input, "idempotencyKey");
    const repository = copyRepository(ownData(input, "repository"));
    const baseRevision = ownData(input, "baseRevision");
    const provider = copyProviderIdentity(ownData(input, "provider"));
    const promptVariantId = ownData(input, "promptVariantId");
    const state = ownData(input, "state");
    const attempt = ownData(input, "attempt");
    const startedAt = ownData(input, "startedAt");
    const lastHeartbeatAt = ownData(input, "lastHeartbeatAt");
    const completedAt = ownData(input, "completedAt");
    const retryAfter = ownData(input, "retryAfter");
    const terminalReport = ownData(input, "terminalReport");
    const artifactReferences = copyArtifactReferences(
      ownData(input, "artifactReferences"),
      policy,
    );
    const usageValue = ownData(input, "usage");
    const usage = copyUsage(usageValue);

    if (version !== PULSE_PROTOCOL_VERSION) throw new TypeError("Unsupported pulse version.");
    if (typeof id !== "string" || !TOKEN.test(id)) throw new TypeError("Invalid pulse job id.");
    if (typeof pulseId !== "string" || !TOKEN.test(pulseId)) throw new TypeError("Invalid pulse id.");
    if (!nonNegativeSafeInteger(revision)) throw new TypeError("Invalid pulse revision.");
    if (typeof idempotencyKey !== "string" || !IDEMPOTENCY_TOKEN.test(idempotencyKey)) {
      throw new TypeError("Invalid pulse idempotency key.");
    }
    if (!repository || !provider) throw new TypeError("Invalid pulse repository or provider.");
    if (typeof baseRevision !== "string" || !TOKEN.test(baseRevision)) {
      throw new TypeError("Invalid pulse base revision.");
    }
    if (typeof promptVariantId !== "string" || !TOKEN.test(promptVariantId)) {
      throw new TypeError("Invalid prompt variant id.");
    }
    if (typeof state !== "string" || !JOB_STATES.has(state as PulseJobState)) {
      throw new TypeError("Invalid pulse job state.");
    }
    if (!positiveSafeInteger(attempt) || attempt > policy.maxAttempts) {
      throw new TypeError("Invalid pulse attempt.");
    }
    for (const time of [startedAt, lastHeartbeatAt, completedAt, retryAfter]) {
      if (!(time === null || finiteNonNegative(time))) {
        throw new TypeError("Pulse job times must be finite and non-negative.");
      }
    }
    if (!(terminalReport === null || boundedText(terminalReport, policy.maxTerminalReportCodeUnits, true))) {
      throw new TypeError("Pulse terminal report exceeds the configured bound.");
    }
    if (!artifactReferences) throw new TypeError("Invalid pulse artifact references.");
    if (usageValue !== null && usage === null) throw new TypeError("Invalid pulse usage.");

    const terminal = TERMINAL_STATES.has(state as PulseJobState);
    if (terminal && completedAt === null) {
      throw new TypeError("Terminal pulse jobs require completedAt.");
    }
    if (!terminal && completedAt !== null) {
      throw new TypeError("Active pulse jobs cannot carry completedAt.");
    }
    if (state === "complete" && (terminalReport === null || terminalReport.length === 0)) {
      throw new TypeError("Complete pulse jobs require a terminal report.");
    }

    return Object.freeze({
      version: PULSE_PROTOCOL_VERSION,
      id,
      pulseId,
      revision,
      idempotencyKey,
      repository,
      baseRevision,
      provider,
      promptVariantId,
      state: state as PulseJobState,
      attempt,
      startedAt: startedAt as number | null,
      lastHeartbeatAt: lastHeartbeatAt as number | null,
      completedAt: completedAt as number | null,
      retryAfter: retryAfter as number | null,
      terminalReport: terminalReport as string | null,
      artifactReferences,
      usage,
    });
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError("Pulse job inspection failed safely.");
  }
}

function cloneJob(job: PulseJob): PulseJob {
  return structuredClone(job);
}

export class BoundedPulseReportLedger {
  readonly #policy: PulseSchedulerPolicy;
  readonly #lanes = new Map<string, PulseLedgerLane>();

  constructor(inputPolicy?: Partial<PulseSchedulerPolicy>) {
    this.#policy = resolvePulseSchedulerPolicy(inputPolicy);
  }

  get snapshot(): PulseLedgerSnapshot {
    const lanes = [...this.#lanes.values()]
      .sort((left, right) => left.pulseId.localeCompare(right.pulseId))
      .map((lane) =>
        Object.freeze({
          pulseId: lane.pulseId,
          active: lane.active ? cloneJob(lane.active) : null,
          latestTerminal: lane.latestTerminal ? cloneJob(lane.latestTerminal) : null,
        }),
      );
    return Object.freeze({ lanes: Object.freeze(lanes) });
  }

  publish(input: unknown): Readonly<{ applied: boolean; snapshot: PulseLedgerSnapshot }> {
    const job = parsePulseJob(input, this.#policy);
    const existing = this.#lanes.get(job.pulseId);
    const newestRevision = Math.max(
      existing?.active?.revision ?? -1,
      existing?.latestTerminal?.revision ?? -1,
    );
    const terminal = TERMINAL_STATES.has(job.state);
    if (
      job.revision < newestRevision ||
      (job.revision === newestRevision && existing?.latestTerminal?.revision === newestRevision && !terminal)
    ) {
      return Object.freeze({ applied: false, snapshot: this.snapshot });
    }
    if (!existing && this.#lanes.size >= this.#policy.maxLedgerLanes) {
      throw new RangeError("Pulse ledger lane limit reached.");
    }

    const lane: PulseLedgerLane = Object.freeze({
      pulseId: job.pulseId,
      active: terminal ? null : cloneJob(job),
      latestTerminal: terminal
        ? cloneJob(job)
        : existing?.latestTerminal
          ? cloneJob(existing.latestTerminal)
          : null,
    });
    this.#lanes.set(job.pulseId, lane);
    return Object.freeze({ applied: true, snapshot: this.snapshot });
  }

  clear(pulseId: string): boolean {
    if (!TOKEN.test(pulseId)) return false;
    return this.#lanes.delete(pulseId);
  }

  clearAll(): void {
    this.#lanes.clear();
  }
}
