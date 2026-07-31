// SPDX-License-Identifier: MPL-2.0
package dev.elatura.notificationcompanion

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.max

internal data class StoredCompletionHint(
    val sequence: Long,
    val hint: CompletionHintRecord,
)

internal data class HintStoreSnapshot(
    val hints: List<StoredCompletionHint>,
    val accepted: Long,
    val dropped: Long,
    val errors: Long,
    val lastEventAt: Long,
    val listenerConnected: Boolean,
)

internal class LocalHintStore(context: Context) {
    private val preferences: SharedPreferences = context.getSharedPreferences(
        PREFERENCES_NAME,
        Context.MODE_PRIVATE,
    )
    private val lock = Any()

    fun append(hint: CompletionHintRecord): Long = synchronized(lock) {
        val currentSequence = preferences.getLong(KEY_SEQUENCE, 0L)
        val nextSequence = if (currentSequence == Long.MAX_VALUE) 1L else currentSequence + 1L
        val array = loadArray()
        array.put(hint.toJson(nextSequence))
        while (array.length() > MAX_QUEUE_ENTRIES) {
            array.remove(0)
        }

        val accepted = preferences.getLong(KEY_ACCEPTED, 0L) + 1L
        val committed = preferences.edit()
            .putString(KEY_HINTS, array.toString())
            .putLong(KEY_SEQUENCE, nextSequence)
            .putLong(KEY_ACCEPTED, accepted)
            .putLong(KEY_LAST_EVENT_AT, hint.observedAt)
            .commit()
        check(committed) { "Unable to commit the bounded completion hint" }
        nextSequence
    }

    fun recordDropped() = increment(KEY_DROPPED)

    fun recordError() = increment(KEY_ERRORS)

    fun setListenerConnected(connected: Boolean) {
        synchronized(lock) {
            preferences.edit().putBoolean(KEY_LISTENER_CONNECTED, connected).apply()
        }
    }

    fun snapshot(limit: Int = 20): HintStoreSnapshot = synchronized(lock) {
        require(limit in 1..MAX_QUEUE_ENTRIES)
        val array = loadArray()
        val hints = ArrayList<StoredCompletionHint>(minOf(limit, array.length()))
        for (index in max(0, array.length() - limit) until array.length()) {
            runCatching { hints.add(array.getJSONObject(index).toStoredHint()) }
        }
        hints.reverse()
        HintStoreSnapshot(
            hints = hints,
            accepted = preferences.getLong(KEY_ACCEPTED, 0L),
            dropped = preferences.getLong(KEY_DROPPED, 0L),
            errors = preferences.getLong(KEY_ERRORS, 0L),
            lastEventAt = preferences.getLong(KEY_LAST_EVENT_AT, 0L),
            listenerConnected = preferences.getBoolean(KEY_LISTENER_CONNECTED, false),
        )
    }

    fun clearHints() {
        synchronized(lock) {
            preferences.edit()
                .remove(KEY_HINTS)
                .remove(KEY_SEQUENCE)
                .remove(KEY_ACCEPTED)
                .remove(KEY_DROPPED)
                .remove(KEY_ERRORS)
                .remove(KEY_LAST_EVENT_AT)
                .commit()
        }
    }

    fun clearAll() {
        synchronized(lock) {
            preferences.edit().clear().commit()
        }
    }

    private fun increment(key: String) {
        synchronized(lock) {
            preferences.edit().putLong(key, preferences.getLong(key, 0L) + 1L).apply()
        }
    }

    private fun loadArray(): JSONArray {
        val encoded = preferences.getString(KEY_HINTS, null) ?: return JSONArray()
        return runCatching { JSONArray(encoded) }.getOrElse { JSONArray() }
    }

    companion object {
        const val MAX_QUEUE_ENTRIES = 64
        private const val PREFERENCES_NAME = "completion-hints-v1"
        private const val KEY_HINTS = "hints"
        private const val KEY_SEQUENCE = "sequence"
        private const val KEY_ACCEPTED = "accepted"
        private const val KEY_DROPPED = "dropped"
        private const val KEY_ERRORS = "errors"
        private const val KEY_LAST_EVENT_AT = "last-event-at"
        private const val KEY_LISTENER_CONNECTED = "listener-connected"
    }
}

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
