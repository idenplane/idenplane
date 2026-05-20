import Foundation
import CryptoKit

/// Helpers for generating OAuth 2.0 PKCE parameters (RFC 7636).
public enum PKCEHelper {

    // MARK: - Code Verifier

    /// Generate a cryptographically random PKCE code verifier.
    ///
    /// The verifier is a high-entropy random string of 43–128 characters,
    /// Base64URL-encoded without padding, as required by RFC 7636.
    public static func generateCodeVerifier() -> String {
        var buffer = [UInt8](repeating: 0, count: 32)
        let result = SecRandomCopyBytes(kSecRandomDefault, buffer.count, &buffer)
        guard result == errSecSuccess else {
            // Fallback to Swift's built-in random if SecRandom fails
            buffer = (0..<32).map { _ in UInt8.random(in: 0...255) }
            return Data(buffer).base64URLEncodedString()
        }
        return Data(buffer).base64URLEncodedString()
    }

    // MARK: - Code Challenge

    /// Derive the S256 PKCE code challenge from a verifier.
    ///
    /// Challenge = BASE64URL(SHA256(ASCII(verifier)))
    public static func generateCodeChallenge(from verifier: String) -> String {
        guard let data = verifier.data(using: .ascii) else {
            preconditionFailure("Code verifier must be ASCII")
        }
        let digest = SHA256.hash(data: data)
        return Data(digest).base64URLEncodedString()
    }

    // MARK: - State

    /// Generate a random state parameter for CSRF protection.
    public static func generateState() -> String {
        var buffer = [UInt8](repeating: 0, count: 16)
        _ = SecRandomCopyBytes(kSecRandomDefault, buffer.count, &buffer)
        return Data(buffer).base64URLEncodedString()
    }
}

// MARK: - Data + Base64URL

private extension Data {
    /// Encode as Base64URL without padding characters (RFC 4648 §5).
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
