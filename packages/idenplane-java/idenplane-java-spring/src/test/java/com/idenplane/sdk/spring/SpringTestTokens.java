package com.idenplane.sdk.spring;

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
 * Mints a real RS256-signed JWT and matching JWKS, so the auto-configured
 * {@code NimbusJwtDecoder} is exercised against actual cryptography end-to-end instead of a
 * hand-built {@code Jwt} object.
 */
final class SpringTestTokens {

    final RSAKey rsaJwk;
    final String keyId;

    private SpringTestTokens(RSAKey rsaJwk) {
        this.rsaJwk = rsaJwk;
        this.keyId = rsaJwk.getKeyID();
    }

    static SpringTestTokens generate() {
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
            generator.initialize(2048);
            KeyPair keyPair = generator.generateKeyPair();
            RSAKey jwk = new RSAKey.Builder((RSAPublicKey) keyPair.getPublic())
                    .privateKey((RSAPrivateKey) keyPair.getPrivate())
                    .keyID(UUID.randomUUID().toString())
                    .build();
            return new SpringTestTokens(jwk);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    String jwksJson() {
        return new JWKSet(rsaJwk.toPublicJWK()).toString();
    }

    String sign(JWTClaimsSet claims) {
        try {
            SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(keyId).build(), claims);
            jwt.sign(new RSASSASigner(rsaJwk));
            return jwt.serialize();
        } catch (JOSEException e) {
            throw new IllegalStateException(e);
        }
    }
}
