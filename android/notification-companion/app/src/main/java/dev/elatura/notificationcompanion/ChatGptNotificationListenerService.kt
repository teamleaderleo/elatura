// SPDX-License-Identifier: MPL-2.0
package dev.elatura.notificationcompanion

import android.app.Notification
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
        store.setListenerConnected(true)
    }

    override fun onListenerDisconnected() {
        store.setListenerConnected(false)
        super.onListenerDisconnected()
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
        store.setListenerConnected(false)
        executor.shutdownNow()
        super.onDestroy()
    }

    private fun submit(sbn: StatusBarNotification, kind: HintKind) {
        if (sbn.packageName != CHATGPT_PACKAGE) return
        val fields = extractFields(sbn)
        try {
            executor.execute {
                runCatching {
                    projector.project(fields, kind, System.currentTimeMillis())
                        ?.let(store::append)
                }.onFailure {
                    store.recordError()
                }
            }
        } catch (_: RejectedExecutionException) {
            store.recordDropped()
        }
    }

    private fun extractFields(sbn: StatusBarNotification): NotificationFields {
        val notification = sbn.notification
        val extras = notification.extras
        return NotificationFields(
            sourcePackage = sbn.packageName,
            postedAt = sbn.postTime.coerceAtLeast(0L),
            notificationKey = sbn.key,
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
            groupKey = sbn.groupKey,
            isOngoing = sbn.isOngoing,
        )
    }

    private fun firstText(vararg candidates: CharSequence?): String? {
        return candidates
            .asSequence()
            .mapNotNull { candidate ->
                candidate?.toString()?.trim()?.takeIf(String::isNotEmpty)
            }
            .firstOrNull()
            ?.take(MAX_EPHEMERAL_FIELD_CODE_UNITS)
    }

    companion object {
        private const val MAX_PENDING_PROJECTIONS = 16
        private const val MAX_EPHEMERAL_FIELD_CODE_UNITS = 4_096
    }
}
