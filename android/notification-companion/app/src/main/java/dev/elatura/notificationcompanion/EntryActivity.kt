// SPDX-License-Identifier: MPL-2.0
package dev.elatura.notificationcompanion

import android.app.Activity
import android.content.Intent
import android.os.Bundle

class EntryActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val manualState = SetupStateStore(applicationContext).snapshot()
        val destination = if (manualState.hasOpenedGuide) {
            SignalInboxActivity::class.java
        } else {
            SetupGuideActivity::class.java
        }
        startActivity(Intent(this, destination))
        finish()
    }
}
