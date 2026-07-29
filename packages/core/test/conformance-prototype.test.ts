// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  defineAdapterCapabilities,
  type ApplicationAdapter,
} from "../src/adapter-contract.js";
import {
  runAdapterConformance,
  type AdapterConformanceResult,
  type AdapterConformanceStage,
} from "../src/conformance.js";

type DangerousRecord = Record<string, unknown>;

function dangerousRecord(marker: number): DangerousRecord {
  const value = Object.create(null) as DangerousRecord;
  for (const key of ["__proto__", "constructor", "prototype"] as const) {
    Object.defineProperty(value, key, {
      value: { marker, key },
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return value;
}

function isDangerousRecord(input: unknown): input is DangerousRecord {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function marker(input: DangerousRecord): number {
  const candidate = input.__proto__;
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    !("marker" in candidate) ||
    typeof candidate.marker !== "number"
  ) {
    return -1;
  }
  return candidate.marker;
}

const stableAdapter: ApplicationAdapter<DangerousRecord> = {
  id: "prototype-neutral",
  version: "1.0.0",
  capabilities: defineAdapterCapabilities(),
  detect: isDangerousRecord,
  validate(input) {
    return isDangerousRecord(input)
      ? { ok: true, value: dangerousRecord(marker(input)), warnings: [] }
      : { ok: false, issues: [{ path: "$", code: "invalid", message: "Expected an object." }] };
  },
  fingerprint() {
    return {
      adapter: "prototype-neutral",
      adapterVersion: "1.0.0",
      shape: "prototype-sensitive-record",
      hash: "fixed",
    };
  },
};

function expectIssue(
  result: AdapterConformanceResult,
  stage: AdapterConformanceStage,
  code: string,
): void {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.issues.some((item) => item.stage === stage && item.code === code)).toBe(true);
  }
}

describe("prototype-neutral conformance snapshots", () => {
  it("accepts prototype-sensitive keys as ordinary deterministic data", () => {
    expect(
      runAdapterConformance(stableAdapter, { validInput: dangerousRecord(1) }),
    ).toEqual({ ok: true, issues: [] });
  });

  it("detects mutation that changes only an own __proto__ data property", () => {
    const adapter: typeof stableAdapter = {
      ...stableAdapter,
      detect(input) {
        if (!isDangerousRecord(input)) return false;
        Object.defineProperty(input, "__proto__", {
          value: { marker: 2, key: "__proto__" },
          enumerable: true,
          configurable: true,
          writable: true,
        });
        return true;
      },
    };
    expectIssue(
      runAdapterConformance(adapter, { validInput: dangerousRecord(1) }),
      "detect",
      "input-mutated",
    );
  });

  it("detects non-determinism visible only through prototype-sensitive keys", () => {
    let validationCall = 0;
    const adapter: typeof stableAdapter = {
      ...stableAdapter,
      validate(input) {
        if (!isDangerousRecord(input)) {
          return { ok: false, issues: [{ path: "$", code: "invalid", message: "Expected an object." }] };
        }
        validationCall += 1;
        return { ok: true, value: dangerousRecord(validationCall), warnings: [] };
      },
    };
    expectIssue(
      runAdapterConformance(adapter, { validInput: dangerousRecord(1) }),
      "validate",
      "non-deterministic",
    );
  });

  it("detects output-validator mutation of a detached __proto__ data property", () => {
    const adapter: ApplicationAdapter<
      { value: number },
      { selected: true },
      DangerousRecord,
      { selected: true }
    > = {
      id: "prototype-output",
      version: "1.0.0",
      capabilities: defineAdapterCapabilities({
        plan: "supported",
        materialize: "supported",
        validateOutput: "supported",
      }),
      detect(input) {
        return typeof input === "object" && input !== null && "value" in input;
      },
      validate(input) {
        return typeof input === "object" && input !== null && "value" in input && typeof input.value === "number"
          ? { ok: true, value: { value: input.value }, warnings: [] }
          : { ok: false, issues: [{ path: "$", code: "invalid", message: "Expected a value." }] };
      },
      fingerprint() {
        return {
          adapter: "prototype-output",
          adapterVersion: "1.0.0",
          shape: "{value:number}",
          hash: "fixed",
        };
      },
      plan() {
        return { ok: true, value: { selected: true }, warnings: [] };
      },
      materialize() {
        return { ok: true, value: dangerousRecord(1), warnings: [] };
      },
      validateOutput(output) {
        if (!isDangerousRecord(output)) {
          return { ok: false, issues: [{ path: "$", code: "invalid", message: "Expected an object." }] };
        }
        Object.defineProperty(output, "__proto__", {
          value: { marker: 2, key: "__proto__" },
          enumerable: true,
          configurable: true,
          writable: true,
        });
        return { ok: true, value: dangerousRecord(2), warnings: [] };
      },
    };

    expectIssue(
      runAdapterConformance(adapter, {
        validInput: { value: 1 },
        planOptions: { selected: true },
      }),
      "validateOutput",
      "input-mutated",
    );
  });
});
