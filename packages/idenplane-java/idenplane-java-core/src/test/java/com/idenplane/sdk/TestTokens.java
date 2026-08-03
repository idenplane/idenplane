package com.idenplane.sdk;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.NoSuchAlgorithmException;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.util.UUID;

/**
 * Mints real RS256-signed JWTs and a matching JWKS for tests, so token validation is exercised
 * against actual cryptographic signatures rather than pre-canned strings.
 */
final class TestTokens {

    final RSAKey rsaJwk;
    final String keyId;

    private TestTokens(RSAKey rsaJwk) {
        this.rsaJwk = rsaJwk;
        this.keyId = rsaJwk.getKeyID();
    }

    static TestTokens generate() {
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
            generator.initialize(2048);
            KeyPair keyPair = generator.generateKeyPair();
            RSAKey jwk = new RSAKey.Builder((RSAPublicKey) keyPair.getPublic())
                    .privateKey((RSAPrivateKey) keyPair.getPrivate())
                    .keyID(UUID.randomUUID().toString())
                    .build();
            return new TestTokens(jwk);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    String jwksJson() {
        return new JWKSet(rsaJwk.toPublicJWK()).toString();
    }

    static String jwksJson(TestTokens... tokens) {
        java.util.List<com.nimbusds.jose.jwk.JWK> keys = new java.util.ArrayList<>();
        for (TestTokens t : tokens) {
            keys.add(t.rsaJwk.toPublicJWK());
        }
        return new JWKSet(keys).toString();
    }

    String sign(JWTClaimsSet claims) {
        return signWithKey(claims, this.rsaJwk);
    }

    /**
     * Signs claims with a header {@code kid} that does NOT match the signing key — simulates a
     * forged/tampered token that must fail signature verification.
     */
    String signWithMismatchedKey(JWTClaimsSet claims, TestTokens signingKey) {
        try {
            SignedJWT jwt = new SignedJWT(
                    new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(this.keyId).build(), claims);
            jwt.sign(new RSASSASigner(signingKey.rsaJwk));
            return jwt.serialize();
        } catch (JOSEException e) {
            throw new IllegalStateException(e);
        }
    }

    /**
     * Signs claims with an explicit JWS algorithm, keeping the real signing key and kid — used
     * to prove the client pins the expected algorithm rather than accepting anything the
     * verifier happens to support.
     */
    String signWithAlgorithm(JWTClaimsSet claims, JWSAlgorithm algorithm) {
        try {
            SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(algorithm).keyID(keyId).build(), claims);
            jwt.sign(new RSASSASigner(rsaJwk));
            return jwt.serialize();
        } catch (JOSEException e) {
            throw new IllegalStateException(e);
        }
    }

    private String signWithKey(JWTClaimsSet claims, RSAKey key) {
        try {
            SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(keyId).build(), claims);
            jwt.sign(new RSASSASigner(key));
            return jwt.serialize();
        } catch (JOSEException e) {
            throw new IllegalStateException(e);
        }
    }
}
