// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";

import {
  PROFILES,
  countAndroidUsbCandidates,
  parseAdbState,
  parseAndroidActivityDisplays,
  profileTransportReady,
  summarizeSamples,
  validProcessToken,
} from "./device-projection-experiment.mjs";

describe("device projection experiment helper", () => {
  it("keeps the physical phone presentation profile read-only", () => {
    expect(PROFILES["mirror-present"]).toContain("--no-control");
    expect(PROFILES["mirror-present"]).toContain("--audio-source=playback");
    expect(PROFILES["mirror-present"]).toContain("--audio-dup");
    expect(PROFILES["mirror-present"]).toContain("--disable-screensaver");
    expect(PROFILES["mirror-present"]).not.toContain("--stay-awake");
  });

  it("creates a separate fixed landscape virtual display", () => {
    expect(PROFILES["virtual-landscape"]).toContain("--new-display=1920x1080/240");
    expect(PROFILES["virtual-landscape"]).toContain("--display-ime-policy=fallback");
    expect(PROFILES["virtual-landscape-wireless"]).toContain("--new-display=1920x1080/240");
    expect(PROFILES["virtual-landscape-wireless"]).toContain("--select-tcpip");
  });

  it("provides a bounded physical-screen-off control arm", () => {
    expect(PROFILES["mirror-control-screen-off"]).toContain("--turn-screen-off");
    expect(PROFILES["mirror-control-screen-off"]).toContain("--audio-source=playback");
    expect(PROFILES["mirror-control-screen-off"]).toContain("--audio-dup");
  });

  it("reports only aggregate adb state", () => {
    const state = parseAdbState("List of devices attached\nraw-device-id\tunauthorized\nprivate-endpoint:5555\tdevice\n");
    expect(state).toEqual({
      count: 2,
      authorizedCount: 1,
      usbAuthorizedCount: 0,
      tcpipAuthorizedCount: 1,
      unauthorizedCount: 1,
      offlineCount: 0,
    });
    expect(JSON.stringify(state)).not.toContain("raw-device-id");
    expect(JSON.stringify(state)).not.toContain("private-endpoint");
  });

  it("reports aggregate Android-like USB presence without retaining identifiers", () => {
    const raw = {
      SPUSBDataType: [{ _items: [{ _name: "iQOO test", serial_num: "private" }] }],
    };
    const count = countAndroidUsbCandidates(raw);
    expect(count).toBe(1);
    expect(JSON.stringify({ count })).not.toContain("private");
  });

  it("never embeds selection identifiers or capture paths in launch profiles", () => {
    const encoded = JSON.stringify(PROFILES);
    expect(encoded).not.toContain("--serial");
    expect(encoded).not.toContain("--tcpip=");
    expect(encoded).not.toContain("--record");
    for (const profile of Object.values(PROFILES)) {
      expect(profile).toContain("--no-clipboard-autosync");
    }
  });

  it("allows a private mixed-case process selector without emitting it", () => {
    expect(validProcessToken("ScreenContinuity")).toBe(true);
    expect(validProcessToken("bad\nselector")).toBe(false);
    expect(JSON.stringify(PROFILES)).not.toContain("ScreenContinuity");
  });

  it("selects one wireless transport even while the same phone is also on USB", () => {
    const state = parseAdbState("List of devices attached\nprivate-usb\tdevice\nprivate-endpoint:5555\tdevice\n");
    expect(profileTransportReady("wireless", state)).toBe(true);
    expect(profileTransportReady("mirror-control", state)).toBe(true);
  });

  it("does not request privileged Mac telemetry", () => {
    const source = JSON.stringify(PROFILES);
    expect(source).not.toContain("sudo");
    expect(source).not.toContain("powermetrics");
  });

  it("keeps the workload server on loopback in the operator script", async () => {
    const source = await import("node:fs/promises").then(({ readFile }) => readFile(
      new URL("./device-projection-experiment.mjs", import.meta.url),
      "utf8",
    ));
    expect(source).toContain('server.listen(port, "127.0.0.1"');
    expect(source).not.toContain('server.listen(port, "0.0.0.0"');
    expect(source).toContain("server.closeAllConnections()");
    expect(source).toContain('"workload-launch-intent-sent-to-physical-display\\n"');
  });

  it("summarizes only numeric leaves from sanitized samples", () => {
    const summary = summarizeSamples([
      { label: "arm", collectedAt: "a", host: { cpu: 3 } },
      { label: "arm", collectedAt: "b", host: { cpu: 7 } },
    ]);
    expect(summary.metrics["host.cpu"]).toEqual({ count: 2, min: 3, median: 5, max: 7, mean: 5 });
  });

  it("reduces Android activity displays without package names or display ids", () => {
    const parsed = parseAndroidActivityDisplays(`Display #0 (activities from top to bottom):
      * Task{default private.package}
    Display #6 (activities from top to bottom):
      * Task{virtual secret.browser}
      Resumed=true secret.browser
    `);
    expect(parsed).toEqual({
      activityDisplayCount: 2,
      nonDefaultActivityDisplayCount: 1,
      defaultTaskCount: 1,
      nonDefaultTaskCount: 1,
      nonDefaultResumedCount: 1,
    });
    expect(JSON.stringify(parsed)).not.toContain("secret");
    expect(JSON.stringify(parsed)).not.toContain("#6");
  });
});
