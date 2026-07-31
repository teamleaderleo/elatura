// SPDX-License-Identifier: MPL-2.0
package dev.elatura.notificationcompanion

import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class CompletionHintProjectorTest {
    private val signer = TokenSigner { label, value ->
        MessageDigest.getInstance("SHA-256")
            .digest("$label\u0000$value".toByteArray(StandardCharsets.UTF_8))
            .joinToString(separator = "") { byte -> "%02x".format(byte) }
    }
    private val projector = CompletionHintProjector(signer)

    @Test
    fun admitsOnlyTheChatGptPackage() {
        val hint = projector.project(fields(), HintKind.POSTED, observedAt = 2_000L)
        assertEquals(CHATGPT_PACKAGE, hint?.sourcePackage)

        val rejected = projector.project(
            fields(sourcePackage = "com.example.other"),
            HintKind.POSTED,
            observedAt = 2_000L,
        )
        assertNull(rejected)
    }

    @Test
    fun emitsOnlyOpaqueTokensForTitleAndText() {
        val secretTitle = "Private research title"
        val secretText = "A private completion body that must never be persisted"
        val hint = requireNotNull(
            projector.project(
                fields(title = secretTitle, text = secretText),
                HintKind.POSTED,
                observedAt = 2_000L,
            ),
        )

        val encoded = listOfNotNull(
            hint.notificationKeyHash,
            hint.titleToken,
            hint.textToken,
            hint.groupKeyHash,
        ).joinToString("|")
        assertFalse(encoded.contains(secretTitle))
        assertFalse(encoded.contains(secretText))
        assertTrue(hint.notificationKeyHash.matches(Regex("hmac-sha256:[0-9a-f]{64}")))
        assertTrue(hint.titleToken!!.startsWith("title:length=${secretTitle.length}:h="))
        assertTrue(hint.textToken!!.startsWith("text:length=${secretText.length}:h="))
        assertEquals(HintConfidence.PROBABLE.wireValue, hint.confidence)
    }

    @Test
    fun slicesACharSequenceBeforeConvertingItToString() {
        val source = NoWholeValueToStringCharSequence("x".repeat(20_000))
        val hint = requireNotNull(
            projector.project(
                fields(title = source, text = null),
                HintKind.POSTED,
                observedAt = 2_000L,
            ),
        )
        assertTrue(hint.titleToken!!.startsWith("title:length=20000:h="))
    }

    @Test
    fun keepsUnknownConfidenceWhenNoRoutingTextExists() {
        val hint = requireNotNull(
            projector.project(
                fields(title = null, text = null),
                HintKind.REMOVED,
                observedAt = 2_000L,
            ),
        )
        assertNull(hint.titleToken)
        assertNull(hint.textToken)
        assertEquals(HintConfidence.UNKNOWN.wireValue, hint.confidence)
        assertEquals(HintKind.REMOVED.wireValue, hint.kind)
    }

    @Test
    fun boundsCategoryLength() {
        val hint = requireNotNull(
            projector.project(
                fields(category = "c".repeat(1_000)),
                HintKind.POSTED,
                observedAt = 2_000L,
            ),
        )
        assertEquals(128, hint.category?.length)
    }

    @Test
    fun validatesEveryPersistedProtocolField() {
        val valid = requireNotNull(
            projector.project(fields(), HintKind.POSTED, observedAt = 2_000L),
        )
        assertEquals(valid, valid.validatePersisted())

        assertThrows(IllegalArgumentException::class.java) {
            valid.copy(sourcePackage = "com.example.other").validatePersisted()
        }
        assertThrows(IllegalArgumentException::class.java) {
            valid.copy(notificationKeyHash = "raw-notification-key").validatePersisted()
        }
        assertThrows(IllegalArgumentException::class.java) {
            valid.copy(titleToken = "raw notification title").validatePersisted()
        }
        assertThrows(IllegalArgumentException::class.java) {
            valid.copy(kind = "unexpected").validatePersisted()
        }
    }

    private fun fields(
        sourcePackage: String = CHATGPT_PACKAGE,
        title: CharSequence? = "Research thread",
        text: CharSequence? = "Your response is ready",
        category: String? = "message",
    ): NotificationFields = NotificationFields(
        sourcePackage = sourcePackage,
        postedAt = 1_900L,
        notificationKey = "0|$sourcePackage|42|null|1000",
        title = title,
        text = text,
        category = category,
        groupKey = "0|$sourcePackage|g:summary",
        isOngoing = false,
    )
}

private class NoWholeValueToStringCharSequence(
    private val value: String,
) : CharSequence {
    override val length: Int
        get() = value.length

    override fun get(index: Int): Char = value[index]

    override fun subSequence(startIndex: Int, endIndex: Int): CharSequence = value.substring(startIndex, endIndex)

    override fun toString(): String = error("The full CharSequence must not be materialized")
}
