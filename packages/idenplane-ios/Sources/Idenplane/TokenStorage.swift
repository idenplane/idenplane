import Foundation
import Security

/// Secure token storage backed by the iOS Keychain.
///
/// Tokens are stored under a service name derived from the realm and client ID,
/// so multiple AuthMe realms can coexist without key collisions.
final class TokenStorage: @unchecked Sendable {

    // MARK: - Keys

    private let servicePrefix: String

    init(realm: String, clientId: String) {
        self.servicePrefix = "com.authme.sdk.\(realm).\(clientId)"
    }

    // MARK: - Stored Keys

    private enum Key: String {
        case accessToken  = "access_token"
        case refreshToken = "refresh_token"
        case idToken      = "id_token"
        case pkceVerifier = "pkce_verifier"
        case authState    = "auth_state"
    }

    // MARK: - Convenience accessors

    var accessToken: String? {
        get { read(key: .accessToken) }
        set { newValue == nil ? delete(key: .accessToken) : write(newValue!, key: .accessToken) }
    }

    var refreshToken: String? {
        get { read(key: .refreshToken) }
        set { newValue == nil ? delete(key: .refreshToken) : write(newValue!, key: .refreshToken) }
    }

    var idToken: String? {
        get { read(key: .idToken) }
        set { newValue == nil ? delete(key: .idToken) : write(newValue!, key: .idToken) }
    }

    var pkceVerifier: String? {
        get { read(key: .pkceVerifier) }
        set { newValue == nil ? delete(key: .pkceVerifier) : write(newValue!, key: .pkceVerifier) }
    }

    var authState: String? {
        get { read(key: .authState) }
        set { newValue == nil ? delete(key: .authState) : write(newValue!, key: .authState) }
    }

    // MARK: - Bulk operations

    /// Store a full token response.
    func store(_ tokens: TokenResponse) {
        accessToken  = tokens.accessToken
        refreshToken = tokens.refreshToken
        idToken      = tokens.idToken
    }

    /// Remove all stored tokens and PKCE state.
    func clear() {
        Key.allCases.forEach { delete(key: $0) }
    }

    // MARK: - Keychain primitives

    private func serviceName(for key: Key) -> String {
        "\(servicePrefix).\(key.rawValue)"
    }

    @discardableResult
    private func write(_ value: String, key: Key) -> Bool {
        guard let data = value.data(using: .utf8) else { return false }

        let service = serviceName(for: key)

        // Delete existing item first so we can add a fresh one
        delete(key: key)

        let query: [String: Any] = [
            kSecClass as String:            kSecClassGenericPassword,
            kSecAttrService as String:      service,
            kSecAttrAccessible as String:   kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String:        data,
        ]

        let status = SecItemAdd(query as CFDictionary, nil)
        return status == errSecSuccess
    }

    private func read(key: Key) -> String? {
        let service = serviceName(for: key)

        let query: [String: Any] = [
            kSecClass as String:       kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecReturnData as String:  true,
            kSecMatchLimit as String:  kSecMatchLimitOne,
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess,
              let data = result as? Data,
              let string = String(data: data, encoding: .utf8)
        else { return nil }

        return string
    }

    @discardableResult
    private func delete(key: Key) -> Bool {
        let service = serviceName(for: key)

        let query: [String: Any] = [
            kSecClass as String:       kSecClassGenericPassword,
            kSecAttrService as String: service,
        ]

        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }
}

// MARK: - CaseIterable conformance for Key

extension TokenStorage.Key: CaseIterable {}
