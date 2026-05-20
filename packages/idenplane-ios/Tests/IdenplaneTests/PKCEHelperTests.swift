import XCTest
@testable import AuthMe

final class PKCEHelperTests: XCTestCase {

    func testCodeVerifierLength() {
        let verifier = PKCEHelper.generateCodeVerifier()
        // RFC 7636 §4.1: 43–128 characters
        XCTAssertGreaterThanOrEqual(verifier.count, 43)
        XCTAssertLessThanOrEqual(verifier.count, 128)
    }

    func testCodeVerifierIsBase64URL() {
        let verifier = PKCEHelper.generateCodeVerifier()
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
        XCTAssertTrue(verifier.unicodeScalars.allSatisfy { allowed.contains($0) })
    }

    func testCodeVerifierIsUnique() {
        let v1 = PKCEHelper.generateCodeVerifier()
        let v2 = PKCEHelper.generateCodeVerifier()
        XCTAssertNotEqual(v1, v2)
    }

    func testCodeChallengeIsBase64URL() {
        let verifier  = PKCEHelper.generateCodeVerifier()
        let challenge = PKCEHelper.generateCodeChallenge(from: verifier)
        let allowed   = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
        XCTAssertTrue(challenge.unicodeScalars.allSatisfy { allowed.contains($0) })
    }

    func testCodeChallengeHasNoPadding() {
        let verifier  = PKCEHelper.generateCodeVerifier()
        let challenge = PKCEHelper.generateCodeChallenge(from: verifier)
        XCTAssertFalse(challenge.contains("="))
    }

    /// RFC 7636 §4.2 test vector (SHA-256 of "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
    func testCodeChallengeKnownVector() {
        let verifier  = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        let challenge = PKCEHelper.generateCodeChallenge(from: verifier)
        XCTAssertEqual(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }

    func testStateIsUnique() {
        let s1 = PKCEHelper.generateState()
        let s2 = PKCEHelper.generateState()
        XCTAssertNotEqual(s1, s2)
    }
}
