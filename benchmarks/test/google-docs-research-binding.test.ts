// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import {
  GoogleDocsResearchBindingRegistryV1,
  MAX_GOOGLE_DOCS_RESEARCH_BINDINGS,
} from "../src/google-docs-research-binding.js";

function binding(
  laneRef = "gdocs-research-switch-01",
  laneGeneration = 1,
  projectionRef = "chrome-session-tab-11",
  mode: "initial" | "verified-continuity" | "generation-advance" = "initial",
) {
  return {
    version: 1,
    laneRef,
    laneGeneration,
    projectionRef,
    mode,
  };
}

describe("Google Docs research binding registry", () => {
  it("creates a content-free receipt while keeping projectionRef private", () => {
    const registry = new GoogleDocsResearchBindingRegistryV1();
    const receipt = registry.bind(binding());
    expect(receipt).toEqual({
      version: 1,
      laneRef: "gdocs-research-switch-01",
      laneGeneration: 1,
      bindingRevision: 1,
      mode: "initial",
      projectionChanged: false,
      grantsWorkAuthority: false,
      authorizesWorkDispatch: false,
    });
    expect(Object.hasOwn(receipt, "projectionRef")).toBe(false);
    expect(registry.snapshot()).toEqual([
      {
        laneRef: "gdocs-research-switch-01",
        laneGeneration: 1,
        bindingRevision: 1,
      },
    ]);
  });

  it("admits only the generated research lane set and #136 Chromium projection tokens", () => {
    const registry = new GoogleDocsResearchBindingRegistryV1();
    expect(() =>
      registry.bind(binding("https://docs.google.com/private", 1)),
    ).toThrow(/generated #118 research lane/u);
    expect(() =>
      registry.bind(binding("gdocs-research-switch-09", 1)),
    ).toThrow(/generated #118 research lane/u);
    expect(() =>
      registry.bind(
        binding(
          "gdocs-research-switch-01",
          1,
          "https://docs.google.com/document/d/provider-id",
        ),
      ),
    ).toThrow(/Chromium session-tab token/u);
  });

  it("requires first binding to use generation one and refuses duplicate initial binding", () => {
    const registry = new GoogleDocsResearchBindingRegistryV1();
    expect(() => registry.bind(binding("gdocs-research-switch-01", 2))).toThrow(
      /initial-generation-must-be-one/u,
    );
    registry.bind(binding());
    expect(() => registry.bind(binding())).toThrow(/lane-already-seen/u);
  });

  it("permits verified same-generation continuity onto a recovered projection", () => {
    const registry = new GoogleDocsResearchBindingRegistryV1();
    registry.bind(binding());
    const receipt = registry.bind(
      binding(
        "gdocs-research-switch-01",
        1,
        "chrome-session-tab-22",
        "verified-continuity",
      ),
    );
    expect(receipt).toMatchObject({
      laneGeneration: 1,
      mode: "verified-continuity",
      projectionChanged: true,
      bindingRevision: 2,
    });
    expect(
      registry.preflight(
        "gdocs-research-switch-01",
        1,
        "chrome-session-tab-22",
      ),
    ).toMatchObject({ ok: true, reason: "matched" });
  });

  it("retains generation history after invalidation and requires explicit continuity or next-generation advance", () => {
    const registry = new GoogleDocsResearchBindingRegistryV1();
    registry.bind(binding());
    expect(registry.invalidate("gdocs-research-switch-01", 1)).toBe(true);
    expect(
      registry.preflight(
        "gdocs-research-switch-01",
        1,
        "chrome-session-tab-11",
      ),
    ).toMatchObject({ ok: false, reason: "binding-missing" });

    expect(() =>
      registry.bind(
        binding(
          "gdocs-research-switch-01",
          2,
          "chrome-session-tab-22",
          "verified-continuity",
        ),
      ),
    ).toThrow(/continuity-generation-mismatch/u);

    const advanced = registry.bind(
      binding(
        "gdocs-research-switch-01",
        2,
        "chrome-session-tab-22",
        "generation-advance",
      ),
    );
    expect(advanced).toMatchObject({ laneGeneration: 2, mode: "generation-advance" });
    expect(
      registry.preflight(
        "gdocs-research-switch-01",
        1,
        "chrome-session-tab-11",
      ),
    ).toMatchObject({ ok: false, reason: "stale-generation" });
  });

  it("requires generation advances to be consecutive", () => {
    const registry = new GoogleDocsResearchBindingRegistryV1();
    registry.bind(binding());
    expect(() =>
      registry.bind(
        binding(
          "gdocs-research-switch-01",
          3,
          "chrome-session-tab-11",
          "generation-advance",
        ),
      ),
    ).toThrow(/generation-advance-must-be-next/u);
  });

  it("never lets one Chromium projection represent two generated lanes", () => {
    const registry = new GoogleDocsResearchBindingRegistryV1();
    registry.bind(binding());
    expect(() =>
      registry.bind(
        binding(
          "gdocs-research-switch-02",
          1,
          "chrome-session-tab-11",
          "initial",
        ),
      ),
    ).toThrow(/projection-already-bound/u);
  });

  it("refuses a browser effect when the freshly re-fetched projection no longer matches", () => {
    const registry = new GoogleDocsResearchBindingRegistryV1();
    registry.bind(binding());
    expect(
      registry.preflight(
        "gdocs-research-switch-01",
        1,
        "chrome-session-tab-99",
      ),
    ).toEqual({
      version: 1,
      laneRef: "gdocs-research-switch-01",
      laneGeneration: 1,
      ok: false,
      reason: "projection-mismatch",
      grantsWorkAuthority: false,
      authorizesWorkDispatch: false,
    });
  });

  it("bounds simultaneous private bindings to the eight-document managed workload ceiling", () => {
    const registry = new GoogleDocsResearchBindingRegistryV1();
    for (let index = 1; index <= MAX_GOOGLE_DOCS_RESEARCH_BINDINGS; index += 1) {
      registry.bind(
        binding(
          `gdocs-research-switch-${String(index).padStart(2, "0")}`,
          1,
          `chrome-session-tab-${index}`,
        ),
      );
    }
    expect(registry.size).toBe(MAX_GOOGLE_DOCS_RESEARCH_BINDINGS);
    expect(() =>
      registry.bind(
        binding(
          "gdocs-research-large-00",
          1,
          "chrome-session-tab-99",
        ),
      ),
    ).toThrow(/binding-capacity-reached/u);
    registry.clear();
    expect(registry.size).toBe(0);
    expect(registry.snapshot()).toEqual([]);
  });

  it("rejects unexpected fields instead of becoming a provider-identity bucket", () => {
    const registry = new GoogleDocsResearchBindingRegistryV1();
    expect(() =>
      registry.bind({
        ...binding(),
        documentUrl: "https://docs.google.com/private",
      }),
    ).toThrow(/unsupported fields/u);
  });
});
