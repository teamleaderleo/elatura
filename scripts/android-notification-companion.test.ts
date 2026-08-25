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
    expect(manifest).toContain('<package android:name="com.openai.chatgpt" />');
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

  it("accounts for bounded work discarded during listener teardown", () => {
    const listener = read(
      "android/notification-companion/app/src/main/java/dev/elatura/notificationcompanion/ChatGptNotificationListenerService.kt",
    );
    expect(listener).toContain("if (::store.isInitialized)");
    expect(listener).toContain("if (::executor.isInitialized)");
    expect(listener).toContain("val discardedJobs = executor.shutdownNow().size");
    expect(listener).toContain("repeat(discardedJobs) { store.recordDropped() }");
  });

  it("keeps persisted records bounded, deduplicated, and token-only", () => {
    const store = read(
      "android/notification-companion/app/src/main/java/dev/elatura/notificationcompanion/LocalHintStore.kt",
    );
    const model = read(
      "android/notification-companion/app/src/main/java/dev/elatura/notificationcompanion/CompletionHint.kt",
    );
    expect(store).toContain("MAX_QUEUE_ENTRIES = 64");
    expect(store).toContain("while (sanitized.length() > MAX_QUEUE_ENTRIES)");
    expect(store).toContain("MAX_DEDUPE_WINDOW = 8");
    expect(store).toContain("containsRecentExactEvent");
    expect(store).toContain("private val PROCESS_LOCK = Any()");
    expect(model).toContain("val titleToken: String?");
    expect(model).toContain("val textToken: String?");
    expect(model).not.toMatch(/CompletionHintRecord\([\s\S]*?val\s+(?:title|text):\s/u);
  });

  it("renders on stored changes instead of polling the full screen every second", () => {
    const activity = read(
      "android/notification-companion/app/src/main/java/dev/elatura/notificationcompanion/MainActivity.kt",
    );
    const store = read(
      "android/notification-companion/app/src/main/java/dev/elatura/notificationcompanion/LocalHintStore.kt",
    );
    expect(activity).toContain("OnSharedPreferenceChangeListener");
    expect(activity).toContain("store.registerChangeListener(preferenceListener)");
    expect(activity).toContain("store.unregisterChangeListener(preferenceListener)");
    expect(activity).toContain("AGE_REFRESH_INTERVAL_MS = 30_000L");
    expect(activity).not.toContain("REFRESH_INTERVAL_MS = 1_000L");
    expect(store).toContain("registerOnSharedPreferenceChangeListener");
    expect(store).toContain("unregisterOnSharedPreferenceChangeListener");
  });

  it("records one internally consistent guided test case with one-step undo", () => {
    const activity = read(
      "android/notification-companion/app/src/main/java/dev/elatura/notificationcompanion/MainActivity.kt",
    );
    const store = read(
      "android/notification-companion/app/src/main/java/dev/elatura/notificationcompanion/LocalHintStore.kt",
    );
    const physicalTest = read(
      "android/notification-companion/app/src/main/java/dev/elatura/notificationcompanion/PhysicalTest.kt",
    );
    expect(activity).toContain("Record one completed test case");
    expect(activity).toContain("beginGuidedTestCase");
    expect(activity).toContain("Undo latest saved case");
    expect(store).toContain("recordVerifiedTestCase");
    expect(store).toContain("undoLastVerifiedTestCase");
    expect(store).toContain("KEY_LAST_VERIFIED_TEST_CASE");
    expect(physicalTest).toContain("notificationArrived == (deepLinkResult != null)");
    expect(physicalTest).toContain('NOT_TESTED("not-tested")');
  });

  it("routes first launch through vendor-aware setup without widening authority", () => {
    const manifest = read("android/notification-companion/app/src/main/AndroidManifest.xml");
    const entry = read(
      "android/notification-companion/app/src/main/java/dev/elatura/notificationcompanion/EntryActivity.kt",
    );
    const setup = read(
      "android/notification-companion/app/src/main/java/dev/elatura/notificationcompanion/SetupGuideActivity.kt",
    );
    const guide = read(
      "android/notification-companion/app/src/main/java/dev/elatura/notificationcompanion/SetupGuide.kt",
    );
    const shortcuts = read("android/notification-companion/app/src/main/res/xml/shortcuts.xml");

    expect(manifest).toMatch(/<activity[\s\S]*?\.EntryActivity[\s\S]*?android\.intent\.action\.MAIN/u);
    expect(manifest).toMatch(/<activity[\s\S]*?\.MainActivity[\s\S]*?android:exported="false"/u);
    expect(entry).toContain("SetupStateStore(applicationContext).snapshot()")
    expect(entry).toContain("SetupGuideActivity::class.java")
    expect(setup).toContain("hintStore.registerChangeListener(hintPreferenceListener)");
    expect(setup).toContain("hintStore.unregisterChangeListener(hintPreferenceListener)");
    expect(setup).toContain("startActivity(Intent(this, SignalInboxActivity::class.java))");
    expect(guide).toContain("guideFamily == DeviceGuideFamily.VIVO_IQOO");
    expect(guide).toContain("evidence.firstChatGptHintCaptured");
    expect(shortcuts).toContain("SetupGuideActivity");
    expect(manifest).not.toContain("android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS");
    expect(manifest).not.toContain("android.permission.SYSTEM_ALERT_WINDOW");
    expect(manifest).not.toContain("android.permission.BIND_ACCESSIBILITY_SERVICE");
  });

  it("keeps listener rebind and process-freshness checks in their intended layers", () => {
    const listener = read(
      "android/notification-companion/app/src/main/java/dev/elatura/notificationcompanion/ChatGptNotificationListenerService.kt",
    );
    const activity = read(
      "android/notification-companion/app/src/main/java/dev/elatura/notificationcompanion/MainActivity.kt",
    );
    expect(listener).toContain("NotificationListenerService.requestRebind");
    expect(activity).not.toContain("NotificationListenerService.requestRebind");
    expect(activity).toContain("Process.getStartElapsedRealtime()");
    expect(activity).toContain("listenerConfirmedInCurrentProcess");
  });

  it("embeds and reports bounded build and device test context", () => {
    const build = read("android/notification-companion/app/build.gradle.kts");
    const activity = read(
      "android/notification-companion/app/src/main/java/dev/elatura/notificationcompanion/MainActivity.kt",
    );
    const diagnostics = read(
      "android/notification-companion/app/src/main/java/dev/elatura/notificationcompanion/Diagnostics.kt",
    );
    expect(build).toContain('buildConfigField("String", "ELATURA_BUILD_SHA"');
    expect(build).toContain('buildConfigField("String", "ELATURA_BUILD_RUN_ID"');
    expect(activity).toContain("DiagnosticEnvironment(");
    expect(activity).toContain("BuildConfig.ELATURA_BUILD_SHA");
    expect(activity).toContain("chatGptVersion()");
    expect(diagnostics).toContain('appendLine("deviceModel=${environment.deviceModel}")');
    expect(diagnostics).toContain('appendLine("chatGptVersion=${environment.chatGptVersion}")');
    expect(diagnostics).toContain('appendLine("buildSha=${environment.buildSha}")');
    expect(diagnostics).toContain('appendLine("verifiedCompletedCases=${snapshot.verifiedCompletedCases}")');
  });

  it("shares only content-free report fields", () => {
    const diagnostics = read(
      "android/notification-companion/app/src/main/java/dev/elatura/notificationcompanion/Diagnostics.kt",
    );
    const activity = read(
      "android/notification-companion/app/src/main/java/dev/elatura/notificationcompanion/MainActivity.kt",
    );
    expect(activity).toContain("Share content-free diagnostic report");
    expect(diagnostics).toContain('append(" titleToken=${hint.titleToken != null}")');
    expect(diagnostics).toContain('append(" textToken=${hint.textToken != null}")');
    expect(diagnostics).not.toMatch(/append(?:Line)?\(hint\.(?:titleToken|textToken|notificationKeyHash|groupKeyHash)\)/u);
  });

  it("contains no Android networking implementation in the local-only packet", () => {
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
