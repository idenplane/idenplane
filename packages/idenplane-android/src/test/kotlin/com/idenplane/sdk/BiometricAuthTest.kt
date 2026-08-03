package com.idenplane.sdk

import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators
import androidx.fragment.app.FragmentActivity
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.kotlin.doReturn
import org.mockito.kotlin.mock
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner

/**
 * [BiometricAuth.authenticate] shows a real [androidx.biometric.BiometricPrompt] dialog and
 * suspends until the *user* interacts with it — there is no Robolectric shadow that can drive
 * that callback the way a real device/emulator instrumentation test could, so it isn't covered
 * here. What's covered is everything synchronous: availability checks (via a mocked
 * [BiometricManager], since Robolectric has no shadow for it either) and the biometric-type
 * description mapping (extracted into a pure function so it needs no BiometricManager at all).
 */
@RunWith(RobolectricTestRunner::class)
class BiometricAuthTest {

    private val activity: FragmentActivity =
        Robolectric.buildActivity(FragmentActivity::class.java).setup().get()

    @Test
    fun `isBiometricAvailable is true when the manager reports success`() {
        val manager = mock<BiometricManager> {
            on { canAuthenticate(Authenticators.BIOMETRIC_STRONG or Authenticators.BIOMETRIC_WEAK) } doReturn
                BiometricManager.BIOMETRIC_SUCCESS
        }

        assertTrue(BiometricAuth(activity, manager).isBiometricAvailable)
    }

    @Test
    fun `isBiometricAvailable is false when no biometric hardware is available`() {
        val manager = mock<BiometricManager> {
            on { canAuthenticate(Authenticators.BIOMETRIC_STRONG or Authenticators.BIOMETRIC_WEAK) } doReturn
                BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE
        }

        assertFalse(BiometricAuth(activity, manager).isBiometricAvailable)
    }

    @Test
    fun `isBiometricAvailable is false when hardware exists but nothing is enrolled`() {
        val manager = mock<BiometricManager> {
            on { canAuthenticate(Authenticators.BIOMETRIC_STRONG or Authenticators.BIOMETRIC_WEAK) } doReturn
                BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED
        }

        assertFalse(BiometricAuth(activity, manager).isBiometricAvailable)
    }

    @Test
    fun `describeBiometricType prefers strong over weak`() {
        val description = BiometricAuth.describeBiometricType(
            strongResult = BiometricManager.BIOMETRIC_SUCCESS,
            weakResult = BiometricManager.BIOMETRIC_SUCCESS,
        )

        assertTrue(description!!.contains("Strong", ignoreCase = true))
    }

    @Test
    fun `describeBiometricType falls back to weak when strong is unavailable`() {
        val description = BiometricAuth.describeBiometricType(
            strongResult = BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE,
            weakResult = BiometricManager.BIOMETRIC_SUCCESS,
        )

        assertTrue(description!!.contains("Weak", ignoreCase = true))
    }

    @Test
    fun `describeBiometricType is null when neither is available`() {
        val description = BiometricAuth.describeBiometricType(
            strongResult = BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE,
            weakResult = BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE,
        )

        assertNull(description)
    }
}
