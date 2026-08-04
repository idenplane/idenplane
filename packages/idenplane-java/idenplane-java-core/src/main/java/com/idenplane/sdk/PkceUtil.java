package com.idenplane.sdk;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * RFC 7636 PKCE (Proof Key for Code Exchange) helper for the Authorization Code flow.
 */
public final class PkceUtil {

    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private PkceUtil() {
    }

    /**
     * Generates a cryptographically random code verifier: 32 random bytes, base64url-encoded
     * without padding, giving 43 characters — within the 43-128 character range required by
     * RFC 7636 section 4.1.
     *
     * @return a new code verifier
     */
    public static String generateCodeVerifier() {
        byte[] bytes = new byte[32];
        SECURE_RANDOM.nextBytes(bytes);
        return base64UrlEncode(bytes);
    }

    /**
     * Derives the S256 code challenge for a code verifier, per RFC 7636 section 4.2.
     *
     * @param codeVerifier a verifier produced by {@link #generateCodeVerifier()}
     * @return the base64url-encoded SHA-256 code challenge
     */
    public static String deriveCodeChallenge(String codeVerifier) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(codeVerifier.getBytes(StandardCharsets.US_ASCII));
            return base64UrlEncode(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is not available on this JVM", e);
        }
    }

    private static String base64UrlEncode(byte[] bytes) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}
