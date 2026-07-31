// SPDX-License-Identifier: MPL-2.0
package dev.elatura.notificationcompanion

import android.app.Activity
import android.app.AlertDialog
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Intent
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.util.TypedValue
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.text.DateFormat
import java.util.Date

class MainActivity : Activity() {
    private lateinit var healthView: TextView
    private lateinit var metricsView: TextView
    private lateinit var eventsView: TextView
    private lateinit var reconnectButton: Button
    private val store by lazy { LocalHintStore(applicationContext) }
    private val dateFormat by lazy {
        DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.MEDIUM)
    }
    private val handler = Handler(Looper.getMainLooper())
    private val refreshTick = object : Runnable {
        override fun run() {
            render()
            handler.postDelayed(this, REFRESH_INTERVAL_MS)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        title = getString(R.string.app_name)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(20), dp(18), dp(32))
        }
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            addView(root)
        }

        root.addView(heading("Elatura completion sensor", 27f), matchWrap())
        root.addView(TextView(this).apply {
            text = "Uses Android's notification access to record local, tokenized completion hints from ChatGPT. It cannot read other apps through the network because this APK declares no internet permission."
            textSize = 16f
            setLineSpacing(0f, 1.12f)
            setPadding(0, dp(6), 0, dp(14))
        }, matchWrap())

        healthView = cardText(16f)
        root.addView(healthView, matchWrap(bottom = 12))

        root.addView(sectionHeading("Setup and recovery"), matchWrap(bottom = 4))
        root.addView(actionButton("Open notification access") {
            openNotificationAccessSettings()
        }, matchWrap(bottom = 6))

        reconnectButton = actionButton("Reconnect listener") {
            try {
                NotificationListenerService.requestRebind(listenerComponent())
                toast("Reconnect requested")
            } catch (_: Exception) {
                toast("Unable to request a reconnect")
            }
            render()
        }
        root.addView(reconnectButton, matchWrap(bottom = 6))

        root.addView(actionButton("Share content-free diagnostic report") {
            shareReport()
        }, matchWrap(bottom = 12))

        root.addView(sectionHeading("Signal quality"), matchWrap(bottom = 4))
        metricsView = cardText(15f).apply { setTextIsSelectable(true) }
        root.addView(metricsView, matchWrap(bottom = 14))

        root.addView(sectionHeading("Latest tokenized events"), matchWrap(bottom = 4))
        eventsView = cardText(14f).apply {
            setTextIsSelectable(true)
            setLineSpacing(0f, 1.08f)
        }
        root.addView(eventsView, matchWrap(bottom = 14))

        root.addView(sectionHeading("Privacy and storage"), matchWrap(bottom = 4))
        root.addView(cardText(14f).apply {
            text = "Raw notification titles and bodies are bounded in memory, converted to keyed HMAC tokens, and then discarded. The screen and shared report contain only timestamps, counters, booleans, latency measurements, and opaque identifiers. At most ${LocalHintStore.MAX_QUEUE_ENTRIES} retained events are stored locally."
        }, matchWrap(bottom = 14))

        root.addView(sectionHeading("Local data controls"), matchWrap(bottom = 4))
        root.addView(actionButton("Clear captured hints and event counters") {
            confirmClearHints()
        }, matchWrap(bottom = 6))
        root.addView(actionButton("Reset sensor identity and all app state") {
            confirmResetIdentity()
        }, matchWrap())

        setContentView(scroll)
    }

    override fun onResume() {
        super.onResume()
        handler.removeCallbacks(refreshTick)
        refreshTick.run()
    }

    override fun onPause() {
        handler.removeCallbacks(refreshTick)
        super.onPause()
    }

    private fun render() {
        val snapshot = store.snapshot()
        val accessGranted = notificationAccessGranted()
        val listenerConfirmed = listenerConfirmedInCurrentProcess(snapshot, accessGranted)
        val summary = summarizeHints(snapshot.hints)
        val now = System.currentTimeMillis()
        val lastEvent = snapshot.lastEventAt.takeIf { it > 0L }

        val healthLabel = when {
            !accessGranted -> "Permission needed"
            listenerConfirmed -> "Listening"
            else -> "Access granted · listener not yet confirmed"
        }
        healthView.text = buildString {
            appendLine(healthLabel)
            appendLine()
            appendLine("Notification access: ${yesNo(accessGranted)}")
            appendLine("Listener confirmed in this app process: ${yesNo(listenerConfirmed)}")
            appendLine("Latest persisted callback: ${if (snapshot.listenerConnected) "connected" else "disconnected or unavailable"}")
            appendLine("Service starts: ${snapshot.serviceStartCount}")
            appendLine("Listener connections: ${snapshot.listenerConnectionCount}")
            appendLine("Last service start: ${formatOptionalTime(snapshot.serviceStartedAt)}")
            appendLine("Last connection: ${formatOptionalTime(snapshot.listenerConnectedAt)}")
            appendLine("Last disconnection: ${formatOptionalTime(snapshot.listenerDisconnectedAt)}")
            append("Last captured event: ${lastEvent?.let { "${formatTime(it)} · ${formatAge(now - it)} ago" } ?: "none"}")
        }
        reconnectButton.visibility = if (accessGranted && !listenerConfirmed) View.VISIBLE else View.GONE

        metricsView.text = buildString {
            appendLine("Projected events observed: ${snapshot.observed}")
            appendLine("Retained unique events: ${snapshot.accepted}")
            appendLine("Exact duplicates suppressed: ${snapshot.duplicates}")
            appendLine("Current local ring: ${snapshot.hints.size}/${LocalHintStore.MAX_QUEUE_ENTRIES}")
            appendLine("Possible completion events: ${summary.possibleCompletions}")
            appendLine("Posted / removed: ${summary.posted} / ${summary.removed}")
            appendLine("Ongoing events: ${summary.ongoing}")
            appendLine("Title token available: ${summary.withTitleToken}/${summary.retained}")
            appendLine("Text token available: ${summary.withTextToken}/${summary.retained}")
            appendLine("Grouped notifications: ${summary.grouped}/${summary.retained}")
            appendLine("Unknown routing confidence: ${summary.unknownConfidence}")
            appendLine("Latency samples: ${summary.latencySamples}")
            appendLine("Median / p95 latency: ${formatLatency(summary.latencyMedianMs)} / ${formatLatency(summary.latencyP95Ms)}")
            appendLine("Minimum / maximum latency: ${formatLatency(summary.latencyMinimumMs)} / ${formatLatency(summary.latencyMaximumMs)}")
            appendLine("Negative / >24h latency anomalies: ${summary.negativeLatencyCount} / ${summary.latencyOutlierCount}")
            appendLine("Dropped at worker bound: ${snapshot.dropped}")
            appendLine("Projection or storage errors: ${snapshot.errors}")
            append("Malformed local records detected: ${snapshot.corruptRecords}")
        }

        eventsView.text = if (snapshot.hints.isEmpty()) {
            "No ChatGPT notification hints captured yet. Complete a ChatGPT task after granting notification access, then return here."
        } else {
            snapshot.hints.take(MAX_VISIBLE_EVENTS).joinToString(separator = "\n\n") { stored ->
                val hint = stored.hint
                val state = when {
                    hint.kind == HintKind.REMOVED.wireValue -> "removed"
                    hint.isOngoing -> "ongoing or updated"
                    else -> "possible completion"
                }
                val latency = hint.observedAt - hint.postedAt
                buildString {
                    append("#${stored.sequence} · $state")
                    appendLine()
                    append("Observed ${formatTime(hint.observedAt)} · latency ${formatLatency(latency.takeIf { it >= 0L })}")
                    appendLine()
                    append("title=${yesNo(hint.titleToken != null)} text=${yesNo(hint.textToken != null)} grouped=${yesNo(hint.groupKeyHash != null)}")
                    appendLine()
                    append("confidence=${hint.confidence} · key=${hint.notificationKeyHash.take(18)}…")
                }
            }
        }
    }

    private fun shareReport() {
        val snapshot = store.snapshot()
        val accessGranted = notificationAccessGranted()
        val report = buildContentFreeReport(
            snapshot = snapshot,
            accessGranted = accessGranted,
            listenerConfirmedInCurrentProcess = listenerConfirmedInCurrentProcess(snapshot, accessGranted),
            generatedAt = System.currentTimeMillis(),
            appVersion = appVersion(),
        )
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, "Elatura Android notification diagnostic")
            putExtra(Intent.EXTRA_TEXT, report)
        }
        try {
            startActivity(Intent.createChooser(intent, "Share diagnostic report"))
        } catch (_: Exception) {
            toast("No app is available to share the report")
        }
    }

    private fun confirmClearHints() {
        AlertDialog.Builder(this)
            .setTitle("Clear captured hints?")
            .setMessage("This removes the tokenized event ring and event counters. Listener and service lifecycle evidence remains available.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Clear") { _, _ ->
                if (store.clearHints()) toast("Captured hints cleared")
                else toast("Unable to clear captured hints")
                render()
            }
            .show()
    }

    private fun confirmResetIdentity() {
        AlertDialog.Builder(this)
            .setTitle("Reset sensor identity?")
            .setMessage("This deletes the Android Keystore HMAC key and all local state. Existing tokens will no longer match new tokens.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Reset") { _, _ ->
                val keyDeleted = try {
                    AndroidKeystoreHmacSigner.deleteKey()
                    true
                } catch (_: Exception) {
                    false
                }
                val stateCleared = store.clearAll()
                when {
                    keyDeleted && stateCleared -> toast("Sensor identity reset")
                    else -> toast("Reset was incomplete; try again")
                }
                render()
            }
            .show()
    }

    private fun openNotificationAccessSettings() {
        try {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        } catch (_: Exception) {
            try {
                startActivity(Intent(Settings.ACTION_SETTINGS))
            } catch (_: Exception) {
                toast("Unable to open Android settings")
            }
        }
    }

    private fun notificationAccessGranted(): Boolean {
        return try {
            getSystemService(NotificationManager::class.java)
                .isNotificationListenerAccessGranted(listenerComponent())
        } catch (_: Exception) {
            false
        }
    }

    private fun listenerConfirmedInCurrentProcess(
        snapshot: HintStoreSnapshot,
        accessGranted: Boolean,
    ): Boolean {
        return accessGranted &&
            snapshot.listenerConnected &&
            snapshot.serviceStartedElapsedRealtime >= Process.getStartElapsedRealtime()
    }

    private fun listenerComponent(): ComponentName = ComponentName(
        this,
        ChatGptNotificationListenerService::class.java,
    )

    @Suppress("DEPRECATION")
    private fun appVersion(): String {
        return try {
            packageManager.getPackageInfo(packageName, 0).versionName
                ?.takeIf(String::isNotBlank)
                ?: "unknown"
        } catch (_: Exception) {
            "unknown"
        }
    }

    private fun heading(text: String, size: Float): TextView = TextView(this).apply {
        this.text = text
        textSize = size
        setTypeface(typeface, Typeface.BOLD)
        isAccessibilityHeading = true
    }

    private fun sectionHeading(text: String): TextView = heading(text, 19f).apply {
        setPadding(0, dp(8), 0, dp(4))
    }

    private fun cardText(size: Float): TextView = TextView(this).apply {
        textSize = size
        setPadding(dp(14), dp(13), dp(14), dp(13))
        background = GradientDrawable().apply {
            cornerRadius = dp(12).toFloat()
            setColor(resolveThemeColor(android.R.attr.colorBackgroundFloating))
        }
    }

    private fun actionButton(label: String, action: () -> Unit): Button = Button(this).apply {
        text = label
        isAllCaps = false
        minHeight = dp(50)
        setOnClickListener { action() }
    }

    private fun resolveThemeColor(attribute: Int): Int {
        val typedValue = TypedValue()
        if (!theme.resolveAttribute(attribute, typedValue, true)) return 0x11000000
        return if (typedValue.resourceId != 0) {
            resources.getColor(typedValue.resourceId, theme)
        } else {
            typedValue.data
        }
    }

    private fun formatTime(epochMillis: Long): String = dateFormat.format(Date(epochMillis))

    private fun formatOptionalTime(epochMillis: Long): String = if (epochMillis > 0L) formatTime(epochMillis) else "none"

    private fun formatAge(durationMs: Long): String {
        val safe = durationMs.coerceAtLeast(0L)
        return when {
            safe < 1_000L -> "less than a second"
            safe < 60_000L -> "${safe / 1_000L}s"
            safe < 3_600_000L -> "${safe / 60_000L}m"
            safe < 86_400_000L -> "${safe / 3_600_000L}h"
            else -> "${safe / 86_400_000L}d"
        }
    }

    private fun formatLatency(value: Long?): String = when {
        value == null -> "n/a"
        value < 1_000L -> "${value}ms"
        value < 60_000L -> String.format("%.1fs", value / 1_000.0)
        else -> String.format("%.1fm", value / 60_000.0)
    }

    private fun yesNo(value: Boolean): String = if (value) "yes" else "no"

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun matchWrap(bottom: Int = 0): ViewGroup.LayoutParams = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
    ).apply {
        bottomMargin = dp(bottom)
    }

    companion object {
        private const val REFRESH_INTERVAL_MS = 1_000L
        private const val MAX_VISIBLE_EVENTS = 20
    }
}
