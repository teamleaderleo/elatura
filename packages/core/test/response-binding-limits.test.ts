// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  prepareResponseBinding,
  type ResponseBindingDependencies,
} from "../src/response-binding.js";

type Metadata = Readonly<{ responseClass: string }>;

type Output = Readonly<{ text: string }>;

const encoder = new TextEncoder();

function dependencies(
  overrides: Partial<ResponseBindingDependencies<Metadata, string, Output>> = {},
): ResponseBindingDependencies<Metadata, string, Output> {
  return {
    select: () => ({ kind: "match" }),
    authorize: () => ({ eligible: true }),
    decode: (bytes) => new TextDecoder().decode(bytes),
    runPipeline: (text) => ({ kind: "transformed", output: { text } }),
    serialize: (output) => encoder.encode(output.text),
    ...overrides,
  };
}

describe("response binding resource boundaries", () => {
  it("returns the authoritative chunk list without copying when the chunk limit is exceeded", () => {
    let decoded = false;
    const chunks = [encoder.encode("a"), encoder.encode("b")];
    const result = prepareResponseBinding(
      { responseClass: "synthetic-candidate" },
      chunks,
      dependencies({
        decode: () => {
          decoded = true;
          return "decoded";
        },
      }),
      { limits: { maxChunks: 1 } },
    );

    expect(result.kind).toBe("pass-through");
    expect(result.chunks).toBe(chunks);
    expect(result.diagnostic.reasonCode).toBe("chunk-limit-exceeded");
    expect(decoded).toBe(false);
  });

  it("withholds serialized output above its independent byte limit", () => {
    const chunks = [encoder.encode("input")];
    const result = prepareResponseBinding(
      { responseClass: "synthetic-candidate" },
      chunks,
      dependencies({ serialize: () => encoder.encode("oversized-output") }),
      { limits: { maxOutputBytes: 4 } },
    );

    expect(result.kind).toBe("pass-through");
    expect(result.chunks).toBe(chunks);
    expect(result.diagnostic.reasonCode).toBe("output-byte-limit-exceeded");
    expect(result.diagnostic.outputByteCount).toBe(result.diagnostic.inputByteCount);
  });
});
