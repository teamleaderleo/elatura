// SPDX-License-Identifier: MPL-2.0
package dev.elatura.notificationcompanion

internal enum class DeepLinkResult(val wireValue: String) {
    CORRECT("correct"),
    FAILED("failed"),
    NOT_TESTED("not-tested"),
}

internal data class VerifiedTestCase(
    val recordedAt: Long,
    val notificationArrived: Boolean,
    val deepLinkResult: DeepLinkResult?,
) {
    init {
        require(recordedAt >= 0L) { "recordedAt must be non-negative" }
        require(notificationArrived == (deepLinkResult != null)) {
            "A received notification requires exactly one deep-link result"
        }
    }
}

internal data class PhysicalTestTally(
    val completedCases: Long,
    val notificationArrived: Long,
    val notificationMissed: Long,
    val deepLinkCorrect: Long,
    val deepLinkFailed: Long,
    val deepLinkNotTested: Long,
) {
    init {
        require(completedCases >= 0L)
        require(notificationArrived >= 0L)
        require(notificationMissed >= 0L)
        require(deepLinkCorrect >= 0L)
        require(deepLinkFailed >= 0L)
        require(deepLinkNotTested >= 0L)
    }

    fun apply(testCase: VerifiedTestCase): PhysicalTestTally = copy(
        completedCases = saturatedIncrement(completedCases),
        notificationArrived = if (testCase.notificationArrived) {
            saturatedIncrement(notificationArrived)
        } else {
            notificationArrived
        },
        notificationMissed = if (testCase.notificationArrived) {
            notificationMissed
        } else {
            saturatedIncrement(notificationMissed)
        },
        deepLinkCorrect = if (testCase.deepLinkResult == DeepLinkResult.CORRECT) {
            saturatedIncrement(deepLinkCorrect)
        } else {
            deepLinkCorrect
        },
        deepLinkFailed = if (testCase.deepLinkResult == DeepLinkResult.FAILED) {
            saturatedIncrement(deepLinkFailed)
        } else {
            deepLinkFailed
        },
        deepLinkNotTested = if (testCase.deepLinkResult == DeepLinkResult.NOT_TESTED) {
            saturatedIncrement(deepLinkNotTested)
        } else {
            deepLinkNotTested
        },
    )

    fun undo(testCase: VerifiedTestCase): PhysicalTestTally = copy(
        completedCases = decrement(completedCases),
        notificationArrived = if (testCase.notificationArrived) decrement(notificationArrived) else notificationArrived,
        notificationMissed = if (testCase.notificationArrived) notificationMissed else decrement(notificationMissed),
        deepLinkCorrect = if (testCase.deepLinkResult == DeepLinkResult.CORRECT) {
            decrement(deepLinkCorrect)
        } else {
            deepLinkCorrect
        },
        deepLinkFailed = if (testCase.deepLinkResult == DeepLinkResult.FAILED) {
            decrement(deepLinkFailed)
        } else {
            deepLinkFailed
        },
        deepLinkNotTested = if (testCase.deepLinkResult == DeepLinkResult.NOT_TESTED) {
            decrement(deepLinkNotTested)
        } else {
            deepLinkNotTested
        },
    )

    companion object {
        val EMPTY = PhysicalTestTally(
            completedCases = 0L,
            notificationArrived = 0L,
            notificationMissed = 0L,
            deepLinkCorrect = 0L,
            deepLinkFailed = 0L,
            deepLinkNotTested = 0L,
        )
    }
}

private fun saturatedIncrement(value: Long): Long = if (value == Long.MAX_VALUE) Long.MAX_VALUE else value + 1L

private fun decrement(value: Long): Long = if (value <= 0L) 0L else value - 1L
