// SPDX-License-Identifier: MPL-2.0
package dev.elatura.notificationcompanion

import android.app.Activity
import android.content.Intent
import android.os.Bundle

class EntryActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val manualState = SetupStateStore(applicationContext).snapshot()
        if (manualState.hasOpenedGuide) {
            openDashboard()
        } else {
            @Suppress("DEPRECATION")
            startActivityForResult(
                Intent(this, SetupGuideActivity::class.java),
                REQUEST_SETUP,
            )
        }
    }

    @Deprecated("Deprecated in Android")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_SETUP) openDashboard()
    }

    private fun openDashboard() {
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }

    companion object {
        private const val REQUEST_SETUP = 1001
    }
}
