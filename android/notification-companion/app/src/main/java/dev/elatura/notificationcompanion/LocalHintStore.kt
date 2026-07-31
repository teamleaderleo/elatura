// SPDX-License-Identifier: MPL-2.0
package dev.elatura.notificationcompanion

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.max

internal class LocalHintStore(context: Context) {
    private val preferences: SharedPreferences = context.getSharedPreferences(
        PREFERENCES_NAME,
        Context.MODE_PRIVATE,
    )
    private val lock = PROCESS_LOCK

    fun registerChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener) {
        preferences.registerOnSharedPreferenceChangeListener(listener)
    }

    fun unregisterChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener) {
        preferences.unregisterOnSharedPreferenceChangeListener(listener)
    }

    fun append(hint: CompletionHintRecord): Long = synchronized(lock) {
        val admittedHint = hint.validatePersisted()
        val loaded = loadArray()
        val sanitized = JSONArray()
        var newlyDetectedCorruptRecords = if (loaded.corruptContainer) 1L else 0L
        for (index in 0 until loaded.array.length()) {
            val value = try {
                loaded.array.getJSONObject(index)
            } catch (_: Exception) {
                null
            }
            val valid = value?.let {
                try {
                    it.toStoredHint()
                    true
                } catch (_: Exception) {
                    false
                }
            } ?: false
            if (!valid) newlyDetectedCorruptRecords = saturatedAdd(newlyDetectedCorruptRecords, 1L)
            else sanitized.put(value)
        }
        while (sanitized.length() > MAX_QUEUE_ENTRIES) sanitized.remove(0)

        val observed = saturatedIncrement(counter(KEY_OBSERVED))
        val corruptRecords = saturatedAdd(counter(KEY_CORRUPT_RECORDS), newlyDetectedCorruptRecords)
        val duplicate = containsRecentExactEvent(sanitized, admittedHint)
        if (duplicate) {
            val committed = preferences.edit()
                .putString(KEY_HINTS, sanitized.toString())
                .putLong(KEY_OBSERVED, observed)
                .putLong(KEY_DUPLICATES, saturatedIncrement(counter(KEY_DUPLICATES)))
                .putLong(KEY_CORRUPT_RECORDS, corruptRecords)
                .putLong(KEY_LAST_EVENT_AT, admittedHint.observedAt)
                .commit()
            check(committed) { "Unable to commit duplicate completion-hint accounting" }
            return@synchronized counter(KEY_SEQUENCE)
        }

        val currentSequence = counter(KEY_SEQUENCE)
        val nextSequence = if (currentSequence == Long.MAX_VALUE) 1L else currentSequence + 1L
        sanitized.put(admittedHint.toJson(nextSequence))
        while (sanitized.length() > MAX_QUEUE_ENTRIES) sanitized.remove(0)

        val committed = preferences.edit()
            .putString(KEY_HINTS, sanitized.toString())
            .putLong(KEY_SEQUENCE, nextSequence)
            .putLong(KEY_OBSERVED, observed)
            .putLong(KEY_ACCEPTED, saturatedIncrement(counter(KEY_ACCEPTED)))
            .putLong(KEY_CORRUPT_RECORDS, corruptRecords)
            .putLong(KEY_LAST_EVENT_AT, admittedHint.observedAt)
            .commit()
        check(committed) { "Unable to commit the bounded completion hint" }
        nextSequence
    }

    fun recordDropped() = increment(KEY_DROPPED)

    fun recordError() = increment(KEY_ERRORS)

    fun markServiceStarted(now: Long, elapsedRealtime: Long) {
        require(now >= 0L)
        require(elapsedRealtime >= 0L)
        synchronized(lock) {
            preferences.edit()
                .putBoolean(KEY_LISTENER_CONNECTED, false)
                .putLong(KEY_SERVICE_STARTED_AT, now)
                .putLong(KEY_SERVICE_STARTED_ELAPSED_REALTIME, elapsedRealtime)
                .putLong(KEY_SERVICE_START_COUNT, saturatedIncrement(counter(KEY_SERVICE_START_COUNT)))
                .commit()
        }
    }

    fun setListenerConnected(connected: Boolean, now: Long) {
        require(now >= 0L)
        synchronized(lock) {
            val wasConnected = preferences.getBoolean(KEY_LISTENER_CONNECTED, false)
            val editor = preferences.edit().putBoolean(KEY_LISTENER_CONNECTED, connected)
            if (connected) {
                editor.putLong(KEY_LISTENER_CONNECTED_AT, now)
                if (!wasConnected) {
                    editor.putLong(
                        KEY_LISTENER_CONNECTION_COUNT,
                        saturatedIncrement(counter(KEY_LISTENER_CONNECTION_COUNT)),
                    )
                }
            } else if (wasConnected) {
                editor.putLong(KEY_LISTENER_DISCONNECTED_AT, now)
            }
            editor.commit()
        }
    }

    fun startTestTally(now: Long): Boolean {
        require(now >= 0L)
        return synchronized(lock) {
            preferences.edit()
                .putLong(KEY_TEST_STARTED_AT, now)
                .remove(KEY_VERIFIED_COMPLETED_CASES)
                .remove(KEY_VERIFIED_NOTIFICATION_ARRIVED)
                .remove(KEY_VERIFIED_NOTIFICATION_MISSED)
                .remove(KEY_VERIFIED_DEEP_LINK_CORRECT)
                .remove(KEY_VERIFIED_DEEP_LINK_FAILED)
                .remove(KEY_VERIFIED_DEEP_LINK_NOT_TESTED)
                .remove(KEY_LAST_VERIFIED_TEST_CASE)
                .commit()
        }
    }

    fun recordVerifiedTestCase(testCase: VerifiedTestCase): Boolean = synchronized(lock) {
        val updated = physicalTestTally().apply(testCase)
        val editor = preferences.edit()
            .putLong(KEY_VERIFIED_COMPLETED_CASES, updated.completedCases)
            .putLong(KEY_VERIFIED_NOTIFICATION_ARRIVED, updated.notificationArrived)
            .putLong(KEY_VERIFIED_NOTIFICATION_MISSED, updated.notificationMissed)
            .putLong(KEY_VERIFIED_DEEP_LINK_CORRECT, updated.deepLinkCorrect)
            .putLong(KEY_VERIFIED_DEEP_LINK_FAILED, updated.deepLinkFailed)
            .putLong(KEY_VERIFIED_DEEP_LINK_NOT_TESTED, updated.deepLinkNotTested)
            .putString(KEY_LAST_VERIFIED_TEST_CASE, testCase.toJson().toString())
        if (timestamp(KEY_TEST_STARTED_AT) == 0L) {
            editor.putLong(KEY_TEST_STARTED_AT, testCase.recordedAt)
        }
        editor.commit()
    }

    fun undoLastVerifiedTestCase(): Boolean = synchronized(lock) {
        val lastCase = lastVerifiedTestCase() ?: return@synchronized false
        val updated = physicalTestTally().undo(lastCase)
        preferences.edit()
            .putLong(KEY_VERIFIED_COMPLETED_CASES, updated.completedCases)
            .putLong(KEY_VERIFIED_NOTIFICATION_ARRIVED, updated.notificationArrived)
            .putLong(KEY_VERIFIED_NOTIFICATION_MISSED, updated.notificationMissed)
            .putLong(KEY_VERIFIED_DEEP_LINK_CORRECT, updated.deepLinkCorrect)
            .putLong(KEY_VERIFIED_DEEP_LINK_FAILED, updated.deepLinkFailed)
            .putLong(KEY_VERIFIED_DEEP_LINK_NOT_TESTED, updated.deepLinkNotTested)
            .remove(KEY_LAST_VERIFIED_TEST_CASE)
            .commit()
    }

    fun snapshot(limit: Int = MAX_QUEUE_ENTRIES): HintStoreSnapshot = synchronized(lock) {
        require(limit in 1..MAX_QUEUE_ENTRIES)
        val loaded = loadArray()
        val hints = ArrayList<StoredCompletionHint>(minOf(limit, loaded.array.length()))
        var liveCorruptRecords = if (loaded.corruptContainer) 1L else 0L
        for (index in max(0, loaded.array.length() - limit) until loaded.array.length()) {
            val stored = try {
                loaded.array.getJSONObject(index).toStoredHint()
            } catch (_: Exception) {
                null
            }
            if (stored == null) liveCorruptRecords = saturatedAdd(liveCorruptRecords, 1L)
            else hints.add(stored)
        }
        hints.reverse()
        val tally = physicalTestTally()
        HintStoreSnapshot(
            hints = hints,
            observed = counter(KEY_OBSERVED),
            accepted = counter(KEY_ACCEPTED),
            duplicates = counter(KEY_DUPLICATES),
            dropped = counter(KEY_DROPPED),
            errors = counter(KEY_ERRORS),
            corruptRecords = saturatedAdd(counter(KEY_CORRUPT_RECORDS), liveCorruptRecords),
            lastEventAt = timestamp(KEY_LAST_EVENT_AT),
            listenerConnected = preferences.getBoolean(KEY_LISTENER_CONNECTED, false),
            listenerConnectedAt = timestamp(KEY_LISTENER_CONNECTED_AT),
            listenerDisconnectedAt = timestamp(KEY_LISTENER_DISCONNECTED_AT),
            listenerConnectionCount = counter(KEY_LISTENER_CONNECTION_COUNT),
            serviceStartedAt = timestamp(KEY_SERVICE_STARTED_AT),
            serviceStartedElapsedRealtime = timestamp(KEY_SERVICE_STARTED_ELAPSED_REALTIME),
            serviceStartCount = counter(KEY_SERVICE_START_COUNT),
            testStartedAt = timestamp(KEY_TEST_STARTED_AT),
            verifiedCompletedCases = tally.completedCases,
            verifiedNotificationArrived = tally.notificationArrived,
            verifiedNotificationMissed = tally.notificationMissed,
            verifiedDeepLinkCorrect = tally.deepLinkCorrect,
            verifiedDeepLinkFailed = tally.deepLinkFailed,
            verifiedDeepLinkNotTested = tally.deepLinkNotTested,
            lastVerifiedTestCase = lastVerifiedTestCase(),
        )
    }

    fun clearHints(): Boolean = synchronized(lock) {
        preferences.edit()
            .remove(KEY_HINTS)
            .remove(KEY_SEQUENCE)
            .remove(KEY_OBSERVED)
            .remove(KEY_ACCEPTED)
            .remove(KEY_DUPLICATES)
            .remove(KEY_DROPPED)
            .remove(KEY_ERRORS)
            .remove(KEY_CORRUPT_RECORDS)
            .remove(KEY_LAST_EVENT_AT)
            .commit()
    }

    fun clearAll(): Boolean = synchronized(lock) {
        preferences.edit().clear().commit()
    }

    private fun increment(key: String) {
        synchronized(lock) {
            preferences.edit()
                .putLong(key, saturatedIncrement(counter(key)))
                .commit()
        }
    }

    private fun physicalTestTally(): PhysicalTestTally {
        val arrived = counter(KEY_VERIFIED_NOTIFICATION_ARRIVED)
        val missed = counter(KEY_VERIFIED_NOTIFICATION_MISSED)
        val correct = minOf(counter(KEY_VERIFIED_DEEP_LINK_CORRECT), arrived)
        val remainingAfterCorrect = (arrived - correct).coerceAtLeast(0L)
        val failed = minOf(counter(KEY_VERIFIED_DEEP_LINK_FAILED), remainingAfterCorrect)
        val remainingAfterTested = (remainingAfterCorrect - failed).coerceAtLeast(0L)
        val storedNotTested = if (preferences.contains(KEY_VERIFIED_DEEP_LINK_NOT_TESTED)) {
            counter(KEY_VERIFIED_DEEP_LINK_NOT_TESTED)
        } else {
            remainingAfterTested
        }
        val notTested = minOf(storedNotTested, remainingAfterTested)
        val unaccountedArrivals = (remainingAfterTested - notTested).coerceAtLeast(0L)
        return PhysicalTestTally(
            completedCases = saturatedAdd(arrived, missed),
            notificationArrived = arrived,
            notificationMissed = missed,
            deepLinkCorrect = correct,
            deepLinkFailed = failed,
            deepLinkNotTested = saturatedAdd(notTested, unaccountedArrivals),
        )
    }

    private fun lastVerifiedTestCase(): VerifiedTestCase? {
        val encoded = preferences.getString(KEY_LAST_VERIFIED_TEST_CASE, null) ?: return null
        return try {
            JSONObject(encoded).toVerifiedTestCase()
        } catch (_: Exception) {
            null
        }
    }

    private fun counter(key: String): Long = preferences.getLong(key, 0L).coerceAtLeast(0L)

    private fun timestamp(key: String): Long = preferences.getLong(key, 0L).coerceAtLeast(0L)

    private fun loadArray(): LoadedArray {
        val encoded = preferences.getString(KEY_HINTS, null) ?: return LoadedArray(JSONArray(), false)
        return try {
            LoadedArray(JSONArray(encoded), false)
        } catch (_: Exception) {
            LoadedArray(JSONArray(), true)
        }
    }

    private fun containsRecentExactEvent(array: JSONArray, hint: CompletionHintRecord): Boolean {
        val signature = hint.exactEventSignature()
        val first = max(0, array.length() - MAX_DEDUPE_WINDOW)
        for (index in first until array.length()) {
            val existing = try {
                array.getJSONObject(index).toStoredHint().hint
            } catch (_: Exception) {
                null
            } ?: continue
            if (existing.exactEventSignature() == signature) return true
        }
        return false
    }

    companion object {
        const val MAX_QUEUE_ENTRIES = 64
        private val PROCESS_LOCK = Any()
        private const val MAX_DEDUPE_WINDOW = 8
        private const val PREFERENCES_NAME = "completion-hints-v1"
        private const val KEY_HINTS = "hints"
        private const val KEY_SEQUENCE = "sequence"
        private const val KEY_OBSERVED = "observed"
        private const val KEY_ACCEPTED = "accepted"
        private const val KEY_DUPLICATES = "duplicates"
        private const val KEY_DROPPED = "dropped"
        private const val KEY_ERRORS = "errors"
        private const val KEY_CORRUPT_RECORDS = "corrupt-records"
        private const val KEY_LAST_EVENT_AT = "last-event-at"
        private const val KEY_LISTENER_CONNECTED = "listener-connected"
        private const val KEY_LISTENER_CONNECTED_AT = "listener-connected-at"
        private const val KEY_LISTENER_DISCONNECTED_AT = "listener-disconnected-at"
        private const val KEY_LISTENER_CONNECTION_COUNT = "listener-connection-count"
        private const val KEY_SERVICE_STARTED_AT = "service-started-at"
        private const val KEY_SERVICE_STARTED_ELAPSED_REALTIME = "service-started-elapsed-realtime"
        private const val KEY_SERVICE_START_COUNT = "service-start-count"
        private const val KEY_TEST_STARTED_AT = "test-started-at"
        private const val KEY_VERIFIED_COMPLETED_CASES = "verified-completed-cases"
        private const val KEY_VERIFIED_NOTIFICATION_ARRIVED = "verified-notification-arrived"
        private const val KEY_VERIFIED_NOTIFICATION_MISSED = "verified-notification-missed"
        private const val KEY_VERIFIED_DEEP_LINK_CORRECT = "verified-deep-link-correct"
        private const val KEY_VERIFIED_DEEP_LINK_FAILED = "verified-deep-link-failed"
        private const val KEY_VERIFIED_DEEP_LINK_NOT_TESTED = "verified-deep-link-not-tested"
        private const val KEY_LAST_VERIFIED_TEST_CASE = "last-verified-test-case"
    }
}

private data class LoadedArray(
    val array: JSONArray,
    val corruptContainer: Boolean,
)

private fun CompletionHintRecord.toJson(sequence: Long): JSONObject = JSONObject()
    .put("sequence", sequence)
    .put("protocolVersion", protocolVersion)
    .put("sourcePackage", sourcePackage)
    .put("observedAt", observedAt)
    .put("postedAt", postedAt)
    .put("notificationKeyHash", notificationKeyHash)
    .put("titleToken", titleToken ?: JSONObject.NULL)
    .put("textToken", textToken ?: JSONObject.NULL)
    .put("category", category ?: JSONObject.NULL)
    .put("groupKeyHash", groupKeyHash ?: JSONObject.NULL)
    .put("isOngoing", isOngoing)
    .put("kind", kind)
    .put("confidence", confidence)
    .put("notificationIdHash", notificationIdHash ?: JSONObject.NULL)
    .put("tagHash", tagHash ?: JSONObject.NULL)
    .put("channelIdHash", channelIdHash ?: JSONObject.NULL)
    .put("shortcutIdHash", shortcutIdHash ?: JSONObject.NULL)
    .put("isGroupSummary", isGroupSummary)
    .put("isClearable", isClearable)
    .put("hasProgress", hasProgress)
    .put("isProgressIndeterminate", isProgressIndeterminate)
    .put("removalReasonCode", removalReasonCode ?: JSONObject.NULL)
    .put("removalReason", removalReason ?: JSONObject.NULL)

private fun JSONObject.toStoredHint(): StoredCompletionHint = StoredCompletionHint(
    sequence = getLong("sequence").also { require(it >= 0L) },
    hint = CompletionHintRecord(
        protocolVersion = getInt("protocolVersion"),
        sourcePackage = getString("sourcePackage"),
        observedAt = getLong("observedAt"),
        postedAt = getLong("postedAt"),
        notificationKeyHash = getString("notificationKeyHash"),
        titleToken = nullableString("titleToken"),
        textToken = nullableString("textToken"),
        category = nullableString("category"),
        groupKeyHash = nullableString("groupKeyHash"),
        isOngoing = getBoolean("isOngoing"),
        kind = getString("kind"),
        confidence = getString("confidence"),
        notificationIdHash = nullableString("notificationIdHash"),
        tagHash = nullableString("tagHash"),
        channelIdHash = nullableString("channelIdHash"),
        shortcutIdHash = nullableString("shortcutIdHash"),
        isGroupSummary = optBoolean("isGroupSummary", false),
        isClearable = optBoolean("isClearable", false),
        hasProgress = optBoolean("hasProgress", false),
        isProgressIndeterminate = optBoolean("isProgressIndeterminate", false),
        removalReasonCode = nullableInt("removalReasonCode"),
        removalReason = nullableString("removalReason"),
    ).validatePersisted(),
)

private fun VerifiedTestCase.toJson(): JSONObject = JSONObject()
    .put("recordedAt", recordedAt)
    .put("notificationArrived", notificationArrived)
    .put("deepLinkResult", deepLinkResult?.wireValue ?: JSONObject.NULL)

private fun JSONObject.toVerifiedTestCase(): VerifiedTestCase {
    val deepLinkValue = nullableString("deepLinkResult")
    val deepLinkResult = deepLinkValue?.let { value ->
        DeepLinkResult.entries.firstOrNull { it.wireValue == value }
            ?: throw IllegalArgumentException("Invalid deep-link result")
    }
    return VerifiedTestCase(
        recordedAt = getLong("recordedAt"),
        notificationArrived = getBoolean("notificationArrived"),
        deepLinkResult = deepLinkResult,
    )
}

private fun JSONObject.nullableString(key: String): String? = if (isNull(key)) null else getString(key)

private fun JSONObject.nullableInt(key: String): Int? = if (isNull(key)) null else getInt(key)

private fun saturatedIncrement(value: Long): Long = if (value == Long.MAX_VALUE) Long.MAX_VALUE else value + 1L

private fun saturatedAdd(left: Long, right: Long): Long {
    if (right <= 0L) return left
    return if (left > Long.MAX_VALUE - right) Long.MAX_VALUE else left + right
}
