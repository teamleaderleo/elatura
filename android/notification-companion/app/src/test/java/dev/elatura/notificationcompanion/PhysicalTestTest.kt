// SPDX-License-Identifier: MPL-2.0
package dev.elatura.notificationcompanion

import org.junit.Assert.assertEquals
import org.junit.Test

class PhysicalTestTest {
    @Test
    fun appliesAndUndoesOneAtomicCase() {
        val testCase = VerifiedTestCase(
            recordedAt = 1_000L,
            notificationArrived = true,
            deepLinkResult = DeepLinkResult.FAILED,
        )
        val applied = PhysicalTestTally.EMPTY.apply(testCase)

        assertEquals(1L, applied.completedCases)
        assertEquals(1L, applied.notificationArrived)
        assertEquals(1L, applied.deepLinkFailed)
        assertEquals(PhysicalTestTally.EMPTY, applied.undo(testCase))
    }

    @Test
    fun keepsReceivedMissedAndUntestedOutcomesSeparate() {
        val cases = listOf(
            VerifiedTestCase(1_000L, true, DeepLinkResult.CORRECT),
            VerifiedTestCase(2_000L, true, DeepLinkResult.FAILED),
            VerifiedTestCase(3_000L, true, DeepLinkResult.NOT_TESTED),
            VerifiedTestCase(4_000L, false, null),
        )
        val tally = cases.fold(PhysicalTestTally.EMPTY, PhysicalTestTally::apply)

        assertEquals(4L, tally.completedCases)
        assertEquals(3L, tally.notificationArrived)
        assertEquals(1L, tally.notificationMissed)
        assertEquals(1L, tally.deepLinkCorrect)
        assertEquals(1L, tally.deepLinkFailed)
        assertEquals(1L, tally.deepLinkNotTested)
    }
}
