// SPDX-License-Identifier: MPL-2.0
package dev.elatura.notificationcompanion

internal const val CHATGPT_PACKAGE = "com.openai.chatgpt"
internal const val COMPLETION_HINT_PROTOCOL_VERSION = 1
internal const val MAX_EPHEMERAL_TEXT_CODE_UNITS = 4_096
private const val MAX_CATEGORY_CODE_UNITS = 128
private const val MAX_REMOVAL_REASON_CODE = 1_024
private const val DISPLAY_DIGEST_HEX = 24
private val REQUIRED_HASH_PATTERN = Regex("^hmac-sha256:[0-9a-f]{64}$")
private val TITLE_TOKEN_PATTERN = Regex("^title:length=[0-9]{1,10}:h=[0-9a-f]{24}$")
private val TEXT_TOKEN_PATTERN = Regex("^text:length=[0-9]{1,10}:h=[0-9a-f]{24}$")
private val REMOVAL_REASON_PATTERN = Regex("^[a-z0-9-]{1,64}$")

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
    val notificationId: Int,
    val tag: String?,
    val channelId: String?,
    val shortcutId: String?,
    val isGroupSummary: Boolean,
    val isClearable: Boolean,
    val hasProgress: Boolean,
    val isProgressIndeterminate: Boolean,
    val removalReasonCode: Int?,
    val removalReason: String?,
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
    val notificationIdHash: String? = null,
    val tagHash: String? = null,
    val channelIdHash: String? = null,
    val shortcutIdHash: String? = null,
    val isGroupSummary: Boolean = false,
    val isClearable: Boolean = false,
    val hasProgress: Boolean = false,
    val isProgressIndeterminate: Boolean = false,
    val removalReasonCode: Int? = null,
    val removalReason: String? = null,
)

internal fun CompletionHintRecord.validatePersisted(): CompletionHintRecord {
    require(protocolVersion == COMPLETION_HINT_PROTOCOL_VERSION) { "Unsupported completion-hint version" }
    require(sourcePackage == CHATGPT_PACKAGE) { "Unexpected completion-hint package" }
    require(observedAt >= 0L) { "Invalid completion-hint observation time" }
    require(postedAt >= 0L) { "Invalid completion-hint post time" }
    require(REQUIRED_HASH_PATTERN.matches(notificationKeyHash)) { "Invalid notification-key hash" }
    require(titleToken == null || TITLE_TOKEN_PATTERN.matches(titleToken)) { "Invalid title token" }
    require(textToken == null || TEXT_TOKEN_PATTERN.matches(textToken)) { "Invalid text token" }
    require(category == null || category.length <= MAX_CATEGORY_CODE_UNITS) { "Invalid category" }
    require(groupKeyHash == null || REQUIRED_HASH_PATTERN.matches(groupKeyHash)) { "Invalid group-key hash" }
    require(notificationIdHash == null || REQUIRED_HASH_PATTERN.matches(notificationIdHash)) {
        "Invalid notification-id hash"
    }
    require(tagHash == null || REQUIRED_HASH_PATTERN.matches(tagHash)) { "Invalid notification-tag hash" }
    require(channelIdHash == null || REQUIRED_HASH_PATTERN.matches(channelIdHash)) {
        "Invalid channel-id hash"
    }
    require(shortcutIdHash == null || REQUIRED_HASH_PATTERN.matches(shortcutIdHash)) {
        "Invalid shortcut-id hash"
    }
    require(!isProgressIndeterminate || hasProgress) { "Indeterminate progress requires progress metadata" }
    require(removalReasonCode == null || removalReasonCode in 0..MAX_REMOVAL_REASON_CODE) {
        "Invalid removal reason code"
    }
    require(removalReason == null || REMOVAL_REASON_PATTERN.matches(removalReason)) {
        "Invalid removal reason"
    }
    require((removalReasonCode == null) == (removalReason == null)) {
        "Removal reason code and name must be present together"
    }
    require(kind == HintKind.POSTED.wireValue || kind == HintKind.REMOVED.wireValue) { "Invalid hint kind" }
    require(kind != HintKind.POSTED.wireValue || removalReason == null) {
        "Posted hints cannot contain a removal reason"
    }
    require(
        confidence == HintConfidence.PROBABLE.wireValue ||
            confidence == HintConfidence.UNKNOWN.wireValue,
    ) { "Invalid hint confidence" }
    return this
}

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
        require(kind == HintKind.REMOVED || fields.removalReasonCode == null) {
            "Posted notification fields cannot include a removal reason"
        }

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
            groupKeyHash = optionalHash("group-key", fields.groupKey),
            isOngoing = fields.isOngoing,
            kind = kind.wireValue,
            confidence = confidence.wireValue,
            notificationIdHash = requiredHash("notification-id", fields.notificationId.toString()),
            tagHash = optionalHash("notification-tag", fields.tag),
            channelIdHash = optionalHash("channel-id", fields.channelId),
            shortcutIdHash = optionalHash("shortcut-id", fields.shortcutId),
            isGroupSummary = fields.isGroupSummary,
            isClearable = fields.isClearable,
            hasProgress = fields.hasProgress,
            isProgressIndeterminate = fields.hasProgress && fields.isProgressIndeterminate,
            removalReasonCode = fields.removalReasonCode,
            removalReason = fields.removalReason,
        ).validatePersisted()
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

    private fun optionalHash(label: String, input: String?): String? {
        val bounded = input
            ?.take(MAX_EPHEMERAL_TEXT_CODE_UNITS)
            ?.trim()
            ?.takeIf(String::isNotEmpty)
            ?: return null
        return requiredHash(label, bounded)
    }

    private fun requiredHash(label: String, input: String): String {
        return "hmac-sha256:${signer.hmacSha256Hex(label, input)}"
    }
}
