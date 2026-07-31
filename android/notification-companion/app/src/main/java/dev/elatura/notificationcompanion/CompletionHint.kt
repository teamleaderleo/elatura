// SPDX-License-Identifier: MPL-2.0
package dev.elatura.notificationcompanion

internal const val CHATGPT_PACKAGE = "com.openai.chatgpt"
internal const val COMPLETION_HINT_PROTOCOL_VERSION = 1
internal const val MAX_EPHEMERAL_TEXT_CODE_UNITS = 4_096
private const val MAX_CATEGORY_CODE_UNITS = 128
private const val DISPLAY_DIGEST_HEX = 24

internal enum class HintKind(val wireValue: String) {
    POSTED("posted"),
    REMOVED("removed"),
}

internal enum class HintConfidence(val wireValue: String) {
    PROBABLE("probable"),
    UNKNOWN("unknown"),
}

internal data class NotificationFields(
    val sourcePackage: String,
    val postedAt: Long,
    val notificationKey: String,
    val title: CharSequence?,
    val text: CharSequence?,
    val category: String?,
    val groupKey: String?,
    val isOngoing: Boolean,
)

internal data class CompletionHintRecord(
    val protocolVersion: Int = COMPLETION_HINT_PROTOCOL_VERSION,
    val sourcePackage: String,
    val observedAt: Long,
    val postedAt: Long,
    val notificationKeyHash: String,
    val titleToken: String?,
    val textToken: String?,
    val category: String?,
    val groupKeyHash: String?,
    val isOngoing: Boolean,
    val kind: String,
    val confidence: String,
)

internal fun interface TokenSigner {
    fun hmacSha256Hex(label: String, value: String): String
}

internal class CompletionHintProjector(
    private val signer: TokenSigner,
) {
    fun project(
        fields: NotificationFields,
        kind: HintKind,
        observedAt: Long,
    ): CompletionHintRecord? {
        if (fields.sourcePackage != CHATGPT_PACKAGE) return null
        require(observedAt >= 0) { "observedAt must be non-negative" }
        require(fields.postedAt >= 0) { "postedAt must be non-negative" }
        require(fields.notificationKey.isNotBlank()) { "notification key must not be blank" }

        val titleToken = textToken("title", fields.title)
        val textToken = textToken("text", fields.text)
        val confidence = if (titleToken != null || textToken != null) {
            HintConfidence.PROBABLE
        } else {
            HintConfidence.UNKNOWN
        }

        return CompletionHintRecord(
            sourcePackage = fields.sourcePackage,
            observedAt = observedAt,
            postedAt = fields.postedAt,
            notificationKeyHash = requiredHash(
                "notification-key",
                fields.notificationKey.take(MAX_EPHEMERAL_TEXT_CODE_UNITS),
            ),
            titleToken = titleToken,
            textToken = textToken,
            category = fields.category?.take(MAX_CATEGORY_CODE_UNITS),
            groupKeyHash = fields.groupKey
                ?.takeIf { it.isNotBlank() }
                ?.take(MAX_EPHEMERAL_TEXT_CODE_UNITS)
                ?.let { requiredHash("group-key", it) },
            isOngoing = fields.isOngoing,
            kind = kind.wireValue,
            confidence = confidence.wireValue,
        )
    }

    private fun textToken(label: String, input: CharSequence?): String? {
        input ?: return null
        val originalLength = input.length
        val bounded = input
            .subSequence(0, minOf(originalLength, MAX_EPHEMERAL_TEXT_CODE_UNITS))
            .toString()
            .trim()
            .takeIf(String::isNotEmpty)
            ?: return null
        val digest = signer.hmacSha256Hex(label, bounded)
        return "$label:length=$originalLength:h=${digest.take(DISPLAY_DIGEST_HEX)}"
    }

    private fun requiredHash(label: String, input: String): String {
        return "hmac-sha256:${signer.hmacSha256Hex(label, input)}"
    }
}
