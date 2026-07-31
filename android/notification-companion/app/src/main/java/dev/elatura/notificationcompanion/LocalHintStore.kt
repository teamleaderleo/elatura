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
    private val lock = Any()

    fun append(hint: CompletionHintRecord): Long = synchronized(lock) {
        val loaded = loadArray()
        val sanitized = JSONArray()
        var newlyDetectedCorruptRecords = if (loaded.corruptContainer) 1L else 0L
        for (index in 0 until loaded.array.length()) {
            val value = runCatching { loaded.array.getJSONObject(index) }.getOrNull()
            if (value == null || runCatching { value.toStoredHint() }.isFailure) {
                newlyDetectedCorruptRecords = saturatedAdd(newlyDetectedCorruptRecords, 1L)
            } else {
                sanitized.put(value)
            }
        }
        while (sanitized.length() > MAX_QUEUE_ENTRIES) sanitized.remove(0)

        val observed = saturatedIncrement(preferences.getLong(KEY_OBSERVED, 0L))
        val corruptRecords = saturatedAdd(
            preferences.getLong(KEY_CORRUPT_RECORDS, 0L),
            newlyDetectedCorruptRecords,
        )
        val duplicate = containsRecentExactEvent(sanitized, hint)
        if (duplicate) {
            val committed = preferences.edit()
                .putString(KEY_HINTS, sanitized.toString())
                .putLong(KEY_OBSERVED, observed)
                .putLong(KEY_DUPLICATES, saturatedIncrement(preferences.getLong(KEY_DUPLICATES, 0L)))
                .putLong(KEY_CORRUPT_RECORDS, corruptRecords)
                .putLong(KEY_LAST_EVENT_AT, hint.observedAt)
                .commit()
            check(committed) { "Unable to commit duplicate completion-hint accounting" }
            return@synchronized preferences.getLong(KEY_SEQUENCE, 0L)
        }

        val currentSequence = preferences.getLong(KEY_SEQUENCE, 0L)
        val nextSequence = if (currentSequence == Long.MAX_VALUE) 1L else currentSequence + 1L
        sanitized.put(hint.toJson(nextSequence))
        while (sanitized.length() > MAX_QUEUE_ENTRIES) sanitized.remove(0)

        val committed = preferences.edit()
            .putString(KEY_HINTS, sanitized.toString())
            .putLong(KEY_SEQUENCE, nextSequence)
            .putLong(KEY_OBSERVED, observed)
            .putLong(KEY_ACCEPTED, saturatedIncrement(preferences.getLong(KEY_ACCEPTED, 0L)))
            .putLong(KEY_CORRUPT_RECORDS, corruptRecords)
            .putLong(KEY_LAST_EVENT_AT, hint.observedAt)
            .commit()
        check(committed) { "Unable to commit the bounded completion hint" }
        nextSequence
    }

    fun recordDropped() = increment(KEY_DROPPED)

    fun recordError() = increment(KEY_ERRORS)

    fun markServiceStarted(now: Long) {
        require(now >= 0L)
        synchronized(lock) {
            preferences.edit()
                .putBoolean(KEY_LISTENER_CONNECTED, false)
                .putLong(KEY_SERVICE_STARTED_AT, now)
                .putLong(KEY_SERVICE_START_COUNT, saturatedIncrement(preferences.getLong(KEY_SERVICE_START_COUNT, 0L)))
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
                        saturatedIncrement(preferences.getLong(KEY_LISTENER_CONNECTION_COUNT, 0L)),
                    )
                }
            } else if (wasConnected) {
                editor.putLong(KEY_LISTENER_DISCONNECTED_AT, now)
            }
            editor.commit()
        }
    }

    fun snapshot(limit: Int = MAX_QUEUE_ENTRIES): HintStoreSnapshot = synchronized(lock) {
        require(limit in 1..MAX_QUEUE_ENTRIES)
        val loaded = loadArray()
        val hints = ArrayList<StoredCompletionHint>(minOf(limit, loaded.array.length()))
        var liveCorruptRecords = if (loaded.corruptContainer) 1L else 0L
        for (index in max(0, loaded.array.length() - limit) until loaded.array.length()) {
            val stored = runCatching { loaded.array.getJSONObject(index).toStoredHint() }.getOrNull()
            if (stored == null) liveCorruptRecords = saturatedAdd(liveCorruptRecords, 1L)
            else hints.add(stored)
        }
        hints.reverse()
        HintStoreSnapshot(
            hints = hints,
            observed = preferences.getLong(KEY_OBSERVED, 0L),
            accepted = preferences.getLong(KEY_ACCEPTED, 0L),
            duplicates = preferences.getLong(KEY_DUPLICATES, 0L),
            dropped = preferences.getLong(KEY_DROPPED, 0L),
            errors = preferences.getLong(KEY_ERRORS, 0L),
            corruptRecords = saturatedAdd(preferences.getLong(KEY_CORRUPT_RECORDS, 0L), liveCorruptRecords),
            lastEventAt = preferences.getLong(KEY_LAST_EVENT_AT, 0L),
            listenerConnected = preferences.getBoolean(KEY_LISTENER_CONNECTED, false),
            listenerConnectedAt = preferences.getLong(KEY_LISTENER_CONNECTED_AT, 0L),
            listenerDisconnectedAt = preferences.getLong(KEY_LISTENER_DISCONNECTED_AT, 0L),
            listenerConnectionCount = preferences.getLong(KEY_LISTENER_CONNECTION_COUNT, 0L),
            serviceStartedAt = preferences.getLong(KEY_SERVICE_STARTED_AT, 0L),
            serviceStartCount = preferences.getLong(KEY_SERVICE_START_COUNT, 0L),
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
                .putLong(key, saturatedIncrement(preferences.getLong(key, 0L)))
                .commit()
        }
    }

    private fun loadArray(): LoadedArray {
        val encoded = preferences.getString(KEY_HINTS, null) ?: return LoadedArray(JSONArray(), false)
        return runCatching { LoadedArray(JSONArray(encoded), false) }
            .getOrElse { LoadedArray(JSONArray(), true) }
    }

    private fun containsRecentExactEvent(array: JSONArray, hint: CompletionHintRecord): Boolean {
        val signature = hint.exactEventSignature()
        val first = max(0, array.length() - MAX_DEDUPE_WINDOW)
        for (index in first until array.length()) {
            val existing = runCatching { array.getJSONObject(index).toStoredHint().hint }.getOrNull() ?: continue
            if (existing.exactEventSignature() == signature) return true
        }
        return false
    }

    companion object {
        const val MAX_QUEUE_ENTRIES = 64
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
        private const val KEY_SERVICE_START_COUNT = "service-start-count"
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

private fun JSONObject.toStoredHint(): StoredCompletionHint = StoredCompletionHint(
    sequence = getLong("sequence"),
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
    ),
)

private fun JSONObject.nullableString(key: String): String? = if (isNull(key)) null else getString(key)

private fun saturatedIncrement(value: Long): Long = if (value == Long.MAX_VALUE) Long.MAX_VALUE else value + 1L

private fun saturatedAdd(left: Long, right: Long): Long {
    if (right <= 0L) return left
    return if (left > Long.MAX_VALUE - right) Long.MAX_VALUE else left + right
}
