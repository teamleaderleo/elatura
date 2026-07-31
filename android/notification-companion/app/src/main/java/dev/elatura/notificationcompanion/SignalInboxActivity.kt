// SPDX-License-Identifier: MPL-2.0
package dev.elatura.notificationcompanion

import android.app.Activity
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.util.TypedValue
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

class SignalInboxActivity : Activity() {
    private lateinit var healthView: TextView
    private lateinit var inboxContainer: LinearLayout
    private lateinit var emptyView: TextView
    private var latestSnapshot: HintStoreSnapshot? = null

    private val store by lazy { LocalHintStore(applicationContext) }
    private val handler = Handler(Looper.getMainLooper())
    private val renderPending = Runnable { renderFromStore() }
    private val preferenceListener = SharedPreferences.OnSharedPreferenceChangeListener { _, _ ->
        handler.removeCallbacks(renderPending)
        handler.post(renderPending)
    }
    private val ageTick = object : Runnable {
        override fun run() {
            latestSnapshot?.let(::render)
            handler.postDelayed(this, AGE_REFRESH_INTERVAL_MS)
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

        root.addView(heading("Completion signals", 27f), matchWrap())
        root.addView(TextView(this).apply {
            text = "Local hints from ChatGPT notifications. A signal can suggest that work changed or completed, but it is not a verified conversation state."
            textSize = 16f
            setLineSpacing(0f, 1.12f)
            setPadding(0, dp(6), 0, dp(14))
        }, matchWrap())

        healthView = cardText(16f)
        root.addView(healthView, matchWrap(bottom = 12))

        root.addView(actionButton("Open ChatGPT") {
            openChatGpt()
        }, matchWrap(bottom = 6))
        root.addView(actionButton("Open setup guide") {
            startActivity(Intent(this, SetupGuideActivity::class.java))
        }, matchWrap(bottom = 6))
        root.addView(actionButton("Advanced diagnostics") {
            startActivity(Intent(this, MainActivity::class.java))
        }, matchWrap(bottom = 16))

        root.addView(sectionHeading("Recent signals"), matchWrap(bottom = 6))
        emptyView = cardText(15f).apply {
            text = "No ChatGPT notification signals captured yet. Complete a ChatGPT task after granting notification access, then return here."
        }
        root.addView(emptyView, matchWrap(bottom = 8))

        inboxContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        root.addView(inboxContainer, matchWrap(bottom = 14))

        root.addView(cardText(14f).apply {
            text = "Signals are grouped only by Android's keyed notification identity. Elatura does not claim that a group equals one ChatGPT thread, and group-summary notifications remain unknown until physical-device evidence supports a stronger interpretation."
        }, matchWrap())

        setContentView(scroll)
    }

    override fun onResume() {
        super.onResume()
        store.registerChangeListener(preferenceListener)
        renderFromStore()
        handler.removeCallbacks(ageTick)
        handler.postDelayed(ageTick, AGE_REFRESH_INTERVAL_MS)
    }

    override fun onPause() {
        store.unregisterChangeListener(preferenceListener)
        handler.removeCallbacks(renderPending)
        handler.removeCallbacks(ageTick)
        super.onPause()
    }

    private fun renderFromStore() {
        val snapshot = store.snapshot()
        latestSnapshot = snapshot
        render(snapshot)
    }

    private fun render(snapshot: HintStoreSnapshot) {
        val now = System.currentTimeMillis()
        val accessGranted = notificationAccessGranted()
        val listenerConfirmed = listenerConfirmedInCurrentProcess(snapshot, accessGranted)
        healthView.text = buildString {
            appendLine(
                when {
                    !accessGranted -> "Setup needed"
                    listenerConfirmed -> "Listening"
                    else -> "Access granted · listener not yet confirmed"
                },
            )
            appendLine()
            appendLine("Notification access: ${yesNo(accessGranted)}")
            appendLine("Listener active in this app process: ${yesNo(listenerConfirmed)}")
            append("Last captured signal: ${formatOptionalAge(snapshot.lastEventAt, now)}")
        }

        val items = buildSignalInbox(snapshot.hints)
        emptyView.visibility = if (items.isEmpty()) TextView.VISIBLE else TextView.GONE
        inboxContainer.removeAllViews()
        items.forEachIndexed { index, item ->
            inboxContainer.addView(signalCard(index + 1, item, now), matchWrap(bottom = 8))
        }
    }

    private fun signalCard(number: Int, item: SignalInboxItem, now: Long): TextView {
        val label = when (item.state) {
            SignalInboxState.POSSIBLE_COMPLETION -> "Possible completion"
            SignalInboxState.IN_PROGRESS -> "In progress"
            SignalInboxState.UNKNOWN -> "Unknown signal"
            SignalInboxState.REMOVED -> "Removed"
        }
        return cardText(15f).apply {
            text = buildString {
                appendLine("Signal $number · $label")
                appendLine()
                appendLine("Latest update: ${formatAge(now - item.latestObservedAt)} ago")
                appendLine("Events for this Android notification identity: ${item.eventCount}")
                appendLine(
                    "Clues: title=${yesNo(item.hasTitleClue)} · text=${yesNo(item.hasTextClue)} · " +
                        "channel=${yesNo(item.hasChannelClue)} · shortcut=${yesNo(item.hasShortcutClue)}",
                )
                if (item.isGroupSummary) appendLine("Grouped summary: yes · held as unknown")
                item.removalReasonName?.let { appendLine("Removal reason: $it") }
                append("Interpretation: notification hint only")
            }
            setLineSpacing(0f, 1.08f)
        }
    }

    private fun notificationAccessGranted(): Boolean = try {
        getSystemService(NotificationManager::class.java)
            .isNotificationListenerAccessGranted(
                ComponentName(this, ChatGptNotificationListenerService::class.java),
            )
    } catch (_: Exception) {
        false
    }

    private fun listenerConfirmedInCurrentProcess(
        snapshot: HintStoreSnapshot,
        accessGranted: Boolean,
    ): Boolean = accessGranted &&
        snapshot.listenerConnected &&
        snapshot.serviceStartedElapsedRealtime >= Process.getStartElapsedRealtime()

    private fun openChatGpt() {
        val intent = packageManager.getLaunchIntentForPackage(CHATGPT_PACKAGE)
        if (intent == null) {
            toast("ChatGPT is not installed or cannot be opened")
            return
        }
        try {
            startActivity(intent)
        } catch (_: Exception) {
            toast("Unable to open ChatGPT")
        }
    }

    private fun formatOptionalAge(timestamp: Long, now: Long): String =
        if (timestamp <= 0L) "none" else "${formatAge(now - timestamp)} ago"

    private fun formatAge(durationMs: Long): String {
        val bounded = durationMs.coerceAtLeast(0L)
        val seconds = bounded / 1_000L
        return when {
            seconds < 60L -> "${seconds}s"
            seconds < 3_600L -> "${seconds / 60L}m"
            seconds < 86_400L -> "${seconds / 3_600L}h"
            else -> "${seconds / 86_400L}d"
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
        private const val AGE_REFRESH_INTERVAL_MS = 30_000L
    }
}
