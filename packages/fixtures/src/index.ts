// SPDX-License-Identifier: MPL-2.0

export type SyntheticConversationOptions = {
  turnGroups?: number;
  branchEvery?: number;
  hiddenNodesPerTurn?: number;
  payloadBytesPerMessage?: number;
  seed?: number;
  includeUnknownFields?: boolean;
};

export type SyntheticFixtureNode = {
  id: string;
  parent: string | null;
  children: string[];
  message?: Record<string, unknown>;
  elatura_fixture: {
    turnGroup: string;
    kind: "root" | "user" | "assistant" | "branch-assistant" | "hidden";
    active: boolean;
  };
  future_node_field?: Record<string, unknown>;
};

export type SyntheticConversationFixture = {
  current_node: string;
  mapping: Record<string, SyntheticFixtureNode>;
  title: string;
  create_time: number;
  update_time: number;
  elatura_fixture: {
    schemaVersion: 1;
    seed: number;
    turnGroups: number;
    branchEvery: number;
    hiddenNodesPerTurn: number;
    payloadBytesPerMessage: number;
    synthetic: true;
  };
  future_top_level_field?: Record<string, unknown>;
};

const MAX_ESTIMATED_NODES = 500_000;
const MAX_ESTIMATED_PAYLOAD_BYTES = 512 * 1024 * 1024;

const LIMITS = {
  turnGroups: 100_000,
  branchEvery: 100_000,
  hiddenNodesPerTurn: 100,
  payloadBytesPerMessage: 1_000_000,
};

function integerOption(name: keyof typeof LIMITS, value: number, minimum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > LIMITS[name]) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${LIMITS[name]}.`);
  }
  return value;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function payload(bytes: number, random: () => number): string {
  if (bytes === 0) return "";
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let block = "";
  for (let index = 0; index < 64; index += 1) {
    block += alphabet[Math.floor(random() * alphabet.length)] ?? "x";
  }
  return block.repeat(Math.ceil(bytes / block.length)).slice(0, bytes);
}

function message(
  id: string,
  role: "user" | "assistant" | "tool",
  text: string,
  turn: number,
  kind: SyntheticFixtureNode["elatura_fixture"]["kind"],
): Record<string, unknown> {
  return {
    id,
    author: { role },
    create_time: turn,
    content: { content_type: "text", parts: [text] },
    metadata: { synthetic: true, fixtureKind: kind },
  };
}

export function generateSyntheticConversation(
  options: SyntheticConversationOptions = {},
): SyntheticConversationFixture {
  const turnGroups = integerOption("turnGroups", options.turnGroups ?? 100, 1);
  const branchEvery = integerOption("branchEvery", options.branchEvery ?? 0, 0);
  const hiddenNodesPerTurn = integerOption(
    "hiddenNodesPerTurn",
    options.hiddenNodesPerTurn ?? 0,
    0,
  );
  const payloadBytesPerMessage = integerOption(
    "payloadBytesPerMessage",
    options.payloadBytesPerMessage ?? 256,
    0,
  );
  const rawSeed = options.seed ?? 1;
  if (!Number.isInteger(rawSeed) || rawSeed < 0 || rawSeed > 0xffff_ffff) {
    throw new RangeError("seed must be an integer between 0 and 4294967295.");
  }
  const seed = rawSeed >>> 0;
  const hiddenPayloadBytes =
    payloadBytesPerMessage === 0 ? 0 : Math.max(16, Math.floor(payloadBytesPerMessage / 4));
  const branchCount = branchEvery > 0 ? Math.floor(turnGroups / branchEvery) : 0;
  const estimatedNodes = 1 + turnGroups * (2 + hiddenNodesPerTurn) + branchCount;
  if (estimatedNodes > MAX_ESTIMATED_NODES) {
    throw new RangeError(
      `Synthetic node estimate ${estimatedNodes} exceeds the ${MAX_ESTIMATED_NODES} node safety limit.`,
    );
  }
  const estimatedPayloadBytes =
    turnGroups * payloadBytesPerMessage * 2 +
    branchCount * payloadBytesPerMessage +
    turnGroups * hiddenNodesPerTurn * hiddenPayloadBytes;
  if (estimatedPayloadBytes > MAX_ESTIMATED_PAYLOAD_BYTES) {
    throw new RangeError(
      `Synthetic message payload estimate ${estimatedPayloadBytes} exceeds the ${MAX_ESTIMATED_PAYLOAD_BYTES} byte safety limit.`,
    );
  }
  const includeUnknownFields = options.includeUnknownFields ?? true;
  const random = mulberry32(seed);
  const mapping: Record<string, SyntheticFixtureNode> = {};
  let nextNode = 0;

  const nextId = (kind: string): string => `synthetic-${seed.toString(36)}-${nextNode++}-${kind}`;
  const addNode = (node: SyntheticFixtureNode): void => {
    mapping[node.id] = node;
    if (node.parent !== null) {
      const parent = mapping[node.parent];
      if (!parent) throw new Error(`Synthetic fixture parent ${node.parent} does not exist.`);
      parent.children.push(node.id);
    }
  };

  const rootId = nextId("root");
  addNode({
    id: rootId,
    parent: null,
    children: [],
    elatura_fixture: { turnGroup: "root", kind: "root", active: true },
    ...(includeUnknownFields
      ? { future_node_field: { retained: true, token: Math.floor(random() * 1_000_000) } }
      : {}),
  });

  let activeLeaf = rootId;
  for (let turn = 1; turn <= turnGroups; turn += 1) {
    const turnGroup = `turn-${turn}`;
    const userId = nextId("user");
    addNode({
      id: userId,
      parent: activeLeaf,
      children: [],
      message: message(
        userId,
        "user",
        payload(payloadBytesPerMessage, random),
        turn,
        "user",
      ),
      elatura_fixture: { turnGroup, kind: "user", active: true },
      ...(includeUnknownFields ? { future_node_field: { turn, roleHint: "user" } } : {}),
    });

    const assistantId = nextId("assistant");
    addNode({
      id: assistantId,
      parent: userId,
      children: [],
      message: message(
        assistantId,
        "assistant",
        payload(payloadBytesPerMessage, random),
        turn,
        "assistant",
      ),
      elatura_fixture: { turnGroup, kind: "assistant", active: true },
      ...(includeUnknownFields ? { future_node_field: { turn, roleHint: "assistant" } } : {}),
    });
    activeLeaf = assistantId;

    if (branchEvery > 0 && turn % branchEvery === 0) {
      const branchId = nextId("branch");
      addNode({
        id: branchId,
        parent: userId,
        children: [],
        message: message(
          branchId,
          "assistant",
          payload(payloadBytesPerMessage, random),
          turn,
          "branch-assistant",
        ),
        elatura_fixture: { turnGroup, kind: "branch-assistant", active: false },
        ...(includeUnknownFields ? { future_node_field: { turn, alternate: true } } : {}),
      });
    }

    for (let hidden = 0; hidden < hiddenNodesPerTurn; hidden += 1) {
      const hiddenId = nextId("hidden");
      addNode({
        id: hiddenId,
        parent: activeLeaf,
        children: [],
        message: message(
          hiddenId,
          "tool",
          payload(hiddenPayloadBytes, random),
          turn,
          "hidden",
        ),
        elatura_fixture: { turnGroup, kind: "hidden", active: true },
        ...(includeUnknownFields ? { future_node_field: { turn, hiddenIndex: hidden } } : {}),
      });
      activeLeaf = hiddenId;
    }
  }

  return {
    current_node: activeLeaf,
    mapping,
    title: "Synthetic oversized conversation",
    create_time: 0,
    update_time: turnGroups,
    elatura_fixture: {
      schemaVersion: 1,
      seed,
      turnGroups,
      branchEvery,
      hiddenNodesPerTurn,
      payloadBytesPerMessage,
      synthetic: true,
    },
    ...(includeUnknownFields
      ? { future_top_level_field: { retained: true, generatedBy: "@elatura/fixtures" } }
      : {}),
  };
}

function cloneFixture(source: SyntheticConversationFixture): SyntheticConversationFixture {
  return structuredClone(source);
}

function firstParentWithChild(
  source: SyntheticConversationFixture,
): SyntheticFixtureNode {
  const parent = Object.values(source.mapping).find((node) => node.children.length > 0);
  if (!parent) throw new Error("Fixture has no child reference to corrupt.");
  return parent;
}

function uniqueCorruptionId(source: SyntheticConversationFixture, suffix: string): string {
  let candidate = `synthetic-corrupt-${suffix}`;
  let counter = 0;
  while (source.mapping[candidate]) candidate = `synthetic-corrupt-${suffix}-${++counter}`;
  return candidate;
}

export function corruptMissingChild(
  source: SyntheticConversationFixture,
): SyntheticConversationFixture {
  const copy = cloneFixture(source);
  const parent = firstParentWithChild(copy);
  parent.children[0] = "synthetic-missing-node";
  return copy;
}

export function corruptReciprocalLink(
  source: SyntheticConversationFixture,
): SyntheticConversationFixture {
  const copy = cloneFixture(source);
  const child = Object.values(copy.mapping).find((node) => node.parent !== null);
  if (!child?.parent) throw new Error("Fixture has no parent link to corrupt.");
  const parent = copy.mapping[child.parent];
  if (!parent) throw new Error("Fixture parent does not resolve before corruption.");
  parent.children = parent.children.filter((id) => id !== child.id);
  return copy;
}

export function corruptActiveCycle(
  source: SyntheticConversationFixture,
): SyntheticConversationFixture {
  const copy = cloneFixture(source);
  const root = Object.values(copy.mapping).find((node) => node.parent === null);
  const current = copy.mapping[copy.current_node];
  if (!root || !current) throw new Error("Fixture is missing a root or current node.");
  root.parent = current.id;
  if (!current.children.includes(root.id)) current.children.push(root.id);
  return copy;
}

export function corruptDuplicateChild(
  source: SyntheticConversationFixture,
): SyntheticConversationFixture {
  const copy = cloneFixture(source);
  const parent = firstParentWithChild(copy);
  const child = parent.children[0];
  if (!child) throw new Error("Fixture has no child reference to duplicate.");
  parent.children.push(child);
  return copy;
}

export function corruptNodeIdMismatch(
  source: SyntheticConversationFixture,
): SyntheticConversationFixture {
  const copy = cloneFixture(source);
  const entry = Object.entries(copy.mapping)[0];
  if (!entry) throw new Error("Fixture has no node id to corrupt.");
  const [key, node] = entry;
  node.id = `${key}-mismatch`;
  return copy;
}

export function corruptDisconnectedCycle(
  source: SyntheticConversationFixture,
): SyntheticConversationFixture {
  const copy = cloneFixture(source);
  const firstId = uniqueCorruptionId(copy, "disconnected-a");
  const secondId = uniqueCorruptionId(copy, "disconnected-b");
  copy.mapping[firstId] = {
    id: firstId,
    parent: secondId,
    children: [secondId],
    elatura_fixture: { turnGroup: "corrupt-disconnected", kind: "hidden", active: false },
  };
  copy.mapping[secondId] = {
    id: secondId,
    parent: firstId,
    children: [firstId],
    elatura_fixture: { turnGroup: "corrupt-disconnected", kind: "hidden", active: false },
  };
  return copy;
}

export function corruptMalformedRoot(
  source: SyntheticConversationFixture,
): SyntheticConversationFixture {
  const copy = cloneFixture(source);
  const root = Object.values(copy.mapping).find((node) => node.parent === null);
  if (!root) throw new Error("Fixture has no root to corrupt.");
  (root as unknown as { parent: unknown }).parent = 42;
  return copy;
}

export function reorderSyntheticConversationKeys(
  source: SyntheticConversationFixture,
): SyntheticConversationFixture {
  const copy = cloneFixture(source);
  const reversedMapping = Object.fromEntries(
    Object.entries(copy.mapping)
      .reverse()
      .map(([id, node]) => [
        id,
        Object.fromEntries(Object.entries(node).reverse()) as unknown as SyntheticFixtureNode,
      ]),
  );
  copy.mapping = reversedMapping;
  return Object.fromEntries(
    Object.entries(copy).reverse(),
  ) as unknown as SyntheticConversationFixture;
}
