// SPDX-License-Identifier: MPL-2.0
package dev.elatura.notificationcompanion

import android.app.Activity
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.Process
import android.provider.Settings
import android.util.TypedValue
import android.view.ViewGroup
import android.widget.Button
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

class SetupGuideActivity : Activity() {
    private lateinit var statusView: TextView
    private lateinit var automaticChecksView: TextView
    private lateinit var vendorInstructionsView: TextView
    private lateinit var restrictedSettingsCheckBox: CheckBox
    private lateinit var autoStartCheckBox: CheckBox
    private var syncingChecks = false
    private var renderScheduled = false

    private val hintStore by lazy { LocalHintStore(applicationContext) }
    private val setupStore by lazy { SetupStateStore(applicationContext) }
    private val mainHandler = Handler(Looper.getMainLooper())
    private val renderTask = Runnable {
        renderScheduled = false
        if (!isFinishing && !isDestroyed) render()
    }
    private val hintPreferenceListener = SharedPreferences.OnSharedPreferenceChangeListener { _, _ ->
        scheduleRender()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        title = "Elatura setup"

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(20), dp(18), dp(32))
        }
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            addView(root)
        }

        root.addView(heading("Set up the completion sensor", 27f), matchWrap())
        root.addView(TextView(this).apply {
            text = "This guide checks the Android listener and records only your confirmation of settings that OriginOS does not expose to apps. A real ChatGPT notification is still required before background reliability is considered proven."
            textSize = 16f
            setLineSpacing(0f, 1.12f)
            setPadding(0, dp(6), 0, dp(14))
        }, matchWrap())

        statusView = cardText(16f)
        root.addView(statusView, matchWrap(bottom = 14))

        root.addView(sectionHeading("Automatic checks"), matchWrap(bottom = 4))
        automaticChecksView = cardText(15f).apply { setTextIsSelectable(true) }
        root.addView(automaticChecksView, matchWrap(bottom = 8))
        root.addView(actionButton("Open notification access") {
            openNotificationAccessSettings()
        }, matchWrap(bottom = 5))
        root.addView(actionButton("Open Elatura app settings") {
            openAppDetailsSettings()
        }, matchWrap(bottom = 5))
        root.addView(actionButton("Open Android settings") {
            openAndroidSettings()
        }, matchWrap(bottom = 14))

        root.addView(sectionHeading("OriginOS manual checks"), matchWrap(bottom = 4))
        vendorInstructionsView = cardText(15f).apply {
            setTextIsSelectable(true)
            setLineSpacing(0f, 1.1f)
        }
        root.addView(vendorInstructionsView, matchWrap(bottom = 8))

        restrictedSettingsCheckBox = CheckBox(this).apply {
            text = "I resolved the side-load restriction if OriginOS displayed one"
            setPadding(dp(4), dp(4), dp(4), dp(4))
            setOnCheckedChangeListener { _, checked ->
                if (!syncingChecks && !setupStore.setRestrictedSettingsResolved(checked)) {
                    toast("Unable to save this setup confirmation")
                }
                if (!syncingChecks) render()
            }
        }
        root.addView(restrictedSettingsCheckBox, matchWrap(bottom = 4))

        autoStartCheckBox = CheckBox(this).apply {
            text = "I enabled Elatura auto-start in iManager"
            setPadding(dp(4), dp(4), dp(4), dp(4))
            setOnCheckedChangeListener { _, checked ->
                if (!syncingChecks && !setupStore.setAutoStartConfirmed(checked)) {
                    toast("Unable to save this setup confirmation")
                }
                if (!syncingChecks) render()
            }
        }
        root.addView(autoStartCheckBox, matchWrap(bottom = 10))

        root.addView(cardText(14f).apply {
            text = "These confirmations are reminders, not system attestations. Recheck them after an OriginOS update, app reinstall, or if listener health stops recovering after reboot or screen-off time."
        }, matchWrap(bottom = 14))

        root.addView(actionButton("Recheck setup") {
            render()
        }, matchWrap(bottom = 5))
        root.addView(actionButton("Open diagnostic dashboard") {
            startActivity(Intent(this, MainActivity::class.java))
            finish()
        }, matchWrap())

        setContentView(scroll)
    }

    override fun onStart() {
        super.onStart()
        hintStore.registerChangeListener(hintPreferenceListener)
    }

    override fun onResume() {
        super.onResume()
        setupStore.markGuideOpened()
        render()
    }

    override fun onStop() {
        hintStore.unregisterChangeListener(hintPreferenceListener)
        mainHandler.removeCallbacks(renderTask)
        renderScheduled = false
        super.onStop()
    }

    private fun scheduleRender() {
        if (renderScheduled) return
        renderScheduled = true
        mainHandler.post(renderTask)
    }

    private fun render() {
        val manual = setupStore.snapshot()
        syncingChecks = true
        restrictedSettingsCheckBox.isChecked = manual.restrictedSettingsResolved
        autoStartCheckBox.isChecked = manual.autoStartConfirmed
        syncingChecks = false

        val snapshot = hintStore.snapshot(limit = 1)
        val accessGranted = notificationAccessGranted()
        val listenerConfirmed = listenerConfirmedInCurrentProcess(snapshot, accessGranted)
        val chatGptVersion = chatGptVersion()
        val guideFamily = detectDeviceGuideFamily(
            manufacturer = Build.MANUFACTURER,
            brand = Build.BRAND,
            model = Build.MODEL,
        )
        val evidence = SetupEvidence(
            chatGptInstalled = chatGptVersion != null,
            notificationAccessGranted = accessGranted,
            listenerConfirmed = listenerConfirmed,
            firstChatGptHintCaptured = snapshot.lastEventAt > 0L,
            restrictedSettingsResolved = manual.restrictedSettingsResolved,
            autoStartConfirmed = manual.autoStartConfirmed,
        )
        val readiness = evaluateSetup(evidence)
        val headline = when {
            readiness.readyForBackgroundTrial -> "Ready for a background trial"
            readiness.readyForDiagnostic -> "Ready for a live diagnostic"
            else -> "Setup needed"
        }

        statusView.text = buildString {
            appendLine(headline)
            appendLine()
            appendLine("Device guide: ${if (guideFamily == DeviceGuideFamily.VIVO_IQOO) "vivo / iQOO OriginOS" else "standard Android"}")
            appendLine("ChatGPT app: ${chatGptVersion ?: "not detected"}")
            appendLine("Notification access: ${yesNo(accessGranted)}")
            appendLine("Listener confirmed in this process: ${yesNo(listenerConfirmed)}")
            appendLine("First real ChatGPT hint captured: ${yesNo(snapshot.lastEventAt > 0L)}")
            append("Standard battery exemption: ${batteryOptimizationExempt()?.let(::yesNo) ?: "unknown"}")
        }

        automaticChecksView.text = buildString {
            appendLine(checkLine(chatGptVersion != null, "ChatGPT app installed"))
            appendLine(checkLine(accessGranted, "Elatura notification access granted"))
            appendLine(checkLine(listenerConfirmed, "Android listener connected"))
            appendLine(checkLine(snapshot.lastEventAt > 0L, "One real ChatGPT notification captured"))
            if (readiness.missingAutomaticChecks.isNotEmpty()) {
                appendLine()
                appendLine("Next automatic check:")
                append(readiness.missingAutomaticChecks.first())
            }
        }

        vendorInstructionsView.text = if (guideFamily == DeviceGuideFamily.VIVO_IQOO) {
            buildString {
                appendLine("1. Side-loaded APK restriction")
                appendLine("If OriginOS blocks notification access for this APK, open Elatura app settings and use the system option to remove restrictions or allow restricted settings. The exact wording can vary by update.")
                appendLine()
                appendLine("2. Auto-start")
                appendLine("Open iManager → App management → Permission management → Auto-start, then enable Elatura Companion.")
                appendLine()
                appendLine("3. Real notification check")
                append("After the listener says connected, let one genuine ChatGPT task finish. Elatura will mark the first captured hint automatically.")
            }
        } else {
            buildString {
                appendLine("1. Grant notification access using the button above.")
                appendLine("2. Resolve any restricted-settings warning shown for a side-loaded APK.")
                appendLine("3. Allow the app to start in the background when your Android vendor provides such a control.")
                append("4. Let one genuine ChatGPT task finish and return here to confirm the first hint.")
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
    private fun chatGptVersion(): String? {
        return try {
            packageManager.getPackageInfo(CHATGPT_PACKAGE, 0).versionName
                ?.trim()
                ?.take(METADATA_LIMIT)
                ?.takeIf(String::isNotEmpty)
        } catch (_: Exception) {
            null
        }
    }

    private fun batteryOptimizationExempt(): Boolean? {
        return try {
            getSystemService(PowerManager::class.java)
                .isIgnoringBatteryOptimizations(packageName)
        } catch (_: Exception) {
            null
        }
    }

    private fun openNotificationAccessSettings() {
        startSettings(
            primary = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS),
            fallback = Intent(Settings.ACTION_SETTINGS),
        )
    }

    private fun openAppDetailsSettings() {
        startSettings(
            primary = Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:$packageName"),
            ),
            fallback = Intent(Settings.ACTION_SETTINGS),
        )
    }

    private fun openAndroidSettings() {
        startSettings(
            primary = Intent(Settings.ACTION_SETTINGS),
            fallback = null,
        )
    }

    private fun startSettings(primary: Intent, fallback: Intent?) {
        try {
            startActivity(primary)
        } catch (_: Exception) {
            if (fallback == null) {
                toast("Unable to open Android settings")
                return
            }
            try {
                startActivity(fallback)
            } catch (_: Exception) {
                toast("Unable to open Android settings")
            }
        }
    }

    private fun checkLine(complete: Boolean, label: String): String =
        "${if (complete) "✓" else "○"} $label"

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
        private const val METADATA_LIMIT = 128
    }
}
