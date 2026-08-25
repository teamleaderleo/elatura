// SPDX-License-Identifier: MPL-2.0
package dev.elatura.notificationcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DiagnosticsTest {
    @Test
    fun summarizesSignalQualityLatencyAndNotificationMetadata() {
        val sharedKey = "hmac-sha256:${"a".repeat(64)}"
        val hints = listOf(
            stored(
                3L,
                hint(
                    observedAt = 2_400L,
                    postedAt = 2_000L,
                    notificationKeyHash = sharedKey,
                    isOngoing = false,
                    notificationIdHash = "hmac-sha256:${"b".repeat(64)}",
                    tagHash = "hmac-sha256:${"c".repeat(64)}",
                    channelIdHash = "hmac-sha256:${"d".repeat(64)}",
                    shortcutIdHash = "hmac-sha256:${"e".repeat(64)}",
                    isGroupSummary = true,
                    isClearable = true,
                    hasProgress = true,
                    isProgressIndeterminate = true,
                ),
            ),
            stored(
                2L,
                hint(
                    observedAt = 2_200L,
                    postedAt = 2_000L,
                    notificationKeyHash = sharedKey,
                    isOngoing = true,
                ),
            ),
            stored(
                1L,
                hint(
                    observedAt = 1_900L,
                    postedAt = 2_000L,
                    kind = HintKind.REMOVED.wireValue,
                    titleToken = null,
                    textToken = null,
                    groupKeyHash = null,
                    confidence = HintConfidence.UNKNOWN.wireValue,
                    removalReasonCode = 19,
                    removalReason = "timeout",
                ),
            ),
        )

        val summary = summarizeHints(hints)
        assertEquals(3, summary.retained)
        assertEquals(2, summary.posted)
        assertEquals(1, summary.removed)
        assertEquals(1, summary.possibleCompletions)
        assertEquals(1, summary.ongoing)
        assertEquals(2, summary.withTitleToken)
        assertEquals(2, summary.withTextToken)
        assertEquals(2, summary.grouped)
        assertEquals(3, summary.withNotificationId)
        assertEquals(3, summary.withTag)
        assertEquals(3, summary.withChannelId)
        assertEquals(3, summary.withShortcutId)
        assertEquals(1, summary.groupSummaries)
        assertEquals(3, summary.clearable)
        assertEquals(1, summary.withProgress)
        assertEquals(1, summary.indeterminateProgress)
        assertEquals(1, summary.removalsWithReason)
        assertEquals(1, summary.reusedNotificationKeyEvents)
        assertEquals(2, summary.latencySamples)
        assertEquals(200L, summary.latencyMinimumMs)
        assertEquals(400L, summary.latencyMaximumMs)
        assertEquals(1, summary.negativeLatencyCount)
    }

    @Test
    fun contentFreeReportOmitsAllOpaqueValuesAndKeepsUsefulMetadata() {
        val token = "title:length=22:h=super-secret-token"
        val keyHash = "hmac-sha256:super-secret-key-hash"
        val notificationIdHash = "hmac-sha256:secret-notification-id"
        val tagHash = "hmac-sha256:secret-tag"
        val channelHash = "hmac-sha256:secret-channel"
        val shortcutHash = "hmac-sha256:secret-shortcut"
        val lastCase = VerifiedTestCase(
            recordedAt = 4_500L,
            notificationArrived = true,
            deepLinkResult = DeepLinkResult.NOT_TESTED,
        )
        val snapshot = HintStoreSnapshot(
            hints = listOf(
                stored(
                    7L,
                    hint(
                        observedAt = 4_000L,
                        postedAt = 3_500L,
                        kind = HintKind.REMOVED.wireValue,
                        titleToken = token,
                        notificationKeyHash = keyHash,
                        notificationIdHash = notificationIdHash,
                        tagHash = tagHash,
                        channelIdHash = channelHash,
                        shortcutIdHash = shortcutHash,
                        isGroupSummary = true,
                        isClearable = true,
                        hasProgress = true,
                        isProgressIndeterminate = false,
                        removalReasonCode = 19,
                        removalReason = "timeout",
                    ),
                ),
            ),
            observed = 2L,
            accepted = 1L,
            duplicates = 1L,
            dropped = 0L,
            errors = 0L,
            corruptRecords = 0L,
            lastEventAt = 4_000L,
            listenerConnected = true,
            listenerConnectedAt = 3_000L,
            listenerDisconnectedAt = 0L,
            listenerConnectionCount = 1L,
            serviceStartedAt = 2_500L,
            serviceStartedElapsedRealtime = 2_000L,
            serviceStartCount = 1L,
            testStartedAt = 2_750L,
            verifiedCompletedCases = 10L,
            verifiedNotificationArrived = 8L,
            verifiedNotificationMissed = 2L,
            verifiedDeepLinkCorrect = 6L,
            verifiedDeepLinkFailed = 1L,
            verifiedDeepLinkNotTested = 1L,
            lastVerifiedTestCase = lastCase,
        )
        val environment = DiagnosticEnvironment(
            deviceManufacturer = "Example",
            deviceModel = "Phone 1",
            androidRelease = "16",
            androidSdkInt = 36,
            chatGptVersion = "1.2026.200",
            elaturaVersion = "0.1.0",
            buildSha = "abcdef1234567890",
            buildRunId = "123456",
            batteryOptimizationExempt = false,
        )

        val report = buildContentFreeReport(
            snapshot = snapshot,
            environment = environment,
            accessGranted = true,
            listenerConfirmedInCurrentProcess = true,
            generatedAt = 5_000L,
        )
        listOf(
            token,
            keyHash,
            notificationIdHash,
            tagHash,
            channelHash,
            shortcutHash,
        ).forEach { secret -> assertFalse(report.contains(secret)) }
        assertTrue(report.contains("elaturaVersion=0.1.0"))
        assertTrue(report.contains("buildSha=abcdef1234567890"))
        assertTrue(report.contains("deviceModel=Phone 1"))
        assertTrue(report.contains("chatGptVersion=1.2026.200"))
        assertTrue(report.contains("batteryOptimizationExempt=false"))
        assertTrue(report.contains("listenerConfirmedInCurrentProcess=true"))
        assertTrue(report.contains("verifiedCompletedCases=10"))
        assertTrue(report.contains("verifiedNotificationArrived=8"))
        assertTrue(report.contains("verifiedNotificationMissed=2"))
        assertTrue(report.contains("verifiedDeepLinkCorrect=6"))
        assertTrue(report.contains("verifiedDeepLinkFailed=1"))
        assertTrue(report.contains("verifiedDeepLinkNotTested=1"))
        assertTrue(report.contains("lastVerifiedCaseDeepLinkResult=not-tested"))
        assertTrue(report.contains("notificationId=true"))
        assertTrue(report.contains("tag=true"))
        assertTrue(report.contains("channelId=true"))
        assertTrue(report.contains("shortcutId=true"))
        assertTrue(report.contains("groupSummary=true"))
        assertTrue(report.contains("clearable=true"))
        assertTrue(report.contains("progress=true"))
        assertTrue(report.contains("removalReasonCode=19"))
        assertTrue(report.contains("removalReason=timeout"))
        assertTrue(report.contains("possibleCompletions=0"))
        assertTrue(report.contains("titleToken=true"))
        assertTrue(report.contains("latencyMs=500"))
        assertTrue(report.contains("duplicates=1"))
    }

    @Test
    fun exactEventIdentityIgnoresObservationTimeButDetectsMetadataChanges() {
        val first = hint(observedAt = 2_000L, postedAt = 1_000L)
        val laterDuplicate = first.copy(observedAt = 5_000L)
        val changedText = first.copy(textToken = "text:length=9:h=different")
        val changedChannel = first.copy(channelIdHash = "hmac-sha256:${"f".repeat(64)}")
        val removed = first.copy(
            kind = HintKind.REMOVED.wireValue,
            removalReasonCode = 19,
            removalReason = "timeout",
        )

        assertEquals(first.exactEventSignature(), laterDuplicate.exactEventSignature())
        assertNotEquals(first.exactEventSignature(), changedText.exactEventSignature())
        assertNotEquals(first.exactEventSignature(), changedChannel.exactEventSignature())
        assertNotEquals(first.exactEventSignature(), removed.exactEventSignature())
    }

    private fun stored(sequence: Long, hint: CompletionHintRecord): StoredCompletionHint = StoredCompletionHint(
        sequence = sequence,
        hint = hint,
    )

    private fun hint(
        observedAt: Long,
        postedAt: Long,
        kind: String = HintKind.POSTED.wireValue,
        isOngoing: Boolean = false,
        notificationKeyHash: String = "hmac-sha256:${"1".repeat(64)}",
        titleToken: String? = "title:length=8:h=${"a".repeat(24)}",
        textToken: String? = "text:length=12:h=${"b".repeat(24)}",
        groupKeyHash: String? = "hmac-sha256:${"2".repeat(64)}",
        confidence: String = HintConfidence.PROBABLE.wireValue,
        notificationIdHash: String? = "hmac-sha256:${"3".repeat(64)}",
        tagHash: String? = "hmac-sha256:${"4".repeat(64)}",
        channelIdHash: String? = "hmac-sha256:${"5".repeat(64)}",
        shortcutIdHash: String? = "hmac-sha256:${"6".repeat(64)}",
        isGroupSummary: Boolean = false,
        isClearable: Boolean = true,
        hasProgress: Boolean = false,
        isProgressIndeterminate: Boolean = false,
        removalReasonCode: Int? = null,
        removalReason: String? = null,
    ): CompletionHintRecord = CompletionHintRecord(
        sourcePackage = CHATGPT_PACKAGE,
        observedAt = observedAt,
        postedAt = postedAt,
        notificationKeyHash = notificationKeyHash,
        titleToken = titleToken,
        textToken = textToken,
        category = "message",
        groupKeyHash = groupKeyHash,
        isOngoing = isOngoing,
        kind = kind,
        confidence = confidence,
        notificationIdHash = notificationIdHash,
        tagHash = tagHash,
        channelIdHash = channelIdHash,
        shortcutIdHash = shortcutIdHash,
        isGroupSummary = isGroupSummary,
        isClearable = isClearable,
        hasProgress = hasProgress,
        isProgressIndeterminate = isProgressIndeterminate,
        removalReasonCode = removalReasonCode,
        removalReason = removalReason,
    )
}
