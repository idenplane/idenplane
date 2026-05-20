package com.authme.sdk

import android.util.Base64
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Helpers for generating OAuth 2.0 PKCE parameters (RFC 7636).
 *
 * Generates a cryptographically random code verifier and derives
 * the S256 code challenge via SHA-256.
 */
object PKCEHelper {

    private val secureRandom = SecureRandom()

    // -----------------------------------------------------------------------
    // Code Verifier
    // -----------------------------------------------------------------------

    /**
     * Generate a cryptographically random PKCE code verifier.
     *
     * The verifier is 32 random bytes encoded as Base64URL without padding,
     * producing a 43-character string within the RFC 7636 §4.1 bounds (43–128).
     */
    fun generateCodeVerifier(): String {
        val bytes = ByteArray(32)
        secureRandom.nextBytes(bytes)
        return bytes.base64UrlEncode()
    }

    // -----------------------------------------------------------------------
    // Code Challenge
    // -----------------------------------------------------------------------

    /**
     * Derive the S256 PKCE code challenge from a verifier string.
     *
     * Challenge = BASE64URL(SHA256(ASCII(verifier)))
     */
    fun generateCodeChallenge(verifier: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val hash   = digest.digest(verifier.toByteArray(Charsets.US_ASCII))
        return hash.base64UrlEncode()
    }

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    /**
     * Generate a random state parameter for CSRF protection.
     */
    fun generateState(): String {
        val bytes = ByteArray(16)
        secureRandom.nextBytes(bytes)
        return bytes.base64UrlEncode()
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    private fun ByteArray.base64UrlEncode(): String =
        Base64.encodeToString(this, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
}
