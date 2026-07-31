// SPDX-License-Identifier: MPL-2.0
package dev.elatura.notificationcompanion

import android.app.Activity
import android.app.AlertDialog
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.text.DateFormat
import java.util.Date

class MainActivity : Activity() {
    private lateinit var statusView: TextView
    private lateinit var hintsView: TextView
    private val store by lazy { LocalHintStore(applicationContext) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        title = getString(R.string.app_name)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(20), dp(20), dp(28))
        }
        val scroll = ScrollView(this).apply { addView(root) }

        root.addView(TextView(this).apply {
            text = "Elatura completion sensor"
            textSize = 24f
        }, matchWrap())

        root.addView(TextView(this).apply {
            text = "Listens only after you grant Android notification access. The APK declares no internet permission and stores no notification transcript text."
            textSize = 16f
            setPadding(0, dp(8), 0, dp(16))
        }, matchWrap())

        statusView = TextView(this).apply {
            textSize = 16f
            setTextIsSelectable(true)
        }
        root.addView(statusView, matchWrap())

        root.addView(Button(this).apply {
            text = "Open notification access"
            setOnClickListener {
                startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            }
        }, matchWrap())

        root.addView(Button(this).apply {
            text = "Refresh diagnostics"
            setOnClickListener { render() }
        }, matchWrap())

        root.addView(Button(this).apply {
            text = "Clear local hints"
            setOnClickListener {
                AlertDialog.Builder(this@MainActivity)
                    .setTitle("Clear local hints?")
                    .setMessage("This removes the bounded tokenized event ring and its counters from this phone.")
                    .setNegativeButton("Cancel", null)
                    .setPositiveButton("Clear") { _, _ ->
                        store.clearHints()
                        render()
                    }
                    .show()
            }
        }, matchWrap())

        root.addView(Button(this).apply {
            text = "Reset sensor identity"
            setOnClickListener {
                AlertDialog.Builder(this@MainActivity)
                    .setTitle("Reset sensor identity?")
                    .setMessage("This deletes the Android Keystore HMAC key and all local hints. Existing tokens will no longer match new ones.")
                    .setNegativeButton("Cancel", null)
                    .setPositiveButton("Reset") { _, _ ->
                        store.clearAll()
                        AndroidKeystoreHmacSigner.deleteKey()
                        render()
                    }
                    .show()
            }
        }, matchWrap())

        root.addView(TextView(this).apply {
            text = "Latest tokenized events"
            textSize = 20f
            setPadding(0, dp(20), 0, dp(8))
        }, matchWrap())

        hintsView = TextView(this).apply {
            textSize = 14f
            setTextIsSelectable(true)
        }
        root.addView(hintsView, matchWrap())

        setContentView(scroll)
    }

    override fun onResume() {
        super.onResume()
        render()
    }

    private fun render() {
        val snapshot = store.snapshot()
        val component = ComponentName(this, ChatGptNotificationListenerService::class.java)
        val notificationManager = getSystemService(NotificationManager::class.java)
        val accessGranted = notificationManager.isNotificationListenerAccessGranted(component)
        val lastEvent = snapshot.lastEventAt.takeIf { it > 0L }?.let(::formatTime) ?: "none"

        statusView.text = buildString {
            appendLine("Notification access: ${if (accessGranted) "granted" else "not granted"}")
            appendLine("Listener connected: ${snapshot.listenerConnected}")
            appendLine("Accepted: ${snapshot.accepted}")
            appendLine("Dropped at worker bound: ${snapshot.dropped}")
            appendLine("Projection/store errors: ${snapshot.errors}")
            appendLine("Last event: $lastEvent")
            append("Local queue: ${snapshot.hints.size}/${LocalHintStore.MAX_QUEUE_ENTRIES}")
        }

        hintsView.text = if (snapshot.hints.isEmpty()) {
            "No ChatGPT notification hints captured yet."
        } else {
            snapshot.hints.joinToString(separator = "\n\n") { stored ->
                val hint = stored.hint
                buildString {
                    append("#${stored.sequence} · ${formatTime(hint.observedAt)} · ${hint.kind}")
                    if (hint.kind == HintKind.POSTED.wireValue && !hint.isOngoing) {
                        append(" · possible completion")
                    }
                    appendLine()
                    append("confidence=${hint.confidence} ongoing=${hint.isOngoing}")
                    appendLine()
                    append("titleToken=${hint.titleToken != null} textToken=${hint.textToken != null}")
                    appendLine()
                    append("key=${hint.notificationKeyHash.take(32)}…")
                }
            }
        }
    }

    private fun formatTime(epochMillis: Long): String {
        return DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.MEDIUM)
            .format(Date(epochMillis))
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun matchWrap(): ViewGroup.LayoutParams = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
    )
}
