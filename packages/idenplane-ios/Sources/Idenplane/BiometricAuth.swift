import Foundation
import LocalAuthentication

/// Wrapper around LocalAuthentication for Face ID / Touch ID gating of sensitive operations.
///
/// Use `BiometricAuth` to require biometric (or device passcode fallback) confirmation
/// before exposing tokens to the app. The prompt is shown each time `authenticate()` is called.
public final class BiometricAuth: @unchecked Sendable {

    // MARK: - Biometric type

    /// The biometric modality available on the current device.
    public enum BiometryType: Sendable {
        case faceID
        case touchID
        case opticID
        case none
    }

    // MARK: - Policy

    /// Whether to fall back to the device passcode when biometrics fail.
    public var allowPasscodeFallback: Bool

    public init(allowPasscodeFallback: Bool = true) {
        self.allowPasscodeFallback = allowPasscodeFallback
    }

    // MARK: - Capabilities

    /// Returns the biometric type available on this device, or `.none` if unavailable.
    public var biometryType: BiometryType {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
        else { return .none }

        switch context.biometryType {
        case .faceID:   return .faceID
        case .touchID:  return .touchID
        case .opticID:  return .opticID
        default:        return .none
        }
    }

    /// Returns `true` if the device supports any biometric modality.
    public var isBiometricAvailable: Bool {
        biometryType != .none
    }

    // MARK: - Authentication

    /// Prompt the user to authenticate via biometrics (or passcode if enabled).
    ///
    /// - Parameter reason: A human-readable string shown in the system prompt.
    /// - Throws: `AuthMeError.biometricAuthFailed` if authentication is denied or unavailable.
    public func authenticate(reason: String = "Authenticate to access your account") async throws {
        let context = LAContext()
        context.localizedCancelTitle = "Cancel"

        let policy: LAPolicy = allowPasscodeFallback
            ? .deviceOwnerAuthentication
            : .deviceOwnerAuthenticationWithBiometrics

        var canEvalError: NSError?
        guard context.canEvaluatePolicy(policy, error: &canEvalError) else {
            let message = canEvalError?.localizedDescription ?? "Biometrics not available"
            throw AuthMeError.biometricAuthFailed(message)
        }

        do {
            let success = try await context.evaluatePolicy(policy, localizedReason: reason)
            guard success else {
                throw AuthMeError.biometricAuthFailed("Authentication was not successful")
            }
        } catch let laError as LAError {
            throw AuthMeError.biometricAuthFailed(laError.localizedDescription)
        }
    }
}
