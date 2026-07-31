// SPDX-License-Identifier: MPL-2.0
package dev.elatura.notificationcompanion

internal data class StoredCompletionHint(
    val sequence: Long,
    val hint: CompletionHintRecord,
)

internal data class HintStoreSnapshot(
    val hints: List<StoredCompletionHint>,
    val observed: Long,
    val accepted: Long,
    val duplicates: Long,
    val dropped: Long,
    val errors: Long,
    val corruptRecords: Long,
    val lastEventAt: Long,
    val listenerConnected: Boolean,
    val listenerConnectedAt: Long,
    val listenerDisconnectedAt: Long,
    val listenerConnectionCount: Long,
    val serviceStartedAt: Long,
    val serviceStartCount: Long,
)

internal data class HintDiagnosticsSummary(
    val retained: Int,
    val posted: Int,
    val removed: Int,
    val possibleCompletions: Int,
    val ongoing: Int,
    val withTitleToken: Int,
    val withTextToken: Int,
    val grouped: Int,
    val withCategory: Int,
    val probableConfidence: Int,
    val unknownConfidence: Int,
    val latencySamples: Int,
    val latencyMinimumMs: Long?,
    val latencyMedianMs: Long?,
    val latencyP95Ms: Long?,
    val latencyMaximumMs: Long?,
    val latencyAverageMs: Long?,
    val negativeLatencyCount: Int,
    val latencyOutlierCount: Int,
)

internal fun CompletionHintRecord.exactEventSignature(): String = buildString {
    append(protocolVersion)
    append('\u0000')
    append(sourcePackage)
    append('\u0000')
    append(postedAt)
    append('\u0000')
    append(notificationKeyHash)
    append('\u0000')
    append(titleToken)
    append('\u0000')
    append(textToken)
    append('\u0000')
    append(category)
    append('\u0000')
    append(groupKeyHash)
    append('\u0000')
    append(isOngoing)
    append('\u0000')
    append(kind)
    append('\u0000')
    append(confidence)
}

internal fun summarizeHints(hints: List<StoredCompletionHint>): HintDiagnosticsSummary {
    var posted = 0
    var removed = 0
    var possibleCompletions = 0
    var ongoing = 0
    var withTitleToken = 0
    var withTextToken = 0
    var grouped = 0
    var withCategory = 0
    var probableConfidence = 0
    var unknownConfidence = 0
    var negativeLatencyCount = 0
    var latencyOutlierCount = 0
    val latencies = ArrayList<Long>(hints.size)

    for (stored in hints) {
        val hint = stored.hint
        when (hint.kind) {
            HintKind.POSTED.wireValue -> posted += 1
            HintKind.REMOVED.wireValue -> removed += 1
        }
        if (hint.kind == HintKind.POSTED.wireValue && !hint.isOngoing) possibleCompletions += 1
        if (hint.isOngoing) ongoing += 1
        if (hint.titleToken != null) withTitleToken += 1
        if (hint.textToken != null) withTextToken += 1
        if (hint.groupKeyHash != null) grouped += 1
        if (hint.category != null) withCategory += 1
        when (hint.confidence) {
            HintConfidence.PROBABLE.wireValue -> probableConfidence += 1
            HintConfidence.UNKNOWN.wireValue -> unknownConfidence += 1
        }

        val latency = hint.observedAt - hint.postedAt
        when {
            latency < 0L -> negativeLatencyCount += 1
            latency > MAX_REASONABLE_NOTIFICATION_LATENCY_MS -> latencyOutlierCount += 1
            else -> latencies.add(latency)
        }
    }

    latencies.sort()
    return HintDiagnosticsSummary(
        retained = hints.size,
        posted = posted,
        removed = removed,
        possibleCompletions = possibleCompletions,
        ongoing = ongoing,
        withTitleToken = withTitleToken,
        withTextToken = withTextToken,
        grouped = grouped,
        withCategory = withCategory,
        probableConfidence = probableConfidence,
        unknownConfidence = unknownConfidence,
        latencySamples = latencies.size,
        latencyMinimumMs = latencies.firstOrNull(),
        latencyMedianMs = percentile(latencies, 0.50),
        latencyP95Ms = percentile(latencies, 0.95),
        latencyMaximumMs = latencies.lastOrNull(),
        latencyAverageMs = if (latencies.isEmpty()) null else latencies.average().toLong(),
        negativeLatencyCount = negativeLatencyCount,
        latencyOutlierCount = latencyOutlierCount,
    )
}

internal fun buildContentFreeReport(
    snapshot: HintStoreSnapshot,
    accessGranted: Boolean,
    generatedAt: Long,
    appVersion: String,
): String {
    val summary = summarizeHints(snapshot.hints)
    return buildString {
        appendLine("Elatura Android notification diagnostic")
        appendLine("version=$appVersion")
        appendLine("generatedAtEpochMs=$generatedAt")
        appendLine("notificationAccessGranted=$accessGranted")
        appendLine("listenerLastCallbackConnected=${snapshot.listenerConnected}")
        appendLine("listenerConnectedAtEpochMs=${snapshot.listenerConnectedAt}")
        appendLine("listenerDisconnectedAtEpochMs=${snapshot.listenerDisconnectedAt}")
        appendLine("listenerConnectionCount=${snapshot.listenerConnectionCount}")
        appendLine("serviceStartedAtEpochMs=${snapshot.serviceStartedAt}")
        appendLine("serviceStartCount=${snapshot.serviceStartCount}")
        appendLine("observed=${snapshot.observed}")
        appendLine("accepted=${snapshot.accepted}")
        appendLine("duplicates=${snapshot.duplicates}")
        appendLine("dropped=${snapshot.dropped}")
        appendLine("errors=${snapshot.errors}")
        appendLine("corruptRecords=${snapshot.corruptRecords}")
        appendLine("lastEventAtEpochMs=${snapshot.lastEventAt}")
        appendLine("retained=${summary.retained}")
        appendLine("posted=${summary.posted}")
        appendLine("removed=${summary.removed}")
        appendLine("possibleCompletions=${summary.possibleCompletions}")
        appendLine("ongoing=${summary.ongoing}")
        appendLine("withTitleToken=${summary.withTitleToken}")
        appendLine("withTextToken=${summary.withTextToken}")
        appendLine("grouped=${summary.grouped}")
        appendLine("withCategory=${summary.withCategory}")
        appendLine("probableConfidence=${summary.probableConfidence}")
        appendLine("unknownConfidence=${summary.unknownConfidence}")
        appendLine("latencySamples=${summary.latencySamples}")
        appendLine("latencyMinimumMs=${summary.latencyMinimumMs ?: -1L}")
        appendLine("latencyMedianMs=${summary.latencyMedianMs ?: -1L}")
        appendLine("latencyP95Ms=${summary.latencyP95Ms ?: -1L}")
        appendLine("latencyMaximumMs=${summary.latencyMaximumMs ?: -1L}")
        appendLine("latencyAverageMs=${summary.latencyAverageMs ?: -1L}")
        appendLine("negativeLatencyCount=${summary.negativeLatencyCount}")
        appendLine("latencyOutlierCount=${summary.latencyOutlierCount}")
        appendLine("eventsNewestFirst:")
        for (stored in snapshot.hints) {
            val hint = stored.hint
            val latency = hint.observedAt - hint.postedAt
            append("sequence=${stored.sequence}")
            append(" observedAt=${hint.observedAt}")
            append(" postedAt=${hint.postedAt}")
            append(" kind=${hint.kind}")
            append(" ongoing=${hint.isOngoing}")
            append(" titleToken=${hint.titleToken != null}")
            append(" textToken=${hint.textToken != null}")
            append(" grouped=${hint.groupKeyHash != null}")
            append(" category=${hint.category != null}")
            append(" confidence=${hint.confidence}")
            appendLine(" latencyMs=$latency")
        }
    }
}

private fun percentile(sorted: List<Long>, fraction: Double): Long? {
    if (sorted.isEmpty()) return null
    val index = ((sorted.lastIndex * fraction) + 0.5).toInt().coerceIn(0, sorted.lastIndex)
    return sorted[index]
}

private const val MAX_REASONABLE_NOTIFICATION_LATENCY_MS = 24L * 60L * 60L * 1_000L
