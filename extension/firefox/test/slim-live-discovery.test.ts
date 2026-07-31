// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";
import { driftReasonForLiveDiscovery } from "../src/slim-live-discovery.js";

describe("live slim discovery adapter", () => {
  it("maps missing and budget failures into the bounded drift vocabulary", () => {
    expect(driftReasonForLiveDiscovery("no-role-markers")).toBe("no-turn-candidates");
    expect(driftReasonForLiveDiscovery("no-turn-containers")).toBe("no-turn-candidates");
    expect(driftReasonForLiveDiscovery("role-marker-budget-exceeded")).toBe(
      "candidate-budget-exceeded",
    );
    expect(driftReasonForLiveDiscovery("turn-container-budget-exceeded")).toBe(
      "candidate-budget-exceeded",
    );
  });

  it("maps adapter-only ambiguity into conservative policy failures", () => {
    expect(driftReasonForLiveDiscovery("turn-parent-missing")).toBe("turn-parent-mismatch");
    expect(driftReasonForLiveDiscovery("ambiguous-role-markers")).toBe("invalid-role");
  });

  it("preserves policy-native reasons exactly", () => {
    expect(driftReasonForLiveDiscovery("turn-parent-mismatch")).toBe("turn-parent-mismatch");
    expect(driftReasonForLiveDiscovery("turn-order-ambiguous")).toBe("turn-order-ambiguous");
    expect(driftReasonForLiveDiscovery("unsupported-role-set")).toBe("unsupported-role-set");
  });
});
