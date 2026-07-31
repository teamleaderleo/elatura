// SPDX-License-Identifier: MPL-2.0
package dev.elatura.notificationcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SetupGuideTest {
    @Test
    fun detectsVivoAndIqooDevicesWithoutExactModelMatching() {
        assertEquals(
            DeviceGuideFamily.VIVO_IQOO,
            detectDeviceGuideFamily("vivo", "iQOO", "Z11 Turbo"),
        )
        assertEquals(
            DeviceGuideFamily.VIVO_IQOO,
            detectDeviceGuideFamily("unknown", "unknown", "iQOO test device"),
        )
        assertEquals(
            DeviceGuideFamily.STANDARD_ANDROID,
            detectDeviceGuideFamily("Google", "google", "Pixel"),
        )
    }

    @Test
    fun diagnosticReadinessRequiresTheInstalledAppAccessAndListener() {
        val readiness = evaluateSetup(
            SetupEvidence(
                chatGptInstalled = true,
                notificationAccessGranted = true,
                listenerConfirmed = true,
                firstChatGptHintCaptured = false,
                restrictedSettingsResolved = false,
                autoStartConfirmed = false,
            ),
        )

        assertTrue(readiness.readyForDiagnostic)
        assertFalse(readiness.readyForBackgroundTrial)
        assertTrue(readiness.missingAutomaticChecks.contains("Capture one real ChatGPT notification"))
    }

    @Test
    fun backgroundTrialRequiresARealHintAndBothManualConfirmations() {
        val readiness = evaluateSetup(
            SetupEvidence(
                chatGptInstalled = true,
                notificationAccessGranted = true,
                listenerConfirmed = true,
                firstChatGptHintCaptured = true,
                restrictedSettingsResolved = true,
                autoStartConfirmed = true,
            ),
        )

        assertTrue(readiness.readyForDiagnostic)
        assertTrue(readiness.readyForBackgroundTrial)
        assertTrue(readiness.missingAutomaticChecks.isEmpty())
        assertTrue(readiness.missingManualChecks.isEmpty())
    }
}
