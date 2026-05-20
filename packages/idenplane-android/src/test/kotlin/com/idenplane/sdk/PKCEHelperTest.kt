package com.authme.sdk

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64

class PKCEHelperTest {

    @Test
    fun `code verifier length is within RFC 7636 bounds`() {
        val verifier = PKCEHelper.generateCodeVerifier()
        // RFC 7636 §4.1: 43–128 unreserved characters
        assertTrue(
            "Verifier length ${verifier.length} out of bounds [43, 128]",
            verifier.length in 43..128
        )
    }

    @Test
    fun `code verifier uses only Base64URL characters`() {
        val verifier = PKCEHelper.generateCodeVerifier()
        val allowed  = Regex("^[A-Za-z0-9\\-_]+$")
        assertTrue("Verifier contains invalid characters: $verifier", allowed.matches(verifier))
    }

    @Test
    fun `code verifier has no padding`() {
        val verifier = PKCEHelper.generateCodeVerifier()
        assertFalse("Verifier must not contain '='", verifier.contains("="))
    }

    @Test
    fun `code verifiers are unique`() {
        val v1 = PKCEHelper.generateCodeVerifier()
        val v2 = PKCEHelper.generateCodeVerifier()
        assertNotEquals("Two verifiers should not be identical", v1, v2)
    }

    @Test
    fun `code challenge is Base64URL without padding`() {
        val verifier  = PKCEHelper.generateCodeVerifier()
        val challenge = PKCEHelper.generateCodeChallenge(verifier)
        val allowed   = Regex("^[A-Za-z0-9\\-_]+$")
        assertTrue("Challenge contains invalid characters: $challenge", allowed.matches(challenge))
        assertFalse("Challenge must not contain '='", challenge.contains("="))
    }

    /**
     * RFC 7636 §B appendix test vector:
     * verifier  = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
     * challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
     */
    @Test
    fun `code challenge matches RFC 7636 test vector`() {
        val verifier  = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        val challenge = PKCEHelper.generateCodeChallenge(verifier)
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", challenge)
    }

    @Test
    fun `state values are unique`() {
        val s1 = PKCEHelper.generateState()
        val s2 = PKCEHelper.generateState()
        assertNotEquals(s1, s2)
    }
}
