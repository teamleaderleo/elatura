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
            evidence = SetupEvidence(
                chatGptInstalled = true,
                notificationAccessGranted = true,
                listenerConfirmed = true,
                firstChatGptHintCaptured = false,
                restrictedSettingsResolved = false,
                autoStartConfirmed = false,
            ),
            guideFamily = DeviceGuideFamily.VIVO_IQOO,
        )

        assertTrue(readiness.readyForDiagnostic)
        assertFalse(readiness.readyForBackgroundTrial)
        assertTrue(readiness.missingAutomaticChecks.contains("Capture one real ChatGPT notification"))
    }

    @Test
    fun iqooBackgroundTrialRequiresARealHintAndBothManualConfirmations() {
        val incomplete = evaluateSetup(
            evidence = completeEvidence(
                restrictedSettingsResolved = false,
                autoStartConfirmed = false,
            ),
            guideFamily = DeviceGuideFamily.VIVO_IQOO,
        )
        assertFalse(incomplete.readyForBackgroundTrial)
        assertEquals(2, incomplete.missingManualChecks.size)

        val complete = evaluateSetup(
            evidence = completeEvidence(
                restrictedSettingsResolved = true,
                autoStartConfirmed = true,
            ),
            guideFamily = DeviceGuideFamily.VIVO_IQOO,
        )
        assertTrue(complete.readyForDiagnostic)
        assertTrue(complete.readyForBackgroundTrial)
        assertTrue(complete.missingAutomaticChecks.isEmpty())
        assertTrue(complete.missingManualChecks.isEmpty())
    }

    @Test
    fun standardAndroidDoesNotRequireIqooSpecificConfirmations() {
        val readiness = evaluateSetup(
            evidence = completeEvidence(
                restrictedSettingsResolved = false,
                autoStartConfirmed = false,
            ),
            guideFamily = DeviceGuideFamily.STANDARD_ANDROID,
        )

        assertTrue(readiness.readyForBackgroundTrial)
        assertTrue(readiness.missingManualChecks.isEmpty())
    }

    private fun completeEvidence(
        restrictedSettingsResolved: Boolean,
        autoStartConfirmed: Boolean,
    ): SetupEvidence = SetupEvidence(
        chatGptInstalled = true,
        notificationAccessGranted = true,
        listenerConfirmed = true,
        firstChatGptHintCaptured = true,
        restrictedSettingsResolved = restrictedSettingsResolved,
        autoStartConfirmed = autoStartConfirmed,
    )
}
