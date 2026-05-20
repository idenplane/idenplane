import Foundation
import AuthenticationServices

/// Main entry point for the AuthMe iOS SDK.
///
/// `AuthMeClient` manages the full OAuth 2.0 PKCE login flow, secure token storage,
/// automatic token refresh, and optional biometric gating.
///
/// ## Quick start
/// ```swift
/// let config = AuthConfig(
///     serverUrl: URL(string: "https://auth.example.com")!,
///     realm: "my-realm",
///     clientId: "my-app",
///     redirectUri: "com.example.myapp://callback"
/// )
/// let client = AuthMeClient(config: config)
///
/// // In your SwiftUI view or view controller:
/// try await client.login()
/// ```
@MainActor
public final class AuthMeClient: NSObject {

    // MARK: - State

    private let config: AuthConfig
    private let storage: TokenStorage
    private let urlSession: URLSession

    private var oidcConfig: OIDCConfiguration?
    /// Timestamp of the last successful discovery fetch (used for TTL eviction).
    private var oidcConfigFetchedAt: Date?
    /// Discovery documents are re-fetched after this interval (1 hour).
    private static let discoveryTTL: TimeInterval = 3600
    private var refreshTask: Task<Void, Never>?

    /// Retained for the duration of an active login flow.
    /// `ASWebAuthenticationSession` must be held by a strong reference or iOS will
    /// silently cancel the session before the callback fires (see issue #368).
    private var authSession: ASWebAuthenticationSession?

    // MARK: - Init

    /// Create a new AuthMeClient with the given configuration.
    public init(
        config: AuthConfig,
        urlSession: URLSession = .shared
    ) {
        self.config = config
        self.storage = TokenStorage(realm: config.realm, clientId: config.clientId)
        self.urlSession = urlSession
        super.init()
    }

    /// Convenience initialiser matching the documented API surface.
    public convenience init(
        serverUrl: URL,
        realm: String,
        clientId: String,
        redirectUri: String,
        scopes: [String] = ["openid", "profile", "email"]
    ) {
        self.init(config: AuthConfig(
            serverUrl: serverUrl,
            realm: realm,
            clientId: clientId,
            redirectUri: redirectUri,
            scopes: scopes
        ))
    }

    // MARK: - Authentication state

    /// Returns `true` if a non-expired access token is available.
    public var isAuthenticated: Bool {
        guard let token = storage.accessToken else { return false }
        return !isTokenExpired(token)
    }

    // MARK: - Login

    /// Open an `ASWebAuthenticationSession` to perform the OAuth 2.0 PKCE login flow.
    ///
    /// On success the tokens are stored in the Keychain and auto-refresh is scheduled.
    /// - Parameter presentationContextProvider: The window anchor for the auth session.
    ///   Defaults to the key window on iOS 15+.
    public func login(
        presentationContextProvider: ASWebAuthenticationPresentationContextProviding? = nil
    ) async throws {
        let oidc = try await fetchDiscovery()

        let verifier = PKCEHelper.generateCodeVerifier()
        let challenge = PKCEHelper.generateCodeChallenge(from: verifier)
        let state     = PKCEHelper.generateState()

        storage.pkceVerifier = verifier
        storage.authState    = state

        guard var components = URLComponents(string: oidc.authorizationEndpoint) else {
            throw AuthMeError.serverError("Invalid authorization endpoint URL: \(oidc.authorizationEndpoint)")
        }
        components.queryItems = [
            URLQueryItem(name: "response_type",           value: "code"),
            URLQueryItem(name: "client_id",               value: config.clientId),
            URLQueryItem(name: "redirect_uri",            value: config.redirectUri),
            URLQueryItem(name: "scope",                   value: config.scopes.joined(separator: " ")),
            URLQueryItem(name: "state",                   value: state),
            URLQueryItem(name: "code_challenge",          value: challenge),
            URLQueryItem(name: "code_challenge_method",   value: "S256"),
        ]

        guard let authURL = components.url else {
            throw AuthMeError.invalidRedirectURI(config.redirectUri)
        }

        guard let callbackScheme = URL(string: config.redirectUri)?.scheme else {
            throw AuthMeError.invalidRedirectURI(config.redirectUri)
        }

        let callbackURL = try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<URL, Error>) in

            let session = ASWebAuthenticationSession(
                url: authURL,
                callbackURLScheme: callbackScheme
            ) { [weak self] url, error in
                // Release the strong reference now that the callback has fired.
                self?.authSession = nil
                if let error {
                    continuation.resume(throwing: AuthMeError.networkError(error))
                } else if let url {
                    continuation.resume(returning: url)
                } else {
                    continuation.resume(throwing: AuthMeError.callbackError("No callback URL received"))
                }
            }

            session.prefersEphemeralWebBrowserSession = false

            if let provider = presentationContextProvider {
                session.presentationContextProvider = provider
            } else {
                session.presentationContextProvider = DefaultPresentationContextProvider()
            }

            // Retain the session on self so ARC does not deallocate it before
            // the callback fires (issue #368: silent cancellation on iOS).
            authSession = session
            session.start()
        }

        try await handleCallback(url: callbackURL, oidcConfig: oidc)
        scheduleAutoRefresh()
    }

    // MARK: - Callback handling

    /// Handle an inbound redirect URI after authorization — call from your AppDelegate/SceneDelegate
    /// `openURL` handler if using a custom URL scheme outside of ASWebAuthenticationSession.
    public func handleRedirectURL(_ url: URL) async throws {
        let oidc = try await fetchDiscovery()
        try await handleCallback(url: url, oidcConfig: oidc)
        scheduleAutoRefresh()
    }

    private func handleCallback(url: URL, oidcConfig: OIDCConfiguration) async throws {
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let params     = Dictionary(
            uniqueKeysWithValues: (components?.queryItems ?? []).compactMap { item -> (String, String)? in
                guard let value = item.value else { return nil }
                return (item.name, value)
            }
        )

        if let error = params["error"] {
            let description = params["error_description"] ?? error
            throw AuthMeError.callbackError(description)
        }

        guard let code = params["code"] else {
            throw AuthMeError.callbackError("Missing authorization code")
        }

        let returnedState = params["state"]
        guard let storedState = storage.authState, returnedState == storedState else {
            throw AuthMeError.stateMismatch
        }

        guard let verifier = storage.pkceVerifier else {
            throw AuthMeError.pkceVerifierMissing
        }

        let tokens = try await exchangeCode(
            code: code,
            verifier: verifier,
            tokenEndpoint: oidcConfig.tokenEndpoint
        )

        storage.store(tokens)
        storage.pkceVerifier = nil
        storage.authState    = nil
    }

    // MARK: - Logout

    /// Clear local tokens and attempt server-side session termination.
    public func logout() async {
        if let refreshToken = storage.refreshToken,
           let oidc = try? await fetchDiscovery(),
           let endSessionEndpoint = oidc.endSessionEndpoint,
           let endSessionURL = URL(string: endSessionEndpoint)
        {
            var request = URLRequest(url: endSessionURL)
            request.httpMethod = "POST"
            request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            request.httpBody = [
                "refresh_token": refreshToken,
                "client_id":     config.clientId,
            ].percentEncoded()
            _ = try? await urlSession.data(for: request)
        }

        cancelAutoRefresh()
        storage.clear()
    }

    // MARK: - Token access

    /// Returns the current access token string, or `nil` if not authenticated / expired.
    public func getAccessToken() -> String? {
        guard let token = storage.accessToken, !isTokenExpired(token) else { return nil }
        return token
    }

    /// Returns the current access token, gated behind a biometric prompt.
    ///
    /// - Parameter reason: The biometric prompt reason string.
    /// - Throws: `AuthMeError.biometricAuthFailed` if the user cancels or biometrics fail.
    public func getAccessToken(
        biometricReason: String,
        biometricAuth: BiometricAuth = BiometricAuth()
    ) async throws -> String? {
        try await biometricAuth.authenticate(reason: biometricReason)
        return getAccessToken()
    }

    // MARK: - Token refresh

    /// Refresh the access token using the stored refresh token.
    public func refreshToken() async throws {
        let oidc = try await fetchDiscovery()

        guard let refreshTokenValue = storage.refreshToken else {
            throw AuthMeError.noRefreshToken
        }

        guard let tokenURL = URL(string: oidc.tokenEndpoint) else {
            throw AuthMeError.serverError("Invalid token endpoint URL: \(oidc.tokenEndpoint)")
        }
        var request = URLRequest(url: tokenURL)
        request.httpMethod = "POST"
        request.setValue(
            "application/x-www-form-urlencoded",
            forHTTPHeaderField: "Content-Type"
        )
        request.httpBody = [
            "grant_type":    "refresh_token",
            "refresh_token": refreshTokenValue,
            "client_id":     config.clientId,
        ].percentEncoded()

        let (data, response) = try await urlSession.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            // Only clear stored tokens when the server definitively rejects the
            // refresh token (4xx — e.g. invalid_grant, revoked token).  On 5xx
            // or network errors the tokens may still be valid; clearing them
            // would silently log the user out due to a transient server problem.
            if let httpResponse = response as? HTTPURLResponse,
               httpResponse.statusCode >= 400,
               httpResponse.statusCode < 500 {
                storage.clear()
            }
            let message = parseError(from: data) ?? "Token refresh failed"
            throw AuthMeError.serverError(message)
        }

        let tokens = try JSONDecoder().decode(TokenResponse.self, from: data)
        storage.store(tokens)
        scheduleAutoRefresh()
    }

    // MARK: - User Info

    /// Fetch the current user's profile from the userinfo endpoint.
    public func getUserInfo() async throws -> User {
        guard let accessToken = getAccessToken() else {
            throw AuthMeError.notAuthenticated
        }

        let oidc = try await fetchDiscovery()

        guard let userinfoURL = URL(string: oidc.userinfoEndpoint) else {
            throw AuthMeError.serverError("Invalid userinfo endpoint URL: \(oidc.userinfoEndpoint)")
        }
        var request = URLRequest(url: userinfoURL)
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await urlSession.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw AuthMeError.serverError("Failed to fetch user info")
        }

        return try JSONDecoder().decode(User.self, from: data)
    }

    // MARK: - Discovery

    private func fetchDiscovery() async throws -> OIDCConfiguration {
        // Bug #438-7 fix: the old code cached the discovery document forever.
        // An IdP can rotate signing keys or change endpoint URLs; serving a stale
        // document leads to verification failures and broken flows.
        // Fix: evict the cache after discoveryTTL (1 hour) so we periodically
        // re-fetch the discovery document.
        if let cached = oidcConfig,
           let fetchedAt = oidcConfigFetchedAt,
           Date().timeIntervalSince(fetchedAt) < Self.discoveryTTL
        {
            return cached
        }

        // Cache is absent or expired — clear it before fetching so a failed
        // request does not leave stale data in place.
        oidcConfig = nil
        oidcConfigFetchedAt = nil

        let (data, response) = try await urlSession.data(from: config.discoveryURL)

        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw AuthMeError.discoveryFailed("Non-200 response from discovery endpoint")
        }

        let configuration = try JSONDecoder().decode(OIDCConfiguration.self, from: data)
        oidcConfig = configuration
        oidcConfigFetchedAt = Date()
        return configuration
    }

    // MARK: - Code exchange

    private func exchangeCode(
        code: String,
        verifier: String,
        tokenEndpoint: String
    ) async throws -> TokenResponse {
        guard let tokenURL = URL(string: tokenEndpoint) else {
            throw AuthMeError.serverError("Invalid token endpoint URL: \(tokenEndpoint)")
        }
        var request = URLRequest(url: tokenURL)
        request.httpMethod = "POST"
        request.setValue(
            "application/x-www-form-urlencoded",
            forHTTPHeaderField: "Content-Type"
        )
        request.httpBody = [
            "grant_type":    "authorization_code",
            "code":          code,
            "redirect_uri":  config.redirectUri,
            "client_id":     config.clientId,
            "code_verifier": verifier,
        ].percentEncoded()

        let (data, response) = try await urlSession.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            let message = parseError(from: data) ?? "Token exchange failed"
            throw AuthMeError.serverError(message)
        }

        return try JSONDecoder().decode(TokenResponse.self, from: data)
    }

    // MARK: - Auto-refresh scheduling

    private func scheduleAutoRefresh() {
        guard config.autoRefresh else { return }
        cancelAutoRefresh()

        guard let token = storage.accessToken,
              let expiry = jwtExpiry(from: token)
        else { return }

        let refreshIn = max(0, expiry - Date().timeIntervalSince1970 - config.refreshBuffer)

        refreshTask = Task { [weak self] in
            guard let self else { return }
            try? await Task.sleep(nanoseconds: UInt64(refreshIn * 1_000_000_000))
            guard !Task.isCancelled else { return }
            do {
                try await self.refreshToken()
            } catch {
                // Issue #457: auto-refresh errors were previously swallowed with
                // `try?`, giving callers no way to react (e.g. redirect to login).
                // Log the error so it is at least visible in the console; consumers
                // who need programmatic handling should observe token expiry via
                // `isAuthenticated` or wrap `refreshToken()` themselves.
                print("[AuthMe] Auto-refresh failed: \(error)")
            }
        }
    }

    private func cancelAutoRefresh() {
        refreshTask?.cancel()
        refreshTask = nil
    }

    // MARK: - JWT helpers

    private func isTokenExpired(_ token: String) -> Bool {
        guard let expiry = jwtExpiry(from: token) else { return true }
        return Date().timeIntervalSince1970 >= expiry
    }

    private func jwtExpiry(from token: String) -> TimeInterval? {
        let parts = token.split(separator: ".")
        guard parts.count == 3 else { return nil }

        var base64 = String(parts[1])
        // Pad to a multiple of 4
        while base64.count % 4 != 0 { base64.append("=") }
        base64 = base64
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")

        guard let data = Data(base64Encoded: base64),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let exp  = json["exp"] as? TimeInterval
        else { return nil }

        return exp
    }

    private func parseError(from data: Data) -> String? {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return (json["error_description"] as? String) ?? (json["error"] as? String)
    }
}

// MARK: - Dictionary helpers

private extension Dictionary where Key == String, Value == String {
    func percentEncoded() -> Data? {
        // `urlQueryAllowed` does not encode `+`, `&`, or `=`, which are
        // structural characters in application/x-www-form-urlencoded bodies.
        // Build a custom set that excludes those characters so they are always
        // percent-encoded when they appear inside a key or value.
        var formAllowed = CharacterSet.urlQueryAllowed
        formAllowed.remove(charactersIn: "+&=")

        return map { key, value in
            let encodedKey   = key.addingPercentEncoding(withAllowedCharacters: formAllowed) ?? key
            let encodedValue = value.addingPercentEncoding(withAllowedCharacters: formAllowed) ?? value
            return "\(encodedKey)=\(encodedValue)"
        }
        .joined(separator: "&")
        .data(using: .utf8)
    }
}

// MARK: - Default presentation context

/// A minimal `ASWebAuthenticationPresentationContextProviding` implementation that
/// returns the app's key window using scene-based APIs.
///
/// The lookup strategy is:
///   1. Prefer the foreground-active `UIWindowScene`'s key window (iOS 15+) or
///      first key window (iOS < 15).
///   2. Fall back to *any* connected `UIWindowScene` when no foreground-active
///      scene is found (e.g. the app is mid-transition between states).
///
/// A bare `UIWindow()` is **never** returned; that creates a detached window that
/// is not part of the scene hierarchy, causing `ASWebAuthenticationSession` to
/// silently fail to present its browser sheet.  If no suitable window can be
/// found at all the method traps with a clear message rather than returning a
/// useless anchor.
private final class DefaultPresentationContextProvider: NSObject,
    ASWebAuthenticationPresentationContextProviding
{
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        #if os(iOS)
        let windowScenes = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }

        // 1. Prefer a foreground-active scene.
        let activeScene = windowScenes.first { $0.activationState == .foregroundActive }
            ?? windowScenes.first // 2. Any connected scene as fallback.

        if #available(iOS 15, *) {
            if let window = activeScene?.keyWindow {
                return window
            }
        }
        // Pre-iOS-15 path, or iOS 15+ when keyWindow is nil (uncommon but possible
        // during transitions).
        if let window = activeScene?.windows.first(where: \.isKeyWindow)
            ?? activeScene?.windows.first
        {
            return window
        }

        // No window is available — this should never happen in a correctly
        // configured app, but trap loudly so the root cause is obvious rather
        // than producing a cryptic, silent failure.
        preconditionFailure(
            "[AuthMe] DefaultPresentationContextProvider: no UIWindow found in any " +
            "connected UIWindowScene. Ensure the app has an active window before " +
            "calling login(), or supply a custom presentationContextProvider."
        )
        #elseif os(macOS)
        if let window = NSApplication.shared.keyWindow
            ?? NSApplication.shared.windows.first(where: { $0.isVisible })
        {
            return window
        }
        preconditionFailure(
            "[AuthMe] DefaultPresentationContextProvider: no NSWindow found. " +
            "Ensure the app has a visible window before calling login(), " +
            "or supply a custom presentationContextProvider."
        )
        #endif
    }
}
