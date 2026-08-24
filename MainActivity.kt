package com.ncoderpro.foodwrapped

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import androidx.appcompat.app.AppCompatActivity
import com.google.firebase.ktx.Firebase
import com.google.firebase.remoteconfig.FirebaseRemoteConfig
import com.google.firebase.remoteconfig.ktx.remoteConfig
import com.google.firebase.remoteconfig.ktx.remoteConfigSettings

class MainActivity : AppCompatActivity() {

    private lateinit var remoteConfig: FirebaseRemoteConfig

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        setupRemoteConfig()
        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun setupRemoteConfig() {
        remoteConfig = Firebase.remoteConfig
        val configSettings = remoteConfigSettings {
            minimumFetchIntervalInSeconds = 3600
        }
        remoteConfig.setConfigSettingsAsync(configSettings)

        // Set default values
        val defaults = mapOf(
            "referral_reward_amount" to 5,
            "is_referral_active" to false
        )
        remoteConfig.setDefaultsAsync(defaults)

        // Fetch and activate
        remoteConfig.fetchAndActivate()
            .addOnCompleteListener(this) { task ->
                if (task.isSuccessful) {
                    val updated = task.result
                    Log.d(TAG, "Config params updated: $updated")
                } else {
                    Log.d(TAG, "Config fetch failed")
                }
            }
    }

    /**
     * Helper functions to get Remote Config values for the UI
     */
    fun getReferralRewardAmount(): Long {
        return remoteConfig.getLong("referral_reward_amount")
    }

    fun isReferralActive(): Boolean {
        return remoteConfig.getBoolean("is_referral_active")
    }

    private fun handleIntent(intent: Intent?) {
        val appLinkAction: String? = intent?.action
        val appLinkData: Uri? = intent?.data

        if (Intent.ACTION_VIEW == appLinkAction && appLinkData != null) {
            // Expected URL: https://gobbl-501919.web.app/invite?code=123
            val referralCode = appLinkData.getQueryParameter("code")
            if (referralCode != null) {
                Log.d(TAG, "Referral code received: $referralCode")
                // TODO: Track the referral or save it to preferences/database
                onReferralCodeReceived(referralCode)
            }
        }
    }

    private fun onReferralCodeReceived(code: String) {
        // Implement your logic to handle the referral code
        // e.g., Show a welcome dialog or save to user profile
    }

    companion object {
        private const val TAG = "MainActivity"
    }
}
