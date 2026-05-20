import Foundation

// MARK: - AuthConfig

/// Configuration for creating an AuthMeClient instance.
public struct AuthConfig: Sendable {
    /// Base URL of the AuthMe server (e.g. "https://auth.example.com")
    public let serverUrl: URL
    /// Realm name to authenticate against
    public let realm: String
    /// OAuth2 client ID (must be registered in AuthMe as a PUBLIC client)
    public let clientId: String
    /// Custom URL scheme redirect URI (e.g. "com.example.app://callback")
    public let redirectUri: String
    /// OAuth2 scopes to request (default: ["openid", "profile", "email"])
    public let scopes: [String]
    /// Automatically refresh tokens before expiry (default: true)
    public let autoRefresh: Bool
    /// Seconds before expiry to trigger a refresh (default: 30)
    public let refreshBuffer: TimeInterval

    public init(
        serverUrl: URL,
        realm: String,
        clientId: String,
        redirectUri: String,
        scopes: [String] = ["openid", "profile", "email"],
        autoRefresh: Bool = true,
        refreshBuffer: TimeInterval = 30
    ) {
        self.serverUrl = serverUrl
        self.realm = realm
        self.clientId = clientId
        self.redirectUri = redirectUri
        self.scopes = scopes
        self.autoRefresh = autoRefresh
        self.refreshBuffer = refreshBuffer
    }

    /// The OIDC discovery URL for this realm.
    var discoveryURL: URL {
        serverUrl
            .appendingPathComponent("realms")
            .appendingPathComponent(realm)
            .appendingPathComponent(".well-known/openid-configuration")
    }
}

// MARK: - TokenResponse

/// Raw token response from the token endpoint.
public struct TokenResponse: Codable, Sendable {
    public let accessToken: String
    public let tokenType: String
    public let expiresIn: Int
    public let refreshToken: String?
    public let idToken: String?
    public let scope: String?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case tokenType = "token_type"
        case expiresIn = "expires_in"
        case refreshToken = "refresh_token"
        case idToken = "id_token"
        case scope
    }
}

// MARK: - User

/// User information returned by the userinfo endpoint.
public struct User: Codable, Sendable {
    public let sub: String
    public let preferredUsername: String?
    public let name: String?
    public let givenName: String?
    public let familyName: String?
    public let email: String?
    public let emailVerified: Bool?

    enum CodingKeys: String, CodingKey {
        case sub
        case preferredUsername = "preferred_username"
        case name
        case givenName = "given_name"
        case familyName = "family_name"
        case email
        case emailVerified = "email_verified"
    }
}

// MARK: - OIDCConfiguration

/// OIDC Discovery document.
struct OIDCConfiguration: Codable {
    let issuer: String
    let authorizationEndpoint: String
    let tokenEndpoint: String
    let userinfoEndpoint: String
    let jwksUri: String
    let endSessionEndpoint: String?

    enum CodingKeys: String, CodingKey {
        case issuer
        case authorizationEndpoint = "authorization_endpoint"
        case tokenEndpoint = "token_endpoint"
        case userinfoEndpoint = "userinfo_endpoint"
        case jwksUri = "jwks_uri"
        case endSessionEndpoint = "end_session_endpoint"
    }
}

// MARK: - AuthMeError

/// Errors thrown by the AuthMe SDK.
public enum AuthMeError: LocalizedError, Sendable {
    case notAuthenticated
    case tokenExpired
    case noRefreshToken
    case invalidRedirectURI(String)
    case stateMismatch
    case pkceVerifierMissing
    case networkError(Error)
    case serverError(String)
    case tokenParseError
    case biometricAuthFailed(String)
    case discoveryFailed(String)
    case callbackError(String)

    public var errorDescription: String? {
        switch self {
        case .notAuthenticated:
            return "User is not authenticated."
        case .tokenExpired:
            return "The access token has expired."
        case .noRefreshToken:
            return "No refresh token available."
        case .invalidRedirectURI(let uri):
            return "Invalid redirect URI: \(uri)"
        case .stateMismatch:
            return "State parameter mismatch — possible CSRF attack."
        case .pkceVerifierMissing:
            return "PKCE code verifier is missing."
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        case .serverError(let message):
            return "Server error: \(message)"
        case .tokenParseError:
            return "Failed to parse token."
        case .biometricAuthFailed(let reason):
            return "Biometric authentication failed: \(reason)"
        case .discoveryFailed(let message):
            return "Failed to fetch OIDC discovery document: \(message)"
        case .callbackError(let message):
            return "Authorization callback error: \(message)"
        }
    }
}
