// SPDX-License-Identifier: MPL-2.0
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const ANDROID_ROOT = join(ROOT, "android/notification-companion");

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

describe("Android notification companion safety boundary", () => {
  it("declares a non-exported system-bound listener without internet access", () => {
    const manifest = read("android/notification-companion/app/src/main/AndroidManifest.xml");
    expect(manifest).not.toContain("android.permission.INTERNET");
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).toContain('android:usesCleartextTraffic="false"');
    expect(manifest).toMatch(
      /<service[\s\S]*?android:exported="false"[\s\S]*?android:permission="android\.permission\.BIND_NOTIFICATION_LISTENER_SERVICE"/u,
    );
  });

  it("filters to the ChatGPT package before queueing work", () => {
    const listener = read(
      "android/notification-companion/app/src/main/java/dev/elatura/notificationcompanion/ChatGptNotificationListenerService.kt",
    );
    const model = read(
      "android/notification-companion/app/src/main/java/dev/elatura/notificationcompanion/CompletionHint.kt",
    );
    expect(model).toContain('CHATGPT_PACKAGE = "com.openai.chatgpt"');
    expect(listener).toContain("if (sbn.packageName != CHATGPT_PACKAGE) return");
    expect(listener).toContain("ArrayBlockingQueue(MAX_PENDING_PROJECTIONS)");
  });

  it("keeps persisted records bounded and token-only", () => {
    const store = read(
      "android/notification-companion/app/src/main/java/dev/elatura/notificationcompanion/LocalHintStore.kt",
    );
    const model = read(
      "android/notification-companion/app/src/main/java/dev/elatura/notificationcompanion/CompletionHint.kt",
    );
    expect(store).toContain("MAX_QUEUE_ENTRIES = 64");
    expect(store).toContain("while (array.length() > MAX_QUEUE_ENTRIES)");
    expect(model).toContain("val titleToken: String?");
    expect(model).toContain("val textToken: String?");
    expect(model).not.toMatch(/CompletionHintRecord\([\s\S]*?val\s+(?:title|text):\s/u);
  });

  it("contains no Android networking implementation in the first packet", () => {
    const sourceFiles = walk(join(ANDROID_ROOT, "app/src/main"));
    const combined = sourceFiles.map((path) => readFileSync(path, "utf8")).join("\n");
    expect(combined).not.toMatch(/\b(?:HttpURLConnection|Socket|WebSocket|OkHttpClient)\b/u);
    expect(combined).not.toMatch(/import\s+java\.net\./u);
  });

  it("targets a current stable SDK while retaining broad device support", () => {
    const build = read("android/notification-companion/app/build.gradle.kts");
    expect(build).toContain("compileSdk = 36");
    expect(build).toContain("targetSdk = 36");
    expect(build).toContain("minSdk = 28");
  });
});
