package com.idenplane.sdk

import android.content.Context
import android.content.Intent
import android.net.Uri
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import java.util.Base64

/**
 * Exercises [IdenplaneClient] against a real local HTTP server ([TestOidcServer]) and a real
 * (Robolectric-backed) [TokenStorage], via the internal test-only constructor — so this covers
 * actual discovery caching, JSON parsing, and HTTP error handling, not a mock of them.
 *
 * [IdenplaneClient.login] is not covered here: it launches a real Chrome Custom Tab against a
 * [androidx.fragment.app.FragmentActivity], which needs a real device/emulator instrumentation
 * test, not a JVM unit test.
 */
@RunWith(RobolectricTestRunner::class)
class IdenplaneClientTest {

    private lateinit var server: TestOidcServer
    private lateinit var client: IdenplaneClient
    private lateinit var storage: TokenStorage
    private val redirectUri = "com.example.app://callback"

    @Before
    fun setUp() {
        server = TestOidcServer()
        val prefs = RuntimeEnvironment.getApplication()
            .getSharedPreferences("client-test-prefs", Context.MODE_PRIVATE)
        storage = TokenStorage(prefs)
        val config = AuthConfig(
            serverUrl = server.baseUrl,
            realm = server.realm,
            clientId = "test-client",
            redirectUri = redirectUri,
            autoRefresh = false,
        )
        client = IdenplaneClient(RuntimeEnvironment.getApplication(), config, storage)
    }

    @After
    fun tearDown() {
        server.close()
    }

    // -------------------------------------------------------------------
    // isAuthenticated / getAccessToken
    // -------------------------------------------------------------------

    @Test
    fun `isAuthenticated is false when no token is stored`() {
        assertFalse(client.isAuthenticated)
    }

    @Test
    fun `isAuthenticated is true for a non-expired token`() {
        storage.accessToken = fakeJwt(expiresInSeconds = 300)
        assertTrue(client.isAuthenticated)
    }

    @Test
    fun `isAuthenticated is false for an expired token`() {
        storage.accessToken = fakeJwt(expiresInSeconds = -300)
        assertFalse(client.isAuthenticated)
    }

    @Test
    fun `getAccessToken returns null when nothing is stored`() {
        assertNull(client.getAccessToken())
    }

    @Test
    fun `getAccessToken returns null for an expired token`() {
        storage.accessToken = fakeJwt(expiresInSeconds = -300)
        assertNull(client.getAccessToken())
    }

    @Test
    fun `getAccessToken returns the token when valid`() {
        val token = fakeJwt(expiresInSeconds = 300)
        storage.accessToken = token
        assertEquals(token, client.getAccessToken())
    }

    // -------------------------------------------------------------------
    // handleRedirectIntent
    // -------------------------------------------------------------------

    @Test
    fun `handleRedirectIntent returns false for an intent with no data`() = runTest {
        assertFalse(client.handleRedirectIntent(Intent()))
    }

    @Test
    fun `handleRedirectIntent returns false for a URI that does not match the redirect base`() = runTest {
        val intent = Intent().apply {
            data = Uri.parse("com.example.app://callback.evil.com?code=abc&state=xyz")
        }
        assertFalse(client.handleRedirectIntent(intent))
    }

    @Test
    fun `handleRedirectIntent throws CallbackError when the callback carries an error`() = runTest {
        val intent = Intent().apply {
            data = Uri.parse("$redirectUri?error=access_denied&error_description=User+cancelled")
        }
        try {
            client.handleRedirectIntent(intent)
            fail("Expected CallbackError")
        } catch (e: IdenplaneException.CallbackError) {
            assertEquals("User cancelled", e.message)
        }
    }

    @Test
    fun `handleRedirectIntent throws CallbackError when the authorization code is missing`() = runTest {
        val intent = Intent().apply { data = Uri.parse("$redirectUri?state=xyz") }
        try {
            client.handleRedirectIntent(intent)
            fail("Expected CallbackError")
        } catch (e: IdenplaneException.CallbackError) {
            assertTrue(e.message!!.contains("Missing authorization code"))
        }
    }

    @Test
    fun `handleRedirectIntent throws StateMismatch when the returned state does not match`() = runTest {
        storage.authState = "expected-state"
        storage.pkceVerifier = "verifier"
        val intent = Intent().apply { data = Uri.parse("$redirectUri?code=abc&state=wrong-state") }

        try {
            client.handleRedirectIntent(intent)
            fail("Expected StateMismatch")
        } catch (e: IdenplaneException.StateMismatch) {
            // expected
        }
    }

    @Test
    fun `handleRedirectIntent throws PkceVerifierMissing when no verifier was stored`() = runTest {
        storage.authState = "expected-state"
        val intent = Intent().apply { data = Uri.parse("$redirectUri?code=abc&state=expected-state") }

        try {
            client.handleRedirectIntent(intent)
            fail("Expected PkceVerifierMissing")
        } catch (e: IdenplaneException.PkceVerifierMissing) {
            // expected
        }
    }

    @Test
    fun `handleRedirectIntent exchanges the code and stores tokens on success`() = runTest {
        storage.authState = "expected-state"
        storage.pkceVerifier = "verifier-123"
        server.tokenBody = """{"access_token":"at-new","token_type":"Bearer","expires_in":300,"refresh_token":"rt-new"}"""
        val intent = Intent().apply { data = Uri.parse("$redirectUri?code=auth-code-1&state=expected-state") }

        val handled = client.handleRedirectIntent(intent)

        assertTrue(handled)
        assertEquals("at-new", storage.accessToken)
        assertEquals("rt-new", storage.refreshToken)
        assertNull("PKCE verifier must be cleared after use", storage.pkceVerifier)
        assertNull("Auth state must be cleared after use", storage.authState)
        val requestBody = server.tokenRequestBodies.single()
        assertTrue(requestBody.contains("code=auth-code-1"))
        assertTrue(requestBody.contains("code_verifier=verifier-123"))
        assertTrue(requestBody.contains("grant_type=authorization_code"))
    }

    // -------------------------------------------------------------------
    // refreshToken
    // -------------------------------------------------------------------

    @Test
    fun `refreshToken throws NoRefreshToken when nothing is stored`() = runTest {
        try {
            client.refreshToken()
            fail("Expected NoRefreshToken")
        } catch (e: IdenplaneException.NoRefreshToken) {
            // expected
        }
    }

    @Test
    fun `refreshToken stores the new tokens on success`() = runTest {
        storage.refreshToken = "old-refresh-token"
        server.tokenBody = """{"access_token":"at-refreshed","token_type":"Bearer","expires_in":300}"""

        client.refreshToken()

        assertEquals("at-refreshed", storage.accessToken)
        assertTrue(server.tokenRequestBodies.single().contains("grant_type=refresh_token"))
    }

    @Test
    fun `refreshToken clears storage when the server rejects with invalid_grant`() = runTest {
        storage.accessToken = "stale-access-token"
        storage.refreshToken = "revoked-refresh-token"
        server.tokenStatus = 400
        server.tokenBody = """{"error":"invalid_grant","error_description":"Token is not active"}"""

        try {
            client.refreshToken()
            fail("Expected ServerError")
        } catch (e: IdenplaneException.ServerError) {
            // expected
        }

        assertNull("Access token must be cleared after a definitive 4xx rejection", storage.accessToken)
        assertNull("Refresh token must be cleared after a definitive 4xx rejection", storage.refreshToken)
    }

    @Test
    fun `refreshToken preserves storage on a 5xx server error`() = runTest {
        storage.accessToken = "still-valid-access-token"
        storage.refreshToken = "still-valid-refresh-token"
        server.tokenStatus = 500
        server.tokenBody = """{"error":"internal_error"}"""

        try {
            client.refreshToken()
            fail("Expected ServerError")
        } catch (e: IdenplaneException.ServerError) {
            // expected
        }

        assertEquals(
            "A transient 5xx must not clear tokens that may still be valid",
            "still-valid-access-token", storage.accessToken,
        )
        assertEquals("still-valid-refresh-token", storage.refreshToken)
    }

    // -------------------------------------------------------------------
    // getUserInfo
    // -------------------------------------------------------------------

    @Test
    fun `getUserInfo throws NotAuthenticated without a valid access token`() = runTest {
        try {
            client.getUserInfo()
            fail("Expected NotAuthenticated")
        } catch (e: IdenplaneException.NotAuthenticated) {
            // expected
        }
    }

    @Test
    fun `getUserInfo sends the bearer token and parses the response`() = runTest {
        storage.accessToken = fakeJwt(expiresInSeconds = 300)
        server.userInfoBody = """{"sub":"user-42","preferred_username":"ada","email":"ada@example.com"}"""

        val user = client.getUserInfo()

        assertEquals("user-42", user.sub)
        assertEquals("ada", user.preferredUsername)
        assertEquals("ada@example.com", user.email)
        assertNotNull(server.lastUserInfoAuthHeader)
        assertTrue(server.lastUserInfoAuthHeader!!.startsWith("Bearer "))
    }

    // -------------------------------------------------------------------
    // logout
    // -------------------------------------------------------------------

    @Test
    fun `logout clears storage even with no refresh token`() = runTest {
        storage.accessToken = fakeJwt(expiresInSeconds = 300)

        client.logout()

        assertNull(storage.accessToken)
    }

    @Test
    fun `logout clears storage after notifying the end-session endpoint`() = runTest {
        storage.accessToken = fakeJwt(expiresInSeconds = 300)
        storage.refreshToken = "rt-to-revoke"

        client.logout()

        assertNull(storage.accessToken)
        assertNull(storage.refreshToken)
    }

    // -------------------------------------------------------------------
    // Discovery caching
    // -------------------------------------------------------------------

    @Test
    fun `discovery document is fetched once and cached across calls`() = runTest {
        storage.accessToken = fakeJwt(expiresInSeconds = 300)
        server.userInfoBody = """{"sub":"user-1"}"""

        client.getUserInfo()
        client.getUserInfo()

        assertEquals(1, server.discoveryHitCount)
    }

    // -------------------------------------------------------------------
    // Test helpers
    // -------------------------------------------------------------------

    /** Builds an unsigned JWT with only an `exp` claim — IdenplaneClient never verifies signatures locally. */
    private fun fakeJwt(expiresInSeconds: Long): String {
        val header = base64Url("""{"alg":"none","typ":"JWT"}""")
        val exp = System.currentTimeMillis() / 1000L + expiresInSeconds
        val payload = base64Url(JSONObject().put("exp", exp).toString())
        return "$header.$payload.sig"
    }

    private fun base64Url(json: String): String =
        Base64.getUrlEncoder().withoutPadding().encodeToString(json.toByteArray(Charsets.UTF_8))
}
