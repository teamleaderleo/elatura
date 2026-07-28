// SPDX-License-Identifier: MPL-2.0
import {
  isRecord,
  planActivePathWindow,
  traceActivePath,
  type ActivePathSelectionPlan,
  type StructuralFingerprint,
  type ValidationIssue,
  type ValidationResult,
} from "@elatura/core";
import { defineAdapterCapabilities } from "@elatura/core/adapter-contract";
import {
  cloneJsonLike,
  equalJsonLike,
  runFailOpenPipeline,
  type DetectionResult,
  type FailOpenPipelineAdapter,
  type PipelineDecision,
  type PipelineStageContext,
  type RunFailOpenPipelineOptions,
} from "@elatura/core/orchestration";
import {
  detectChatGptConversation,
  fingerprintChatGptConversation,
  validateChatGptConversation,
  type ChatGptConversation,
  type ChatGptNode,
} from "./index.js";
import { CHATGPT_ADAPTER_ID, CHATGPT_ADAPTER_VERSION } from "./contracts.js";

export const SYNTHETIC_CHATGPT_ADAPTER_ID = "chatgpt-synthetic-conversation" as const;
export const SYNTHETIC_CHATGPT_ADAPTER_VERSION = "0.1.0" as const;
export const SYNTHETIC_CHATGPT_CAPABILITIES = defineAdapterCapabilities({
  plan: "synthetic-only",
  materialize: "synthetic-only",
  validateOutput: "synthetic-only",
  branches: "supported",
});

export type SyntheticChatGptPolicy = Readonly<{
  maxGroups: number;
  includeRoot: boolean;
  includeBranchSiblings: boolean;
}>;

export const DEFAULT_SYNTHETIC_CHATGPT_POLICY: SyntheticChatGptPolicy = Object.freeze({
  maxGroups: 24,
  includeRoot: true,
  includeBranchSiblings: true,
});

export type SyntheticSnapshotBoundary =
  | Readonly<{ kind: "complete" }>
  | Readonly<{
      kind: "omitted-parent";
      retainedNodeId: string;
      omittedParentId: string;
      omittedActivePrefixCount: number;
    }>;

export type SyntheticSnapshotMetadata = Readonly<{
  schemaVersion: 1;
  synthetic: true;
  sourceAdapter: typeof CHATGPT_ADAPTER_ID;
  sourceAdapterVersion: typeof CHATGPT_ADAPTER_VERSION;
  selectedNodeCount: number;
  omittedNodeCount: number;
  omittedChildEdgeCount: number;
  parentBoundary: SyntheticSnapshotBoundary;
  disconnectedRootAnchor: boolean;
}>;

export type ChatGptSyntheticSnapshot = Record<string, unknown> & {
  current_node: string;
  mapping: Record<string, Record<string, unknown>>;
  elatura_snapshot: SyntheticSnapshotMetadata;
};

function issue(path: string, code: string, message: string): ValidationIssue {
  return { path, code, message };
}

function syntheticMarker(input: unknown): "synthetic" | "absent" | "malformed" {
  if (!isRecord(input) || !("elatura_fixture" in input)) return "absent";
  if (!isRecord(input.elatura_fixture)) return "malformed";
  return input.elatura_fixture.synthetic === true ? "synthetic" : "absent";
}

function detection(input: unknown): DetectionResult {
  const marker = syntheticMarker(input);
  if (marker === "absent") return { kind: "miss" };
  if (marker === "malformed" || !detectChatGptConversation(input)) return { kind: "ambiguous" };
  return { kind: "match" };
}

function fixtureGroupKey(node: ChatGptNode): string {
  const fixture = node.raw.elatura_fixture;
  if (!isRecord(fixture) || typeof fixture.turnGroup !== "string" || fixture.turnGroup.length === 0) {
    throw new TypeError("Synthetic node fixture metadata is invalid.");
  }
  return fixture.turnGroup;
}

function resolvePolicy(policy: Partial<SyntheticChatGptPolicy> | undefined): SyntheticChatGptPolicy {
  return Object.freeze({ ...DEFAULT_SYNTHETIC_CHATGPT_POLICY, ...policy });
}

function policyIssues(policy: SyntheticChatGptPolicy): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!Number.isInteger(policy.maxGroups) || policy.maxGroups < 1) {
    issues.push(issue("$.policy.maxGroups", "invalid-max-groups", "Expected a positive integer."));
  }
  if (typeof policy.includeRoot !== "boolean") {
    issues.push(issue("$.policy.includeRoot", "invalid-include-root", "Expected a boolean."));
  }
  if (typeof policy.includeBranchSiblings !== "boolean") {
    issues.push(issue("$.policy.includeBranchSiblings", "invalid-include-branch-siblings", "Expected a boolean."));
  }
  return issues;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validatePlan(source: ChatGptConversation, plan: ActivePathSelectionPlan): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (plan.currentNode !== source.currentNode) {
    issues.push(issue("$.plan.currentNode", "plan-current-node-mismatch", "Plan current node differs from source."));
  }
  const traced = traceActivePath(source.mapping, source.currentNode);
  if (!traced.ok) {
    issues.push(issue("$.plan.activePathIds", "plan-source-path-invalid", "Source active path cannot be traced."));
  } else {
    const expectedActivePath = traced.value.map((node) => node.id);
    if (!sameIds(plan.activePathIds, expectedActivePath)) {
      issues.push(issue("$.plan.activePathIds", "plan-active-path-mismatch", "Plan active path differs from source."));
    }
    if (!sameIds([...plan.omittedActivePrefixIds, ...plan.retainedActivePathIds], expectedActivePath)) {
      issues.push(
        issue(
          "$.plan.retainedActivePathIds",
          "plan-active-window-mismatch",
          "Retained and omitted paths must partition the active path.",
        ),
      );
    }
  }
  const selected = new Set(plan.selectedIds);
  if (selected.size !== plan.selectedIds.length) {
    issues.push(issue("$.plan.selectedIds", "plan-duplicate-selection", "Selected ids must be unique."));
  }
  if (!selected.has(source.currentNode)) {
    issues.push(issue("$.plan.selectedIds", "plan-current-node-omitted", "Current node must be selected."));
  }
  for (const nodeId of plan.selectedIds) {
    if (!source.mapping[nodeId]) {
      issues.push(issue("$.plan.selectedIds", "plan-node-not-found", "A selected node does not resolve."));
    }
    if (!plan.reasons[nodeId] || plan.reasons[nodeId]?.length === 0) {
      issues.push(issue("$.plan.reasons", "plan-reason-missing", "Every selected node requires a reason."));
    }
  }
  for (const nodeId of Object.keys(plan.reasons)) {
    if (!selected.has(nodeId)) {
      issues.push(issue("$.plan.reasons", "plan-reason-unselected", "Reasons may reference selected nodes only."));
    }
  }
  if (plan.retainedActivePathIds.length === 0) {
    issues.push(issue("$.plan.retainedActivePathIds", "plan-empty-retained-path", "Retained path must be non-empty."));
  }
  const firstRetained = plan.retainedActivePathIds[0];
  const firstRetainedNode = firstRetained === undefined ? undefined : source.mapping[firstRetained];
  const expectedOmittedParent =
    firstRetainedNode?.parent !== null &&
    firstRetainedNode?.parent !== undefined &&
    !selected.has(firstRetainedNode.parent)
      ? firstRetainedNode.parent
      : null;
  if (plan.omittedBoundaryParentId !== expectedOmittedParent) {
    issues.push(
      issue(
        "$.plan.omittedBoundaryParentId",
        "plan-boundary-mismatch",
        "Omitted parent boundary is inconsistent.",
      ),
    );
  }
  return issues;
}

function expectedBoundary(plan: ActivePathSelectionPlan): SyntheticSnapshotBoundary {
  const retainedNodeId = plan.retainedActivePathIds[0];
  if (plan.omittedBoundaryParentId === null || retainedNodeId === undefined) return Object.freeze({ kind: "complete" });
  return Object.freeze({
    kind: "omitted-parent",
    retainedNodeId,
    omittedParentId: plan.omittedBoundaryParentId,
    omittedActivePrefixCount: plan.omittedActivePrefixIds.length,
  });
}

function materializeSyntheticSnapshot(
  source: ChatGptConversation,
  plan: ActivePathSelectionPlan,
  context: PipelineStageContext,
): ChatGptSyntheticSnapshot {
  const planProblems = validatePlan(source, plan);
  if (planProblems.length > 0) throw new TypeError("Selection plan is inconsistent.");
  if ("elatura_snapshot" in source.raw) throw new TypeError("Reserved snapshot field already exists.");

  const selected = new Set(plan.selectedIds);
  const mapping: Record<string, Record<string, unknown>> = {};
  let omittedChildEdgeCount = 0;

  for (const nodeId of [...plan.selectedIds].sort()) {
    context.checkpoint();
    context.consumeOperations();
    const node = source.mapping[nodeId];
    if (!node) throw new TypeError("Selected node does not resolve.");
    const cloned = cloneJsonLike(node.raw, context);
    if (!isRecord(cloned)) throw new TypeError("Cloned node must remain an object.");
    cloned.parent = node.parent !== null && selected.has(node.parent) ? node.parent : null;
    const retainedChildren = node.children.filter((childId) => selected.has(childId));
    omittedChildEdgeCount += node.children.length - retainedChildren.length;
    cloned.children = retainedChildren;
    mapping[nodeId] = cloned;
  }

  const output: Record<string, unknown> = {};
  for (const key of Object.keys(source.raw).sort()) {
    if (key === "mapping" || key === "current_node") continue;
    output[key] = cloneJsonLike(source.raw[key], context);
  }
  output.current_node = source.currentNode;
  output.mapping = mapping;

  const rootAnchor = plan.selectedIds.find((nodeId) => plan.reasons[nodeId]?.includes("root-anchor"));
  const disconnectedRootAnchor =
    rootAnchor !== undefined &&
    !plan.retainedActivePathIds.includes(rootAnchor) &&
    source.mapping[rootAnchor]?.parent === null;
  const metadata: SyntheticSnapshotMetadata = Object.freeze({
    schemaVersion: 1,
    synthetic: true,
    sourceAdapter: CHATGPT_ADAPTER_ID,
    sourceAdapterVersion: CHATGPT_ADAPTER_VERSION,
    selectedNodeCount: plan.selectedIds.length,
    omittedNodeCount: Object.keys(source.mapping).length - plan.selectedIds.length,
    omittedChildEdgeCount,
    parentBoundary: expectedBoundary(plan),
    disconnectedRootAnchor,
  });
  context.reserveAllocation(128);
  output.elatura_snapshot = metadata;
  return output as ChatGptSyntheticSnapshot;
}

function boundaryEqual(left: unknown, right: SyntheticSnapshotBoundary): boolean {
  if (!isRecord(left) || left.kind !== right.kind) return false;
  if (right.kind === "complete") return Object.keys(left).length === 1;
  return (
    left.retainedNodeId === right.retainedNodeId &&
    left.omittedParentId === right.omittedParentId &&
    left.omittedActivePrefixCount === right.omittedActivePrefixCount
  );
}

function validateSyntheticSnapshot(
  candidate: unknown,
  source: ChatGptConversation,
  plan: ActivePathSelectionPlan,
  context: PipelineStageContext,
): ValidationResult<ChatGptSyntheticSnapshot> {
  const graphValidation = validateChatGptConversation(candidate);
  if (!graphValidation.ok) {
    return {
      ok: false,
      issues: [issue("$.output", "output-graph-invalid", "Materialized graph failed independent validation.")],
    };
  }
  if (!isRecord(candidate) || !isRecord(candidate.mapping) || !isRecord(candidate.elatura_snapshot)) {
    return { ok: false, issues: [issue("$.output", "output-shape-invalid", "Snapshot envelope is invalid.")] };
  }

  const problems: ValidationIssue[] = [];
  const metadata = candidate.elatura_snapshot;
  const selectedIds = Object.keys(candidate.mapping).sort();
  const expectedIds = [...plan.selectedIds].sort();
  if (selectedIds.length !== expectedIds.length || selectedIds.some((id, index) => id !== expectedIds[index])) {
    problems.push(issue("$.mapping", "output-selection-mismatch", "Output mapping differs from the selection plan."));
  }
  if (candidate.current_node !== source.currentNode) {
    problems.push(issue("$.current_node", "output-current-node-mismatch", "Output current node differs from source."));
  }

  const selected = new Set(plan.selectedIds);
  let omittedChildEdgeCount = 0;
  for (const nodeId of expectedIds) {
    context.checkpoint();
    const original = source.mapping[nodeId];
    const materialized = candidate.mapping[nodeId];
    if (!original || !isRecord(materialized)) {
      problems.push(issue("$.mapping", "output-node-missing", "A selected output node is missing."));
      continue;
    }
    const expectedParent = original.parent !== null && selected.has(original.parent) ? original.parent : null;
    if (materialized.parent !== expectedParent) {
      problems.push(issue("$.mapping", "output-parent-boundary-invalid", "A materialized parent boundary is invalid."));
    }
    const expectedChildren = original.children.filter((childId) => selected.has(childId));
    omittedChildEdgeCount += original.children.length - expectedChildren.length;
    if (!equalJsonLike(materialized.children, expectedChildren, context)) {
      problems.push(issue("$.mapping", "output-child-boundary-invalid", "Materialized child boundaries are invalid."));
    }
    for (const key of Object.keys(original.raw).sort()) {
      if (key === "parent" || key === "children") continue;
      if (!(key in materialized) || !equalJsonLike(materialized[key], original.raw[key], context)) {
        problems.push(issue("$.mapping", "output-retained-field-changed", "A retained node field changed."));
        break;
      }
    }
    const allowedKeys = new Set([...Object.keys(original.raw), "parent", "children"]);
    if (Object.keys(materialized).some((key) => !allowedKeys.has(key))) {
      problems.push(issue("$.mapping", "output-node-field-added", "Unexpected node fields were added."));
    }
  }

  for (const key of Object.keys(source.raw).sort()) {
    if (key === "mapping" || key === "current_node" || key === "elatura_snapshot") continue;
    if (!(key in candidate) || !equalJsonLike(candidate[key], source.raw[key], context)) {
      problems.push(issue("$", "output-top-level-field-changed", "A top-level field changed."));
      break;
    }
  }
  const allowedTopLevel = new Set([...Object.keys(source.raw), "mapping", "current_node", "elatura_snapshot"]);
  if (Object.keys(candidate).some((key) => !allowedTopLevel.has(key))) {
    problems.push(issue("$", "output-top-level-field-added", "Unexpected top-level fields were added."));
  }

  const expectedParentBoundary = expectedBoundary(plan);
  const expectedRootAnchor = plan.selectedIds.find((nodeId) => plan.reasons[nodeId]?.includes("root-anchor"));
  const expectedDisconnectedRootAnchor =
    expectedRootAnchor !== undefined &&
    !plan.retainedActivePathIds.includes(expectedRootAnchor) &&
    source.mapping[expectedRootAnchor]?.parent === null;
  if (
    metadata.schemaVersion !== 1 ||
    metadata.synthetic !== true ||
    metadata.sourceAdapter !== CHATGPT_ADAPTER_ID ||
    metadata.sourceAdapterVersion !== CHATGPT_ADAPTER_VERSION ||
    metadata.selectedNodeCount !== plan.selectedIds.length ||
    metadata.omittedNodeCount !== Object.keys(source.mapping).length - plan.selectedIds.length ||
    metadata.omittedChildEdgeCount !== omittedChildEdgeCount ||
    !boundaryEqual(metadata.parentBoundary, expectedParentBoundary) ||
    metadata.disconnectedRootAnchor !== expectedDisconnectedRootAnchor
  ) {
    problems.push(issue("$.elatura_snapshot", "output-metadata-invalid", "Snapshot metadata is inconsistent."));
  }

  if (problems.length > 0) return { ok: false, issues: problems };
  return { ok: true, value: candidate as ChatGptSyntheticSnapshot, warnings: [] };
}

export function createSyntheticChatGptPipelineAdapter(
  policyOverrides?: Partial<SyntheticChatGptPolicy>,
): FailOpenPipelineAdapter<ChatGptConversation, ActivePathSelectionPlan, ChatGptSyntheticSnapshot> {
  const policy = resolvePolicy(policyOverrides);
  const adapter: FailOpenPipelineAdapter<ChatGptConversation, ActivePathSelectionPlan, ChatGptSyntheticSnapshot> = {
    id: SYNTHETIC_CHATGPT_ADAPTER_ID,
    version: SYNTHETIC_CHATGPT_ADAPTER_VERSION,
    capabilities: SYNTHETIC_CHATGPT_CAPABILITIES,
    detect: (input) => detection(input),
    validateInput: (input) => validateChatGptConversation(input),
    fingerprint: (source, context): StructuralFingerprint => {
      context.consumeOperations();
      const fingerprint = fingerprintChatGptConversation(source);
      return {
        ...fingerprint,
        adapter: SYNTHETIC_CHATGPT_ADAPTER_ID,
        adapterVersion: SYNTHETIC_CHATGPT_ADAPTER_VERSION,
      };
    },
    plan: (source) => {
      const invalidPolicy = policyIssues(policy);
      if (invalidPolicy.length > 0) return { ok: false as const, issues: invalidPolicy };
      return planActivePathWindow(source.mapping, source.currentNode, {
        maxGroups: policy.maxGroups,
        includeRoot: policy.includeRoot,
        includeSiblingRoots: policy.includeBranchSiblings,
        groupKey: fixtureGroupKey,
      });
    },
    materialize: (source, plan, _fingerprint, context) => materializeSyntheticSnapshot(source, plan, context),
    validateOutput: (candidate, source, plan, _fingerprint, context) =>
      validateSyntheticSnapshot(candidate, source, plan, context),
  };
  return Object.freeze(adapter);
}

export function runSyntheticChatGptPipeline<TInput>(
  authoritativeInput: TInput,
  policy?: Partial<SyntheticChatGptPolicy>,
  options?: RunFailOpenPipelineOptions,
): PipelineDecision<TInput, ChatGptSyntheticSnapshot> {
  return runFailOpenPipeline(authoritativeInput, createSyntheticChatGptPipelineAdapter(policy), options);
}
