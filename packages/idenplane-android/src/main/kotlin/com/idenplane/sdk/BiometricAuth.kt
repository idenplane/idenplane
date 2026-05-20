package com.authme.sdk

import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * Wrapper around [BiometricPrompt] for requiring biometric or device-credential
 * authentication before granting access to sensitive token data.
 *
 * ## Usage
 * ```kotlin
 * val biometric = BiometricAuth(activity)
 * biometric.authenticate(title = "Verify your identity")
 * // Execution continues here only after successful authentication
 * val token = client.getAccessToken()
 * ```
 */
class BiometricAuth(private val activity: FragmentActivity) {

    // -----------------------------------------------------------------------
    // Availability
    // -----------------------------------------------------------------------

    /**
     * Returns `true` if the device supports biometric authentication AND the
     * user has enrolled at least one biometric credential.
     */
    val isBiometricAvailable: Boolean
        get() {
            val manager = BiometricManager.from(activity)
            return manager.canAuthenticate(
                Authenticators.BIOMETRIC_STRONG or Authenticators.BIOMETRIC_WEAK
            ) == BiometricManager.BIOMETRIC_SUCCESS
        }

    /**
     * Returns a human-readable description of the biometric type available,
     * or `null` if biometrics are unavailable.
     */
    fun getBiometricType(context: Context): String? {
        val manager = BiometricManager.from(context)
        return when (manager.canAuthenticate(Authenticators.BIOMETRIC_STRONG)) {
            BiometricManager.BIOMETRIC_SUCCESS -> "Strong biometrics (fingerprint / face / iris)"
            else -> when (manager.canAuthenticate(Authenticators.BIOMETRIC_WEAK)) {
                BiometricManager.BIOMETRIC_SUCCESS -> "Weak biometrics"
                else -> null
            }
        }
    }

    // -----------------------------------------------------------------------
    // Authentication
    // -----------------------------------------------------------------------

    /**
     * Show a biometric prompt and suspend until the user successfully authenticates.
     *
     * Falls back to device credentials (PIN / pattern / password) if biometrics fail
     * and [allowDeviceCredential] is `true`.
     *
     * @param title              Title shown in the biometric dialog.
     * @param subtitle           Optional subtitle shown in the dialog.
     * @param description        Optional description text.
     * @param negativeButtonText Text for the negative/cancel button (only shown
     *                           when [allowDeviceCredential] is `false`).
     * @param allowDeviceCredential Whether to fall back to PIN/pattern/password.
     *
     * @throws [AuthMeException.BiometricAuthFailed] if authentication fails or is cancelled.
     */
    suspend fun authenticate(
        title: String = "Authenticate",
        subtitle: String? = null,
        description: String? = null,
        negativeButtonText: String = "Cancel",
        allowDeviceCredential: Boolean = true,
    ): Unit = suspendCancellableCoroutine { continuation ->

        val executor = ContextCompat.getMainExecutor(activity)

        val callback = object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                if (continuation.isActive) continuation.resume(Unit)
            }

            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                if (continuation.isActive) {
                    continuation.resumeWithException(
                        AuthMeException.BiometricAuthFailed(errString.toString())
                    )
                }
            }

            override fun onAuthenticationFailed() {
                // Called when a biometric is presented but not recognized — the
                // system handles retry automatically; we only fail on error/cancel.
            }
        }

        val prompt = BiometricPrompt(activity, executor, callback)

        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .apply { subtitle?.let { setSubtitle(it) } }
            .apply { description?.let { setDescription(it) } }
            .apply {
                if (allowDeviceCredential) {
                    setAllowedAuthenticators(
                        Authenticators.BIOMETRIC_STRONG
                                or Authenticators.BIOMETRIC_WEAK
                                or Authenticators.DEVICE_CREDENTIAL
                    )
                } else {
                    setAllowedAuthenticators(
                        Authenticators.BIOMETRIC_STRONG or Authenticators.BIOMETRIC_WEAK
                    )
                    setNegativeButtonText(negativeButtonText)
                }
            }
            .build()

        continuation.invokeOnCancellation { prompt.cancelAuthentication() }
        prompt.authenticate(info)
    }
}
