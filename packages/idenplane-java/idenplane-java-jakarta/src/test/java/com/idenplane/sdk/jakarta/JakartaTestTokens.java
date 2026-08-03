package com.idenplane.sdk.jakarta;

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

/** Mints a real RS256-signed JWT and matching JWKS for tests. Public so the jaxrs test package can reuse it. */
public final class JakartaTestTokens {

    final RSAKey rsaJwk;
    final String keyId;

    private JakartaTestTokens(RSAKey rsaJwk) {
        this.rsaJwk = rsaJwk;
        this.keyId = rsaJwk.getKeyID();
    }

    public static JakartaTestTokens generate() {
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
            generator.initialize(2048);
            KeyPair keyPair = generator.generateKeyPair();
            RSAKey jwk = new RSAKey.Builder((RSAPublicKey) keyPair.getPublic())
                    .privateKey((RSAPrivateKey) keyPair.getPrivate())
                    .keyID(UUID.randomUUID().toString())
                    .build();
            return new JakartaTestTokens(jwk);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    public String jwksJson() {
        return new JWKSet(rsaJwk.toPublicJWK()).toString();
    }

    public String sign(JWTClaimsSet claims) {
        try {
            SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(keyId).build(), claims);
            jwt.sign(new RSASSASigner(rsaJwk));
            return jwt.serialize();
        } catch (JOSEException e) {
            throw new IllegalStateException(e);
        }
    }
}
