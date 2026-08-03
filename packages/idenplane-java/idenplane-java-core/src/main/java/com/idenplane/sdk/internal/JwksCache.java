package com.idenplane.sdk.internal;

import com.idenplane.sdk.IdenplaneClientException;
import com.idenplane.sdk.TokenValidationException;
import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.jwk.JWK;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;

import java.security.interfaces.RSAPublicKey;
import java.text.ParseException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;

/**
 * Caches a realm's JWKS document and resolves RSA public keys by {@code kid}. On a cache miss
 * (key not found — possibly because it rotated since the last fetch) it refreshes once and
 * retries before giving up, rather than either trusting a stale cache forever or refetching on
 * every single validation.
 *
 * <p>The miss-triggered refresh is itself rate-limited ({@code minMissRefreshInterval}):
 * without it, an unauthenticated caller could force unlimited outbound requests to this realm's
 * own JWKS endpoint just by presenting tokens with many distinct bogus {@code kid} values.
 */
public final class JwksCache {

    private static final Duration DEFAULT_MIN_MISS_REFRESH_INTERVAL = Duration.ofSeconds(5);

    private final String jwksUri;
    private final HttpTransport transport;
    private final Duration ttl;
    private final Clock clock;
    private final Duration minMissRefreshInterval;

    private JWKSet cachedSet;
    private Instant fetchedAt = Instant.EPOCH;
    private Instant lastMissRefreshAt = Instant.EPOCH;

    public JwksCache(String jwksUri, HttpTransport transport, Duration ttl, Clock clock) {
        this(jwksUri, transport, ttl, clock, DEFAULT_MIN_MISS_REFRESH_INTERVAL);
    }

    public JwksCache(String jwksUri, HttpTransport transport, Duration ttl, Clock clock,
                      Duration minMissRefreshInterval) {
        this.jwksUri = jwksUri;
        this.transport = transport;
        this.ttl = ttl;
        this.clock = clock;
        this.minMissRefreshInterval = minMissRefreshInterval;
    }

    /**
     * Resolves the RSA public key for a {@code kid}.
     *
     * @throws TokenValidationException if no such key exists in the (possibly refreshed) JWKS —
     *                                   this is caller input, not an infrastructure failure
     * @throws IdenplaneClientException if the JWKS itself can't be fetched or parsed
     */
    public synchronized RSAPublicKey getRsaPublicKey(String keyId) {
        if (cachedSet == null || isStale(fetchedAt, ttl)) {
            refresh();
        }
        RSAPublicKey key = resolve(keyId);
        if (key != null) {
            return key;
        }
        if (isStale(lastMissRefreshAt, minMissRefreshInterval)) {
            refresh();
            lastMissRefreshAt = clock.instant();
            key = resolve(keyId);
        }
        if (key == null) {
            throw new TokenValidationException("No signing key found for kid=" + keyId);
        }
        return key;
    }

    private boolean isStale(Instant since, Duration duration) {
        return Duration.between(since, clock.instant()).compareTo(duration) >= 0;
    }

    private RSAPublicKey resolve(String keyId) {
        JWK jwk = cachedSet.getKeyByKeyId(keyId);
        if (!(jwk instanceof RSAKey)) {
            return null;
        }
        try {
            return ((RSAKey) jwk).toRSAPublicKey();
        } catch (JOSEException e) {
            throw new IdenplaneClientException("Failed to build RSA public key for kid=" + keyId, e);
        }
    }

    private void refresh() {
        String json = transport.get(jwksUri);
        try {
            cachedSet = JWKSet.parse(json);
        } catch (ParseException e) {
            throw new IdenplaneClientException("Failed to parse JWKS from " + jwksUri, e);
        }
        fetchedAt = clock.instant();
    }
}
