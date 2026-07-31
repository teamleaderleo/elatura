// SPDX-License-Identifier: MPL-2.0
package dev.elatura.notificationcompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SignalInboxTest {
    @Test
    fun groupsUpdatesByKeyWithoutExposingTheKey() {
        val items = buildSignalInbox(
            listOf(
                stored(3L, hint(key = KEY_A, observedAt = 3_000L)),
                stored(2L, hint(key = KEY_A, observedAt = 2_000L, isOngoing = true)),
                stored(1L, hint(key = KEY_B, observedAt = 1_000L)),
            ),
        )

        assertEquals(2, items.size)
        assertEquals(2, items.first().eventCount)
        assertEquals(3L, items.first().latestSequence)
        assertEquals(SignalInboxState.POSSIBLE_COMPLETION, items.first().state)
        assertFalse(items.first().toString().contains(KEY_A))
    }

    @Test
    fun keepsGroupSummariesUnknown() {
        val item = buildSignalInbox(
            listOf(stored(1L, hint(key = KEY_A, observedAt = 1_000L, isGroupSummary = true))),
        ).single()

        assertEquals(SignalInboxState.UNKNOWN, item.state)
        assertTrue(item.isGroupSummary)
    }

    @Test
    fun keepsAnyProgressMetadataInProgress() {
        val inProgress = buildSignalInbox(
            listOf(
                stored(
                    1L,
                    hint(
                        key = KEY_A,
                        observedAt = 1_000L,
                        hasProgress = true,
                    ),
                ),
            ),
        ).single()
        val noProgress = buildSignalInbox(
            listOf(stored(1L, hint(key = KEY_A, observedAt = 1_000L))),
        ).single()

        assertEquals(SignalInboxState.IN_PROGRESS, inProgress.state)
        assertEquals(SignalInboxState.POSSIBLE_COMPLETION, noProgress.state)
    }

    @Test
    fun removedSignalsRetainOnlyTheBoundedReasonLabel() {
        val item = buildSignalInbox(
            listOf(
                stored(
                    1L,
                    hint(
                        key = KEY_A,
                        observedAt = 1_000L,
                        kind = HintKind.REMOVED.wireValue,
                        removalReasonCode = 8,
                        removalReason = "app-cancel",
                    ),
                ),
            ),
        ).single()

        assertEquals(SignalInboxState.REMOVED, item.state)
        assertEquals("app-cancel", item.removalReasonName)
    }

    @Test
    fun missingRoutingCluesRemainUnknown() {
        val item = buildSignalInbox(
            listOf(
                stored(
                    1L,
                    hint(
                        key = KEY_A,
                        observedAt = 1_000L,
                        titleToken = null,
                        textToken = null,
                        confidence = HintConfidence.UNKNOWN.wireValue,
                    ),
                ),
            ),
        ).single()

        assertEquals(SignalInboxState.UNKNOWN, item.state)
        assertNull(item.removalReasonName)
    }

    @Test
    fun prioritizesPossibleCompletionsBeforeNewerUnknownSignals() {
        val items = buildSignalInbox(
            listOf(
                stored(
                    2L,
                    hint(
                        key = KEY_B,
                        observedAt = 3_000L,
                        titleToken = null,
                        textToken = null,
                        confidence = HintConfidence.UNKNOWN.wireValue,
                    ),
                ),
                stored(1L, hint(key = KEY_A, observedAt = 2_000L)),
            ),
        )

        assertEquals(SignalInboxState.POSSIBLE_COMPLETION, items[0].state)
        assertEquals(SignalInboxState.UNKNOWN, items[1].state)
    }

    private fun stored(sequence: Long, hint: CompletionHintRecord): StoredCompletionHint =
        StoredCompletionHint(sequence = sequence, hint = hint)

    private fun hint(
        key: String,
        observedAt: Long,
        kind: String = HintKind.POSTED.wireValue,
        isOngoing: Boolean = false,
        isGroupSummary: Boolean = false,
        hasProgress: Boolean = false,
        titleToken: String? = "title:length=8:h=abcdef0123456789abcdef01",
        textToken: String? = "text:length=12:h=abcdef0123456789abcdef01",
        confidence: String = HintConfidence.PROBABLE.wireValue,
        removalReasonCode: Int? = null,
        removalReason: String? = null,
    ): CompletionHintRecord = CompletionHintRecord(
        sourcePackage = CHATGPT_PACKAGE,
        observedAt = observedAt,
        postedAt = observedAt,
        notificationKeyHash = key,
        titleToken = titleToken,
        textToken = textToken,
        category = "message",
        groupKeyHash = null,
        isOngoing = isOngoing,
        kind = kind,
        confidence = confidence,
        notificationIdHash = null,
        tagHash = null,
        channelIdHash = null,
        shortcutIdHash = null,
        isGroupSummary = isGroupSummary,
        isClearable = true,
        hasProgress = hasProgress,
        isProgressIndeterminate = false,
        removalReasonCode = removalReasonCode,
        removalReason = removalReason,
    )

    companion object {
        private const val KEY_A = "hmac-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        private const val KEY_B = "hmac-sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    }
}
