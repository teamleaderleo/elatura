// SPDX-License-Identifier: MPL-2.0
package dev.elatura.notificationcompanion

internal enum class DeviceGuideFamily {
    VIVO_IQOO,
    STANDARD_ANDROID,
}

internal data class SetupEvidence(
    val chatGptInstalled: Boolean,
    val notificationAccessGranted: Boolean,
    val listenerConfirmed: Boolean,
    val firstChatGptHintCaptured: Boolean,
    val restrictedSettingsResolved: Boolean,
    val autoStartConfirmed: Boolean,
)

internal data class SetupReadiness(
    val readyForDiagnostic: Boolean,
    val readyForBackgroundTrial: Boolean,
    val missingAutomaticChecks: List<String>,
    val missingManualChecks: List<String>,
)

internal fun detectDeviceGuideFamily(
    manufacturer: String?,
    brand: String?,
    model: String?,
): DeviceGuideFamily {
    val combined = listOfNotNull(manufacturer, brand, model)
        .joinToString(separator = " ")
        .lowercase()
    return if (combined.contains("vivo") || combined.contains("iqoo")) {
        DeviceGuideFamily.VIVO_IQOO
    } else {
        DeviceGuideFamily.STANDARD_ANDROID
    }
}

internal fun evaluateSetup(
    evidence: SetupEvidence,
    guideFamily: DeviceGuideFamily,
): SetupReadiness {
    val missingAutomatic = buildList {
        if (!evidence.chatGptInstalled) add("Install or update the ChatGPT Android app")
        if (!evidence.notificationAccessGranted) add("Grant Elatura notification access")
        if (!evidence.listenerConfirmed) add("Confirm the Android notification listener connects")
        if (!evidence.firstChatGptHintCaptured) add("Capture one real ChatGPT notification")
    }
    val missingManual = buildList {
        if (guideFamily == DeviceGuideFamily.VIVO_IQOO) {
            if (!evidence.restrictedSettingsResolved) {
                add("Resolve the installation restriction if OriginOS shows it")
            }
            if (!evidence.autoStartConfirmed) {
                add("Allow Elatura auto-start in iManager")
            }
        }
    }
    val readyForDiagnostic = evidence.chatGptInstalled &&
        evidence.notificationAccessGranted &&
        evidence.listenerConfirmed
    return SetupReadiness(
        readyForDiagnostic = readyForDiagnostic,
        readyForBackgroundTrial = readyForDiagnostic &&
            evidence.firstChatGptHintCaptured &&
            missingManual.isEmpty(),
        missingAutomaticChecks = missingAutomatic,
        missingManualChecks = missingManual,
    )
}
