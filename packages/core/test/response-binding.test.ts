// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  RESPONSE_BINDING_STAGES,
  prepareResponseBinding,
  type ResponseBindingDependencies,
} from "../src/response-binding.js";

type Metadata = Readonly<{ responseClass: string }>;
type Output = Readonly<{ value: string }>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function chunksOf(...values: string[]): Uint8Array[] {
  return values.map((value) => encoder.encode(value));
}

function dependencies(
  overrides: Partial<ResponseBindingDependencies<Metadata, string, Output>> = {},
): ResponseBindingDependencies<Metadata, string, Output> {
  return {
    select: () => ({ kind: "match" }),
    authorize: () => ({ eligible: true }),
    decode: (bytes) => decoder.decode(bytes),
    runPipeline: (value) => ({ kind: "transformed", output: { value: value.toUpperCase() } }),
    serialize: (output) => encoder.encode(output.value),
    ...overrides,
  };
}

function expectExactPassThrough(
  original: readonly Uint8Array[],
  result: ReturnType<typeof prepareResponseBinding>,
): void {
  expect(result.kind).toBe("pass-through");
  expect(result.chunks).toHaveLength(original.length);
  result.chunks.forEach((chunk, index) => {
    expect(chunk).toBe(original[index]);
    expect([...chunk]).toEqual([...(original[index] ?? [])]);
  });
}

describe("response binding preparation", () => {
  it("transforms only after selection, authorization, collection, decode, pipeline, and serialization", () => {
    const original = chunksOf("ab", "", "cd");
    const before = original.map((chunk) => [...chunk]);
    const result = prepareResponseBinding(
      { responseClass: "synthetic-candidate" },
      original,
      dependencies(),
    );

    expect(result.kind).toBe("transformed");
    expect(result.diagnostic.completedStages).toEqual(RESPONSE_BINDING_STAGES);
    expect(result.diagnostic.reasonCode).toBe("transformed");
    expect(result.diagnostic.inputByteCount).toBe(4);
    expect(result.diagnostic.outputByteCount).toBe(4);
    expect(result.chunks).toHaveLength(1);
    expect(decoder.decode(result.chunks[0])).toBe("ABCD");
    expect(original.map((chunk) => [...chunk])).toEqual(before);
  });

  it.each([
    ["miss", "selector-miss"],
    ["ambiguous", "selector-ambiguous"],
  ] as const)("returns exact chunks for selector %s", (kind, reasonCode) => {
    const original = chunksOf("private", "-bytes");
    const result = prepareResponseBinding(
      { responseClass: "other" },
      original,
      dependencies({ select: () => ({ kind }) }),
    );
    expectExactPassThrough(original, result);
    expect(result.diagnostic.reasonCode).toBe(reasonCode);
  });

  it("authorizes before decode or pipeline invocation", () => {
    let decoded = false;
    let pipelineRan = false;
    const original = chunksOf("private-bytes");
    const result = prepareResponseBinding(
      { responseClass: "synthetic-candidate" },
      original,
      dependencies({
        authorize: () => ({ eligible: false }),
        decode: () => {
          decoded = true;
          return "decoded";
        },
        runPipeline: () => {
          pipelineRan = true;
          return { kind: "pass-through" };
        },
      }),
    );
    expectExactPassThrough(original, result);
    expect(result.diagnostic.reasonCode).toBe("authorization-denied");
    expect(decoded).toBe(false);
    expect(pipelineRan).toBe(false);
  });

  it("returns original bytes rather than parsed or reserialized bytes for pipeline pass-through", () => {
    const original = chunksOf("{  \"value\" : 1 }", "\n");
    const result = prepareResponseBinding(
      { responseClass: "synthetic-candidate" },
      original,
      dependencies({ runPipeline: () => ({ kind: "pass-through" }) }),
    );
    expectExactPassThrough(original, result);
    expect(result.diagnostic.reasonCode).toBe("pipeline-pass-through");
  });

  it("fails open above chunk and body limits without decoding", () => {
    let decoded = false;
    const base = dependencies({
      decode: () => {
        decoded = true;
        return "decoded";
      },
    });
    const tooMany = chunksOf("a", "b");
    const chunkResult = prepareResponseBinding(
      { responseClass: "synthetic-candidate" },
      tooMany,
      base,
      { limits: { maxChunks: 1 } },
    );
    expectExactPassThrough(tooMany, chunkResult);
    expect(chunkResult.diagnostic.reasonCode).toBe("chunk-limit-exceeded");

    const tooLarge = chunksOf("ab", "cd");
    const byteResult = prepareResponseBinding(
      { responseClass: "synthetic-candidate" },
      tooLarge,
      base,
      { limits: { maxBodyBytes: 3 } },
    );
    expectExactPassThrough(tooLarge, byteResult);
    expect(byteResult.diagnostic.reasonCode).toBe("body-byte-limit-exceeded");
    expect(decoded).toBe(false);
  });

  it("handles empty bodies, empty chunks, and one-byte chunks deterministically", () => {
    const cases = [[], chunksOf(""), chunksOf("a", "b", "c")];
    for (const original of cases) {
      const first = prepareResponseBinding(
        { responseClass: "synthetic-candidate" },
        original,
        dependencies(),
      );
      const second = prepareResponseBinding(
        { responseClass: "synthetic-candidate" },
        original,
        dependencies(),
      );
      expect(first).toEqual(second);
    }
  });

  it("copies serialized output before publishing it", () => {
    const serialized = encoder.encode("RESULT");
    const result = prepareResponseBinding(
      { responseClass: "synthetic-candidate" },
      chunksOf("input"),
      dependencies({ serialize: () => serialized }),
    );
    expect(result.kind).toBe("transformed");
    if (result.kind !== "transformed") return;
    expect(result.chunks[0]).not.toBe(serialized);
    serialized.fill(0);
    expect(decoder.decode(result.chunks[0])).toBe("RESULT");
  });

  it.each([
    ["select", "selector-exception"],
    ["authorize", "authorization-exception"],
    ["decode", "decode-exception"],
    ["pipeline", "pipeline-exception"],
    ["serialize", "serialize-exception"],
  ] as const)("returns exact pass-through when %s throws", (stage, reasonCode) => {
    const original = chunksOf("original", "bytes");
    const overrides: Partial<ResponseBindingDependencies<Metadata, string, Output>> = {};
    if (stage === "select") overrides.select = () => { throw new Error("private selector detail"); };
    if (stage === "authorize") overrides.authorize = () => { throw new Error("private authorization detail"); };
    if (stage === "decode") overrides.decode = () => { throw new Error("private body detail"); };
    if (stage === "pipeline") overrides.runPipeline = () => { throw new Error("private pipeline detail"); };
    if (stage === "serialize") overrides.serialize = () => { throw new Error("private output detail"); };

    const result = prepareResponseBinding(
      { responseClass: "synthetic-candidate" },
      original,
      dependencies(overrides),
    );
    expectExactPassThrough(original, result);
    expect(result.diagnostic.reasonCode).toBe(reasonCode);
    expect(JSON.stringify(result.diagnostic)).not.toContain("private");
  });

  it("rejects malformed dependency methods and results without invoking accessors", () => {
    let getterInvoked = false;
    const candidate = dependencies() as unknown as Record<string, unknown>;
    Object.defineProperty(candidate, "decode", {
      enumerable: true,
      get: () => {
        getterInvoked = true;
        return () => "decoded";
      },
    });
    const original = chunksOf("bytes");
    const malformedDependencies = prepareResponseBinding(
      { responseClass: "synthetic-candidate" },
      original,
      candidate as unknown as ResponseBindingDependencies<Metadata, string, Output>,
    );
    expectExactPassThrough(original, malformedDependencies);
    expect(malformedDependencies.diagnostic.reasonCode).toBe("configuration-invalid");
    expect(getterInvoked).toBe(false);

    const malformedSelection = prepareResponseBinding(
      { responseClass: "synthetic-candidate" },
      original,
      dependencies({ select: (() => ({})) as never }),
    );
    expectExactPassThrough(original, malformedSelection);
    expect(malformedSelection.diagnostic.reasonCode).toBe("selector-invalid");

    const malformedAuthorization = prepareResponseBinding(
      { responseClass: "synthetic-candidate" },
      original,
      dependencies({ authorize: (() => ({})) as never }),
    );
    expectExactPassThrough(original, malformedAuthorization);
    expect(malformedAuthorization.diagnostic.reasonCode).toBe("authorization-invalid");

    const malformedPipeline = prepareResponseBinding(
      { responseClass: "synthetic-candidate" },
      original,
      dependencies({ runPipeline: (() => ({})) as never }),
    );
    expectExactPassThrough(original, malformedPipeline);
    expect(malformedPipeline.diagnostic.reasonCode).toBe("pipeline-invalid");
  });

  it("rejects nonstandard chunks and invalid serializer output", () => {
    class CustomChunk extends Uint8Array {}
    const custom = new CustomChunk([1, 2, 3]);
    const chunkResult = prepareResponseBinding(
      { responseClass: "synthetic-candidate" },
      [custom],
      dependencies(),
    );
    expectExactPassThrough([custom], chunkResult);
    expect(chunkResult.diagnostic.reasonCode).toBe("chunk-invalid");

    const original = chunksOf("bytes");
    const serializeResult = prepareResponseBinding(
      { responseClass: "synthetic-candidate" },
      original,
      dependencies({ serialize: (() => "not-bytes") as never }),
    );
    expectExactPassThrough(original, serializeResult);
    expect(serializeResult.diagnostic.reasonCode).toBe("serialize-invalid");
  });

  it("cancels before selection without exposing transformed bytes", () => {
    const original = chunksOf("private", "bytes");
    const result = prepareResponseBinding(
      { responseClass: "synthetic-candidate" },
      original,
      dependencies(),
      { cancellation: Object.freeze({ aborted: true }) },
    );
    expectExactPassThrough(original, result);
    expect(result.diagnostic.reasonCode).toBe("cancelled");
  });

  it("cancels between injected stages without exposing transformed bytes", () => {
    const checkpoints = ["authorize", "collect", "pipeline", "serialize"] as const;
    for (const checkpoint of checkpoints) {
      const cancellation = { aborted: false };
      const original = chunksOf("private", "bytes");
      const deps = dependencies({
        select: () => {
          if (checkpoint === "authorize") cancellation.aborted = true;
          return { kind: "match" };
        },
        authorize: () => {
          if (checkpoint === "collect") cancellation.aborted = true;
          return { eligible: true };
        },
        decode: (bytes) => {
          if (checkpoint === "pipeline") cancellation.aborted = true;
          return decoder.decode(bytes);
        },
        runPipeline: (value) => {
          if (checkpoint === "serialize") cancellation.aborted = true;
          return { kind: "transformed", output: { value } };
        },
      });
      const result = prepareResponseBinding(
        { responseClass: "synthetic-candidate" },
        original,
        deps,
        { cancellation },
      );
      expectExactPassThrough(original, result);
      expect(result.diagnostic.reasonCode).toBe("cancelled");
    }
  });

  it("keeps diagnostics fixed and content-free", () => {
    const secret = "private-response-token-9321";
    const original = chunksOf(secret);
    const result = prepareResponseBinding(
      { responseClass: secret },
      original,
      dependencies({ runPipeline: () => ({ kind: "pass-through" }) }),
    );
    const serialized = JSON.stringify(result.diagnostic);
    expect(serialized).not.toContain(secret);
    expect(Object.keys(result.diagnostic).sort()).toEqual([
      "bindingVersion",
      "chunkCount",
      "completedStages",
      "decision",
      "inputByteCount",
      "outputByteCount",
      "reasonCode",
      "schemaVersion",
      "stage",
    ]);
  });
});
