package com.authme.sdk

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Secure token storage backed by [EncryptedSharedPreferences].
 *
 * All tokens are AES-256-GCM encrypted at rest using a key stored in the
 * Android Keystore. The preference file is scoped to the realm + clientId
 * combination so multiple AuthMe realms can coexist without key collisions.
 */
internal class TokenStorage(context: Context, realm: String, clientId: String) {

    // -----------------------------------------------------------------------
    // Keys
    // -----------------------------------------------------------------------

    private object Key {
        const val ACCESS_TOKEN  = "access_token"
        const val REFRESH_TOKEN = "refresh_token"
        const val ID_TOKEN      = "id_token"
        const val PKCE_VERIFIER = "pkce_verifier"
        const val AUTH_STATE    = "auth_state"
    }

    // -----------------------------------------------------------------------
    // Encrypted prefs
    // -----------------------------------------------------------------------

    private val prefs: SharedPreferences

    init {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()

        val fileName = "authme_${realm}_${clientId}".replace(Regex("[^a-zA-Z0-9_]"), "_")

        prefs = EncryptedSharedPreferences.create(
            context,
            fileName,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    // -----------------------------------------------------------------------
    // Accessors
    // -----------------------------------------------------------------------

    var accessToken: String?
        get() = prefs.getString(Key.ACCESS_TOKEN, null)
        set(value) = put(Key.ACCESS_TOKEN, value)

    var refreshToken: String?
        get() = prefs.getString(Key.REFRESH_TOKEN, null)
        set(value) = put(Key.REFRESH_TOKEN, value)

    var idToken: String?
        get() = prefs.getString(Key.ID_TOKEN, null)
        set(value) = put(Key.ID_TOKEN, value)

    var pkceVerifier: String?
        get() = prefs.getString(Key.PKCE_VERIFIER, null)
        set(value) = put(Key.PKCE_VERIFIER, value)

    var authState: String?
        get() = prefs.getString(Key.AUTH_STATE, null)
        set(value) = put(Key.AUTH_STATE, value)

    // -----------------------------------------------------------------------
    // Bulk operations
    // -----------------------------------------------------------------------

    /** Store a full token response atomically. */
    fun store(tokens: TokenResponse) {
        // Bug #438-6 fix: the previous code mixed SharedPreferences.Editor chaining with
        // Kotlin's `apply` scope-function — the trailing `.apply()` was calling the Kotlin
        // extension on whatever `Unit` the last lambda returned, NOT committing the editor.
        // This meant only the first `.putString` was ever persisted.
        // Fix: build the editor explicitly and call the Editor's own `apply()` at the end.
        val editor = prefs.edit()
            .putString(Key.ACCESS_TOKEN, tokens.accessToken)
        if (tokens.refreshToken != null) {
            editor.putString(Key.REFRESH_TOKEN, tokens.refreshToken)
        }
        if (tokens.idToken != null) {
            editor.putString(Key.ID_TOKEN, tokens.idToken)
        }
        editor.apply()
    }

    /** Remove all stored tokens and PKCE state. */
    fun clear() {
        prefs.edit().clear().apply()
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    private fun put(key: String, value: String?) {
        if (value == null) {
            prefs.edit().remove(key).apply()
        } else {
            prefs.edit().putString(key, value).apply()
        }
    }
}
