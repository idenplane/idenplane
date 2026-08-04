package com.idenplane.sdk

import android.content.Context
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

// TokenStorage's real constructor builds an AndroidKeyStore-backed EncryptedSharedPreferences,
// which has no Robolectric shadow and cannot run in a plain JVM unit test (only a real
// device/emulator instrumentation test can exercise that path). These tests use the
// SharedPreferences-accepting constructor directly to exercise TokenStorage's own
// field-mapping/store()/clear() logic — the part this SDK owns — against a real
// Robolectric-backed SharedPreferences instead.
@RunWith(RobolectricTestRunner::class)
class TokenStorageTest {

    private lateinit var storage: TokenStorage

    @Before
    fun setUp() {
        val prefs = RuntimeEnvironment.getApplication()
            .getSharedPreferences("test-prefs", Context.MODE_PRIVATE)
        storage = TokenStorage(prefs)
    }

    @Test
    fun `individual fields round trip through the store`() {
        storage.accessToken = "at-1"
        storage.refreshToken = "rt-1"
        storage.idToken = "idt-1"
        storage.pkceVerifier = "verifier-1"
        storage.authState = "state-1"

        assertEquals("at-1", storage.accessToken)
        assertEquals("rt-1", storage.refreshToken)
        assertEquals("idt-1", storage.idToken)
        assertEquals("verifier-1", storage.pkceVerifier)
        assertEquals("state-1", storage.authState)
    }

    @Test
    fun `setting a field to null removes it`() {
        storage.accessToken = "at-1"
        storage.accessToken = null

        assertNull(storage.accessToken)
    }

    @Test
    fun `fields are absent before anything is stored`() {
        assertNull(storage.accessToken)
        assertNull(storage.refreshToken)
        assertNull(storage.idToken)
        assertNull(storage.pkceVerifier)
        assertNull(storage.authState)
    }

    @Test
    fun `store persists all three token fields from a token response`() {
        // Regression test for bug #438-6: a previous version mixed Editor chaining with
        // Kotlin's `apply` scope function, so only the first putString ever actually committed.
        // Assert all three fields independently so a regression to that bug fails here again.
        storage.store(
            TokenResponse(
                accessToken = "at-2", tokenType = "Bearer", expiresIn = 300,
                refreshToken = "rt-2", idToken = "idt-2",
            )
        )

        assertEquals("at-2", storage.accessToken)
        assertEquals("rt-2", storage.refreshToken)
        assertEquals("idt-2", storage.idToken)
    }

    @Test
    fun `store does not clear refresh or id token when absent from the response`() {
        storage.refreshToken = "stale-rt"
        storage.idToken = "stale-idt"

        // A refresh response commonly omits refresh_token/id_token (no rotation) — that must
        // not erase the ones already on file.
        storage.store(TokenResponse(accessToken = "at-3", tokenType = "Bearer", expiresIn = 300))

        assertEquals("at-3", storage.accessToken)
        assertEquals("stale-rt", storage.refreshToken)
        assertEquals("stale-idt", storage.idToken)
    }

    @Test
    fun `clear removes everything`() {
        storage.accessToken = "at-4"
        storage.refreshToken = "rt-4"
        storage.pkceVerifier = "verifier-4"
        storage.authState = "state-4"

        storage.clear()

        assertNull(storage.accessToken)
        assertNull(storage.refreshToken)
        assertNull(storage.idToken)
        assertNull(storage.pkceVerifier)
        assertNull(storage.authState)
    }

    @Test
    fun `preferences file name is scoped to realm and clientId`() {
        val name1 = TokenStorage.preferencesFileName("realm-a", "client-1")
        val name2 = TokenStorage.preferencesFileName("realm-b", "client-1")
        val name3 = TokenStorage.preferencesFileName("realm-a", "client-2")

        assertNotEquals("Different realms must not share a file", name1, name2)
        assertNotEquals("Different clientIds must not share a file", name1, name3)
    }

    @Test
    fun `preferences file name strips characters unsafe for a filename`() {
        val name = TokenStorage.preferencesFileName("realm/with spaces", "client:id")

        assertEquals("idenplane_realm_with_spaces_client_id", name)
    }
}
