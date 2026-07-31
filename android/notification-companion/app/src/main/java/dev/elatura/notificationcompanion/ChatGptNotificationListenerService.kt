// SPDX-License-Identifier: MPL-2.0
package dev.elatura.notificationcompanion

import android.app.Notification
import android.content.ComponentName
import android.os.Bundle
import android.os.SystemClock
import android.service.notification.NotificationListenerService
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
        submit(sbn, HintKind.POSTED)
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        sbn ?: return
        submit(sbn, HintKind.REMOVED)
    }

    override fun onDestroy() {
        store.setListenerConnected(false, System.currentTimeMillis())
        executor.shutdownNow()
        super.onDestroy()
    }

    private fun submit(sbn: StatusBarNotification, kind: HintKind) {
        if (sbn.packageName != CHATGPT_PACKAGE) return
        val fields = try {
            extractFields(sbn)
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

    private fun extractFields(sbn: StatusBarNotification): NotificationFields {
        val notification = requireNotNull(sbn.notification) { "Missing notification payload" }
        val notificationKey = requireNotNull(sbn.key)
            .take(MAX_EPHEMERAL_TEXT_CODE_UNITS)
            .takeIf(String::isNotBlank)
            ?: throw IllegalArgumentException("Missing notification key")
        val extras = notification.extras ?: Bundle.EMPTY
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
            groupKey = sbn.groupKey?.take(MAX_EPHEMERAL_TEXT_CODE_UNITS),
            isOngoing = sbn.isOngoing,
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

    companion object {
        private const val MAX_PENDING_PROJECTIONS = 16
    }
}
