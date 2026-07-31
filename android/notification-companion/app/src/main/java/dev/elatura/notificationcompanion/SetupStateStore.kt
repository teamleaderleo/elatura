// SPDX-License-Identifier: MPL-2.0
package dev.elatura.notificationcompanion

import android.content.Context
import android.content.SharedPreferences

internal data class SetupManualState(
    val hasOpenedGuide: Boolean,
    val restrictedSettingsResolved: Boolean,
    val autoStartConfirmed: Boolean,
)

internal class SetupStateStore(context: Context) {
    private val preferences: SharedPreferences = context.getSharedPreferences(
        PREFERENCES_NAME,
        Context.MODE_PRIVATE,
    )

    fun snapshot(): SetupManualState = SetupManualState(
        hasOpenedGuide = preferences.getBoolean(KEY_HAS_OPENED_GUIDE, false),
        restrictedSettingsResolved = preferences.getBoolean(KEY_RESTRICTED_SETTINGS_RESOLVED, false),
        autoStartConfirmed = preferences.getBoolean(KEY_AUTO_START_CONFIRMED, false),
    )

    fun markGuideOpened(): Boolean = preferences.edit()
        .putBoolean(KEY_HAS_OPENED_GUIDE, true)
        .commit()

    fun setRestrictedSettingsResolved(value: Boolean): Boolean = preferences.edit()
        .putBoolean(KEY_RESTRICTED_SETTINGS_RESOLVED, value)
        .commit()

    fun setAutoStartConfirmed(value: Boolean): Boolean = preferences.edit()
        .putBoolean(KEY_AUTO_START_CONFIRMED, value)
        .commit()

    companion object {
        private const val PREFERENCES_NAME = "setup-guide-v1"
        private const val KEY_HAS_OPENED_GUIDE = "has-opened-guide"
        private const val KEY_RESTRICTED_SETTINGS_RESOLVED = "restricted-settings-resolved"
        private const val KEY_AUTO_START_CONFIRMED = "auto-start-confirmed"
    }
}
