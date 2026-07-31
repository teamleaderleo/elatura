// SPDX-License-Identifier: MPL-2.0
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

const LISTENER =
  "android/notification-companion/app/src/main/java/dev/elatura/notificationcompanion/ChatGptNotificationListenerService.kt";
const MODEL =
  "android/notification-companion/app/src/main/java/dev/elatura/notificationcompanion/CompletionHint.kt";
const STORE =
  "android/notification-companion/app/src/main/java/dev/elatura/notificationcompanion/LocalHintStore.kt";
const DIAGNOSTICS =
  "android/notification-companion/app/src/main/java/dev/elatura/notificationcompanion/Diagnostics.kt";

describe("Android notification metadata v2", () => {
  it("captures the API 26 removal reason and bounded routing metadata", () => {
    const listener = read(LISTENER);
    expect(listener).toContain("override fun onNotificationRemoved(");
    expect(listener).toContain("rankingMap: RankingMap?");
    expect(listener).toContain("removalReasonCode = reason");
    expect(listener).toContain("notificationId = sbn.id");
    expect(listener).toContain("tag = boundedString(sbn.tag)");
    expect(listener).toContain("channelId = boundedString(notification.channelId)");
    expect(listener).toContain("shortcutId = boundedString(notification.shortcutId)");
    expect(listener).toContain("isGroupSummary = notification.flags and Notification.FLAG_GROUP_SUMMARY != 0");
    expect(listener).toContain("isClearable = sbn.isClearable");
    expect(listener).toContain("removalReasonName");
  });

  it("hashes identifiers locally and validates content-free fields", () => {
    const model = read(MODEL);
    expect(model).toContain("val notificationIdHash: String? = null");
    expect(model).toContain("val tagHash: String? = null");
    expect(model).toContain("val channelIdHash: String? = null");
    expect(model).toContain("val shortcutIdHash: String? = null");
    expect(model).toContain('requiredHash("notification-id"');
    expect(model).toContain('optionalHash("notification-tag"');
    expect(model).toContain('optionalHash("channel-id"');
    expect(model).toContain('optionalHash("shortcut-id"');
    expect(model).toContain("Indeterminate progress requires progress metadata");
    expect(model).toContain("Posted hints cannot contain a removal reason");
  });

  it("keeps legacy stored records readable while persisting new optional fields", () => {
    const store = read(STORE);
    expect(store).toContain('.put("notificationIdHash", notificationIdHash ?: JSONObject.NULL)');
    expect(store).toContain('.put("removalReason", removalReason ?: JSONObject.NULL)');
    expect(store).toContain('notificationIdHash = nullableString("notificationIdHash")');
    expect(store).toContain('isGroupSummary = optBoolean("isGroupSummary", false)');
    expect(store).toContain('isProgressIndeterminate = optBoolean("isProgressIndeterminate", false)');
    expect(store).toContain('removalReasonCode = nullableInt("removalReasonCode")');
  });

  it("reports only availability, flags, and removal classification", () => {
    const diagnostics = read(DIAGNOSTICS);
    expect(diagnostics).toContain('append(" notificationId=${hint.notificationIdHash != null}")');
    expect(diagnostics).toContain('append(" tag=${hint.tagHash != null}")');
    expect(diagnostics).toContain('append(" channelId=${hint.channelIdHash != null}")');
    expect(diagnostics).toContain('append(" shortcutId=${hint.shortcutIdHash != null}")');
    expect(diagnostics).toContain('append(" removalReasonCode=${hint.removalReasonCode ?: -1}")');
    expect(diagnostics).toContain('append(" removalReason=${hint.removalReason ?: "none"}")');
    expect(diagnostics).not.toMatch(
      /append(?:Line)?\(hint\.(?:notificationKeyHash|groupKeyHash|notificationIdHash|tagHash|channelIdHash|shortcutIdHash)\)/u,
    );
  });
});
