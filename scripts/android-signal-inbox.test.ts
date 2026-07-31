// SPDX-License-Identifier: MPL-2.0
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("Android signal inbox", () => {
  it("routes normal launches to the inbox after setup", () => {
    const entry = read(
      "android/notification-companion/app/src/main/java/dev/elatura/notificationcompanion/EntryActivity.kt",
    );
    const setup = read(
      "android/notification-companion/app/src/main/java/dev/elatura/notificationcompanion/SetupGuideActivity.kt",
    );
    const manifest = read("android/notification-companion/app/src/main/AndroidManifest.xml");

    expect(entry).toContain("SignalInboxActivity::class.java");
    expect(setup).toContain('actionButton("Open signal inbox")');
    expect(setup).toContain("Intent(this, SignalInboxActivity::class.java)");
    expect(manifest).toMatch(
      /<activity[\s\S]*?\.SignalInboxActivity[\s\S]*?android:exported="false"/u,
    );
  });

  it("keeps diagnostics secondary and reachable", () => {
    const inbox = read(
      "android/notification-companion/app/src/main/java/dev/elatura/notificationcompanion/SignalInboxActivity.kt",
    );
    const diagnostics = read(
      "android/notification-companion/app/src/main/java/dev/elatura/notificationcompanion/MainActivity.kt",
    );

    expect(inbox).toContain('actionButton("Advanced diagnostics")');
    expect(inbox).toContain("Intent(this, MainActivity::class.java)");
    expect(diagnostics).toContain('heading("Advanced diagnostics"');
    expect(diagnostics).toContain('actionButton("Open signal inbox")');
    expect(diagnostics).toContain('actionButton("Open setup guide")');
  });

  it("never displays notification hashes or claims thread identity", () => {
    const inbox = read(
      "android/notification-companion/app/src/main/java/dev/elatura/notificationcompanion/SignalInboxActivity.kt",
    );
    const model = read(
      "android/notification-companion/app/src/main/java/dev/elatura/notificationcompanion/SignalInbox.kt",
    );

    expect(inbox).not.toContain("notificationKeyHash.take");
    expect(inbox).not.toContain("notificationIdHash");
    expect(inbox).not.toContain("notificationTagHash");
    expect(inbox).toContain("not a verified conversation state");
    expect(inbox).toContain("does not claim that a group equals one ChatGPT thread");
    expect(model).not.toMatch(/SignalInboxItem\([\s\S]*notificationKeyHash/u);
  });

  it("keeps uncertain and grouped events conservative", () => {
    const model = read(
      "android/notification-companion/app/src/main/java/dev/elatura/notificationcompanion/SignalInbox.kt",
    );

    expect(model).toContain("if (hint.isGroupSummary) return SignalInboxState.UNKNOWN");
    expect(model).toContain("SignalInboxState.POSSIBLE_COMPLETION");
    expect(model).toContain("SignalInboxState.IN_PROGRESS");
    expect(model).toContain("SignalInboxState.REMOVED");
    expect(model).toContain("MAX_SIGNAL_INBOX_ITEMS = 8");
  });

  it("does not add refresh, submission, or network authority", () => {
    const inbox = read(
      "android/notification-companion/app/src/main/java/dev/elatura/notificationcompanion/SignalInboxActivity.kt",
    );
    const manifest = read("android/notification-companion/app/src/main/AndroidManifest.xml");

    expect(manifest).not.toContain("android.permission.INTERNET");
    expect(inbox).not.toMatch(/HttpURLConnection|OkHttp|WebSocket|Socket/u);
    expect(inbox).not.toContain("submit");
    expect(inbox).not.toContain("refreshChatGpt");
    expect(inbox).toContain("getLaunchIntentForPackage(CHATGPT_PACKAGE)");
  });
});
