// SPDX-License-Identifier: MPL-2.0
package dev.elatura.notificationcompanion

import android.app.Notification
import android.content.ComponentName
import android.os.Bundle
import android.os.SystemClock
import android.service.notification.NotificationListenerService
import android.service.notification.NotificationListenerService.RankingMap
import android.service.notification.StatusBarNotification
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

class ChatGptNotificationListenerService : NotificationListenerService() {
    private lateinit var store: LocalHintStore
    private lateinit var projector: CompletionHintProjector
    private lateinit var executor: ThreadPoolExecutor

    override fun onCreate() {
        super.onCreate()
        store = LocalHintStore(applicationContext)
        store.markServiceStarted(
            now = System.currentTimeMillis(),
            elapsedRealtime = SystemClock.elapsedRealtime(),
        )
        projector = CompletionHintProjector(AndroidKeystoreHmacSigner())
        executor = ThreadPoolExecutor(
            1,
            1,
            0L,
            TimeUnit.MILLISECONDS,
            ArrayBlockingQueue(MAX_PENDING_PROJECTIONS),
            ThreadPoolExecutor.AbortPolicy(),
        )
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        store.setListenerConnected(true, System.currentTimeMillis())
    }

    override fun onListenerDisconnected() {
        store.setListenerConnected(false, System.currentTimeMillis())
        super.onListenerDisconnected()
        NotificationListenerService.requestRebind(
            ComponentName(this, ChatGptNotificationListenerService::class.java),
        )
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        sbn ?: return
        submit(sbn, HintKind.POSTED, removalReasonCode = null)
    }

    override fun onNotificationRemoved(
        sbn: StatusBarNotification?,
        rankingMap: RankingMap?,
        reason: Int,
    ) {
        sbn ?: return
        submit(sbn, HintKind.REMOVED, removalReasonCode = reason)
    }

    override fun onDestroy() {
        if (::store.isInitialized) {
            store.setListenerConnected(false, System.currentTimeMillis())
        }
        if (::executor.isInitialized) {
            val discardedJobs = executor.shutdownNow().size
            if (::store.isInitialized) {
                repeat(discardedJobs) { store.recordDropped() }
            }
        }
        super.onDestroy()
    }

    private fun submit(
        sbn: StatusBarNotification,
        kind: HintKind,
        removalReasonCode: Int?,
    ) {
        if (sbn.packageName != CHATGPT_PACKAGE) return
        val fields = try {
            extractFields(sbn, removalReasonCode)
        } catch (_: Exception) {
            store.recordError()
            return
        }

        try {
            executor.execute {
                try {
                    projector.project(fields, kind, System.currentTimeMillis())
                        ?.let(store::append)
                } catch (_: Exception) {
                    store.recordError()
                }
            }
        } catch (_: RejectedExecutionException) {
            store.recordDropped()
        }
    }

    private fun extractFields(
        sbn: StatusBarNotification,
        removalReasonCode: Int?,
    ): NotificationFields {
        val notification = requireNotNull(sbn.notification) { "Missing notification payload" }
        val notificationKey = requireNotNull(sbn.key)
            .take(MAX_EPHEMERAL_TEXT_CODE_UNITS)
            .takeIf(String::isNotBlank)
            ?: throw IllegalArgumentException("Missing notification key")
        val extras = notification.extras ?: Bundle.EMPTY
        val hasProgress = extras.containsKey(Notification.EXTRA_PROGRESS) ||
            extras.containsKey(Notification.EXTRA_PROGRESS_MAX) ||
            extras.containsKey(Notification.EXTRA_PROGRESS_INDETERMINATE)
        return NotificationFields(
            sourcePackage = sbn.packageName,
            postedAt = sbn.postTime.coerceAtLeast(0L),
            notificationKey = notificationKey,
            title = firstText(
                extras.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE),
                extras.getCharSequence(Notification.EXTRA_TITLE_BIG),
                extras.getCharSequence(Notification.EXTRA_TITLE),
            ),
            text = firstText(
                extras.getCharSequence(Notification.EXTRA_BIG_TEXT),
                extras.getCharSequence(Notification.EXTRA_TEXT),
                extras.getCharSequence(Notification.EXTRA_SUB_TEXT),
                extras.getCharSequence(Notification.EXTRA_SUMMARY_TEXT),
            ),
            category = notification.category,
            groupKey = boundedString(sbn.groupKey),
            isOngoing = sbn.isOngoing,
            notificationId = sbn.id,
            tag = boundedString(sbn.tag),
            channelId = boundedString(notification.channelId),
            shortcutId = boundedString(notification.shortcutId),
            isGroupSummary = notification.flags and Notification.FLAG_GROUP_SUMMARY != 0,
            isClearable = sbn.isClearable,
            hasProgress = hasProgress,
            isProgressIndeterminate = hasProgress &&
                extras.getBoolean(Notification.EXTRA_PROGRESS_INDETERMINATE, false),
            removalReasonCode = removalReasonCode,
            removalReason = removalReasonCode?.let(::removalReasonName),
        )
    }

    private fun firstText(vararg candidates: CharSequence?): String? {
        return candidates
            .asSequence()
            .mapNotNull(::boundedText)
            .firstOrNull()
    }

    private fun boundedText(candidate: CharSequence?): String? {
        candidate ?: return null
        return candidate
            .subSequence(0, minOf(candidate.length, MAX_EPHEMERAL_TEXT_CODE_UNITS))
            .toString()
            .trim()
            .takeIf(String::isNotEmpty)
    }

    private fun boundedString(value: String?): String? {
        return value
            ?.take(MAX_EPHEMERAL_TEXT_CODE_UNITS)
            ?.trim()
            ?.takeIf(String::isNotEmpty)
    }

    companion object {
        private const val MAX_PENDING_PROJECTIONS = 16
    }
}

internal fun removalReasonName(code: Int): String = when (code) {
    1 -> "click"
    2 -> "cancel"
    3 -> "cancel-all"
    4 -> "error"
    5 -> "package-changed"
    6 -> "user-stopped"
    7 -> "package-banned"
    8 -> "app-cancel"
    9 -> "app-cancel-all"
    10 -> "listener-cancel"
    11 -> "listener-cancel-all"
    12 -> "group-summary-canceled"
    13 -> "group-optimization"
    14 -> "package-suspended"
    15 -> "profile-turned-off"
    16 -> "unautobundled"
    17 -> "channel-banned"
    18 -> "snoozed"
    19 -> "timeout"
    20 -> "channel-removed"
    21 -> "clear-data"
    22 -> "assistant-cancel"
    23 -> "lockdown"
    else -> "unknown"
}
