package com.idenplane.sdk

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// ---------------------------------------------------------------------------
// AuthConfig
// ---------------------------------------------------------------------------

/**
 * Configuration for creating an [IdenplaneClient] instance.
 *
 * @param serverUrl   Base URL of the Idenplane server, e.g. "https://auth.example.com"
 * @param realm       Realm name to authenticate against
 * @param clientId    OAuth 2.0 client ID (must be a PUBLIC client in Idenplane)
 * @param redirectUri Custom scheme redirect URI, e.g. "com.example.app://callback"
 * @param scopes      OAuth 2.0 scopes to request (default: openid, profile, email)
 * @param autoRefresh Automatically refresh tokens before expiry (default: true)
 * @param refreshBuffer Seconds before expiry at which to trigger a refresh (default: 30)
 */
data class AuthConfig(
    val serverUrl: String,
    val realm: String,
    val clientId: String,
    val redirectUri: String,
    val scopes: List<String> = listOf("openid", "profile", "email"),
    val autoRefresh: Boolean = true,
    val refreshBuffer: Int = 30,
) {
    /** The OIDC discovery URL for this realm. */
    val discoveryUrl: String
        get() = "${serverUrl.trimEnd('/')}/realms/$realm/.well-known/openid-configuration"
}

// ---------------------------------------------------------------------------
// TokenResponse
// ---------------------------------------------------------------------------

/** Raw token response from the token endpoint. */
@Serializable
data class TokenResponse(
    @SerialName("access_token")  val accessToken: String,
    @SerialName("token_type")    val tokenType: String,
    @SerialName("expires_in")    val expiresIn: Int,
    @SerialName("refresh_token") val refreshToken: String? = null,
    @SerialName("id_token")      val idToken: String? = null,
    @SerialName("scope")         val scope: String? = null,
)

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

/** User information returned by the userinfo endpoint. */
@Serializable
data class User(
    val sub: String,
    @SerialName("preferred_username") val preferredUsername: String? = null,
    val name: String? = null,
    @SerialName("given_name")    val givenName: String? = null,
    @SerialName("family_name")   val familyName: String? = null,
    val email: String? = null,
    @SerialName("email_verified") val emailVerified: Boolean? = null,
)

// ---------------------------------------------------------------------------
// OIDCConfiguration (internal)
// ---------------------------------------------------------------------------

@Serializable
internal data class OIDCConfiguration(
    val issuer: String,
    @SerialName("authorization_endpoint") val authorizationEndpoint: String,
    @SerialName("token_endpoint")         val tokenEndpoint: String,
    @SerialName("userinfo_endpoint")      val userinfoEndpoint: String,
    @SerialName("jwks_uri")               val jwksUri: String,
    @SerialName("end_session_endpoint")   val endSessionEndpoint: String? = null,
)

// ---------------------------------------------------------------------------
// IdenplaneException
// ---------------------------------------------------------------------------

/** Sealed hierarchy of exceptions thrown by the Idenplane Android SDK. */
sealed class IdenplaneException(message: String, cause: Throwable? = null) :
    Exception(message, cause) {

    /** User is not currently authenticated. */
    class NotAuthenticated : IdenplaneException("User is not authenticated")

    /** The stored access token has expired and no refresh token is available. */
    class TokenExpired : IdenplaneException("Access token has expired")

    /** No refresh token is available in storage. */
    class NoRefreshToken : IdenplaneException("No refresh token available")

    /** The redirect URI registered in the app does not match the config. */
    class InvalidRedirectUri(uri: String) :
        IdenplaneException("Invalid redirect URI: $uri")

    /** The OAuth state parameter did not match — possible CSRF. */
    class StateMismatch : IdenplaneException("State mismatch — possible CSRF attack")

    /** The PKCE code verifier is missing from storage. */
    class PkceVerifierMissing : IdenplaneException("PKCE code verifier is missing")

    /** A network or HTTP error occurred. */
    class NetworkError(message: String, cause: Throwable? = null) :
        IdenplaneException(message, cause)

    /** The Idenplane server returned an error response. */
    class ServerError(message: String) : IdenplaneException(message)

    /** The authorization callback contained an error. */
    class CallbackError(message: String) : IdenplaneException(message)

    /** Failed to fetch or parse the OIDC discovery document. */
    class DiscoveryFailed(message: String) : IdenplaneException(message)

    /** Biometric authentication failed or was cancelled. */
    class BiometricAuthFailed(reason: String) :
        IdenplaneException("Biometric authentication failed: $reason")

    /** The login was cancelled by the user. */
    class LoginCancelled : IdenplaneException("Login was cancelled by the user")
}
