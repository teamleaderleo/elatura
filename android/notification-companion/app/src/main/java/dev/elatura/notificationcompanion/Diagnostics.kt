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
    val serviceStartedElapsedRealtime: Long,
    val serviceStartCount: Long,
    val testStartedAt: Long,
    val verifiedCompletedCases: Long,
    val verifiedNotificationArrived: Long,
    val verifiedNotificationMissed: Long,
    val verifiedDeepLinkCorrect: Long,
    val verifiedDeepLinkFailed: Long,
    val verifiedDeepLinkNotTested: Long,
    val lastVerifiedTestCase: VerifiedTestCase?,
)

internal fun HintStoreSnapshot.physicalTestTally(): PhysicalTestTally = PhysicalTestTally(
    completedCases = verifiedCompletedCases,
    notificationArrived = verifiedNotificationArrived,
    notificationMissed = verifiedNotificationMissed,
    deepLinkCorrect = verifiedDeepLinkCorrect,
    deepLinkFailed = verifiedDeepLinkFailed,
    deepLinkNotTested = verifiedDeepLinkNotTested,
)

internal data class DiagnosticEnvironment(
    val deviceManufacturer: String,
    val deviceModel: String,
    val androidRelease: String,
    val androidSdkInt: Int,
    val chatGptVersion: String,
    val elaturaVersion: String,
    val buildSha: String,
    val buildRunId: String,
    val batteryOptimizationExempt: Boolean?,
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
    val withNotificationId: Int,
    val withTag: Int,
    val withChannelId: Int,
    val withShortcutId: Int,
    val groupSummaries: Int,
    val clearable: Int,
    val withProgress: Int,
    val indeterminateProgress: Int,
    val removalsWithReason: Int,
    val reusedNotificationKeyEvents: Int,
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
    append('\u0000')
    append(notificationIdHash)
    append('\u0000')
    append(tagHash)
    append('\u0000')
    append(channelIdHash)
    append('\u0000')
    append(shortcutIdHash)
    append('\u0000')
    append(isGroupSummary)
    append('\u0000')
    append(isClearable)
    append('\u0000')
    append(hasProgress)
    append('\u0000')
    append(isProgressIndeterminate)
    append('\u0000')
    append(removalReasonCode)
    append('\u0000')
    append(removalReason)
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
    var withNotificationId = 0
    var withTag = 0
    var withChannelId = 0
    var withShortcutId = 0
    var groupSummaries = 0
    var clearable = 0
    var withProgress = 0
    var indeterminateProgress = 0
    var removalsWithReason = 0
    var reusedNotificationKeyEvents = 0
    var probableConfidence = 0
    var unknownConfidence = 0
    var negativeLatencyCount = 0
    var latencyOutlierCount = 0
    val latencies = ArrayList<Long>(hints.size)
    val seenNotificationKeys = HashSet<String>(hints.size)

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
        if (hint.notificationIdHash != null) withNotificationId += 1
        if (hint.tagHash != null) withTag += 1
        if (hint.channelIdHash != null) withChannelId += 1
        if (hint.shortcutIdHash != null) withShortcutId += 1
        if (hint.isGroupSummary) groupSummaries += 1
        if (hint.isClearable) clearable += 1
        if (hint.hasProgress) withProgress += 1
        if (hint.isProgressIndeterminate) indeterminateProgress += 1
        if (hint.removalReason != null) removalsWithReason += 1
        if (!seenNotificationKeys.add(hint.notificationKeyHash)) reusedNotificationKeyEvents += 1
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
        withNotificationId = withNotificationId,
        withTag = withTag,
        withChannelId = withChannelId,
        withShortcutId = withShortcutId,
        groupSummaries = groupSummaries,
        clearable = clearable,
        withProgress = withProgress,
        indeterminateProgress = indeterminateProgress,
        removalsWithReason = removalsWithReason,
        reusedNotificationKeyEvents = reusedNotificationKeyEvents,
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
    environment: DiagnosticEnvironment,
    accessGranted: Boolean,
    listenerConfirmedInCurrentProcess: Boolean,
    generatedAt: Long,
): String {
    val summary = summarizeHints(snapshot.hints)
    val lastCase = snapshot.lastVerifiedTestCase
    val notificationKeyCounts = snapshot.hints
        .groupingBy { stored -> stored.hint.notificationKeyHash }
        .eachCount()
    return buildString {
        appendLine("Elatura Android notification diagnostic")
        appendLine("elaturaVersion=${environment.elaturaVersion}")
        appendLine("buildSha=${environment.buildSha}")
        appendLine("buildRunId=${environment.buildRunId}")
        appendLine("deviceManufacturer=${environment.deviceManufacturer}")
        appendLine("deviceModel=${environment.deviceModel}")
        appendLine("androidRelease=${environment.androidRelease}")
        appendLine("androidSdkInt=${environment.androidSdkInt}")
        appendLine("chatGptVersion=${environment.chatGptVersion}")
        appendLine("batteryOptimizationExempt=${environment.batteryOptimizationExempt ?: "unknown"}")
        appendLine("generatedAtEpochMs=$generatedAt")
        appendLine("notificationAccessGranted=$accessGranted")
        appendLine("listenerConfirmedInCurrentProcess=$listenerConfirmedInCurrentProcess")
        appendLine("listenerLastCallbackConnected=${snapshot.listenerConnected}")
        appendLine("listenerConnectedAtEpochMs=${snapshot.listenerConnectedAt}")
        appendLine("listenerDisconnectedAtEpochMs=${snapshot.listenerDisconnectedAt}")
        appendLine("listenerConnectionCount=${snapshot.listenerConnectionCount}")
        appendLine("serviceStartedAtEpochMs=${snapshot.serviceStartedAt}")
        appendLine("serviceStartedElapsedRealtimeMs=${snapshot.serviceStartedElapsedRealtime}")
        appendLine("serviceStartCount=${snapshot.serviceStartCount}")
        appendLine("testStartedAtEpochMs=${snapshot.testStartedAt}")
        appendLine("verifiedCompletedCases=${snapshot.verifiedCompletedCases}")
        appendLine("verifiedNotificationArrived=${snapshot.verifiedNotificationArrived}")
        appendLine("verifiedNotificationMissed=${snapshot.verifiedNotificationMissed}")
        appendLine("verifiedDeepLinkCorrect=${snapshot.verifiedDeepLinkCorrect}")
        appendLine("verifiedDeepLinkFailed=${snapshot.verifiedDeepLinkFailed}")
        appendLine("verifiedDeepLinkNotTested=${snapshot.verifiedDeepLinkNotTested}")
        appendLine("lastVerifiedCaseRecordedAtEpochMs=${lastCase?.recordedAt ?: 0L}")
        appendLine("lastVerifiedCaseNotificationArrived=${lastCase?.notificationArrived ?: false}")
        appendLine("lastVerifiedCaseDeepLinkResult=${lastCase?.deepLinkResult?.wireValue ?: "none"}")
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
        appendLine("withNotificationId=${summary.withNotificationId}")
        appendLine("withTag=${summary.withTag}")
        appendLine("withChannelId=${summary.withChannelId}")
        appendLine("withShortcutId=${summary.withShortcutId}")
        appendLine("groupSummaries=${summary.groupSummaries}")
        appendLine("clearable=${summary.clearable}")
        appendLine("withProgress=${summary.withProgress}")
        appendLine("indeterminateProgress=${summary.indeterminateProgress}")
        appendLine("removalsWithReason=${summary.removalsWithReason}")
        appendLine("reusedNotificationKeyEvents=${summary.reusedNotificationKeyEvents}")
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
            append(" notificationId=${hint.notificationIdHash != null}")
            append(" tag=${hint.tagHash != null}")
            append(" channelId=${hint.channelIdHash != null}")
            append(" shortcutId=${hint.shortcutIdHash != null}")
            append(" groupSummary=${hint.isGroupSummary}")
            append(" clearable=${hint.isClearable}")
            append(" progress=${hint.hasProgress}")
            append(" progressIndeterminate=${hint.isProgressIndeterminate}")
            append(" removalReasonCode=${hint.removalReasonCode ?: -1}")
            append(" removalReason=${hint.removalReason ?: "none"}")
            append(" reusedNotificationKey=${notificationKeyCounts[hint.notificationKeyHash]?.let { it > 1 } ?: false}")
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
