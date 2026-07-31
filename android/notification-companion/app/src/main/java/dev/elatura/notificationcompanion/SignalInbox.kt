// SPDX-License-Identifier: MPL-2.0
package dev.elatura.notificationcompanion

internal enum class SignalInboxState {
    POSSIBLE_COMPLETION,
    IN_PROGRESS,
    UNKNOWN,
    REMOVED,
}

internal data class SignalInboxItem(
    val latestSequence: Long,
    val latestObservedAt: Long,
    val eventCount: Int,
    val state: SignalInboxState,
    val hasTitleClue: Boolean,
    val hasTextClue: Boolean,
    val hasChannelClue: Boolean,
    val hasShortcutClue: Boolean,
    val isGroupSummary: Boolean,
    val removalReasonName: String?,
)

internal fun buildSignalInbox(
    hints: List<StoredCompletionHint>,
    limit: Int = MAX_SIGNAL_INBOX_ITEMS,
): List<SignalInboxItem> {
    require(limit in 1..MAX_SIGNAL_INBOX_ITEMS)

    val groups = linkedMapOf<String, MutableSignalGroup>()
    val ordered = hints.sortedWith(
        compareByDescending<StoredCompletionHint> { it.hint.observedAt }
            .thenByDescending { it.sequence },
    )

    for (stored in ordered) {
        val key = stored.hint.notificationKeyHash
        val existing = groups[key]
        if (existing == null) {
            groups[key] = MutableSignalGroup(latest = stored, eventCount = 1)
        } else {
            existing.eventCount += 1
        }
    }

    return groups.values
        .map { group -> group.toInboxItem() }
        .sortedWith(
            compareBy<SignalInboxItem> { it.state.priority }
                .thenByDescending { it.latestObservedAt }
                .thenByDescending { it.latestSequence },
        )
        .take(limit)
}

private data class MutableSignalGroup(
    val latest: StoredCompletionHint,
    var eventCount: Int,
)

private fun MutableSignalGroup.toInboxItem(): SignalInboxItem {
    val hint = latest.hint
    val state = classifySignal(hint)
    return SignalInboxItem(
        latestSequence = latest.sequence,
        latestObservedAt = hint.observedAt,
        eventCount = eventCount,
        state = state,
        hasTitleClue = hint.titleToken != null,
        hasTextClue = hint.textToken != null,
        hasChannelClue = hint.channelIdHash != null,
        hasShortcutClue = hint.shortcutIdHash != null,
        isGroupSummary = hint.isGroupSummary,
        removalReasonName = hint.removalReasonName.takeIf {
            state == SignalInboxState.REMOVED && it != "none"
        },
    )
}

private fun classifySignal(hint: CompletionHintRecord): SignalInboxState {
    if (hint.kind == HintKind.REMOVED.wireValue) return SignalInboxState.REMOVED
    if (hint.isGroupSummary) return SignalInboxState.UNKNOWN

    val progressIncomplete = hint.progressMax > 0 && hint.progress < hint.progressMax
    if (hint.isOngoing || hint.isProgressIndeterminate || progressIncomplete) {
        return SignalInboxState.IN_PROGRESS
    }

    val hasRoutingClue = hint.titleToken != null || hint.textToken != null
    return if (
        hint.kind == HintKind.POSTED.wireValue &&
        hint.confidence == HintConfidence.PROBABLE.wireValue &&
        hasRoutingClue
    ) {
        SignalInboxState.POSSIBLE_COMPLETION
    } else {
        SignalInboxState.UNKNOWN
    }
}

private val SignalInboxState.priority: Int
    get() = when (this) {
        SignalInboxState.POSSIBLE_COMPLETION -> 0
        SignalInboxState.IN_PROGRESS -> 1
        SignalInboxState.UNKNOWN -> 2
        SignalInboxState.REMOVED -> 3
    }

internal const val MAX_SIGNAL_INBOX_ITEMS = 8
