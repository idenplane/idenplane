package com.idenplane.sdk;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.idenplane.sdk.internal.ApacheHttpTransport;
import com.idenplane.sdk.internal.HttpTransport;
import com.idenplane.sdk.internal.JwksCache;
import com.idenplane.sdk.models.OpenIDConfiguration;
import com.idenplane.sdk.models.TokenClaims;
import com.idenplane.sdk.models.TokenResponse;
import com.idenplane.sdk.models.UserInfo;
import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jwt.SignedJWT;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.interfaces.RSAPublicKey;
import java.text.ParseException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Client for the OIDC/OAuth2 surface exposed by an Idenplane realm: discovery, JWKS-backed
 * token validation, the Authorization Code + PKCE flow, token refresh, user info, and logout.
 *
 * <p>An instance is safe to reuse and share across requests — the discovery document and JWKS
 * keys are cached internally and refreshed on expiry or on a JWKS cache miss (key rotation).
 *
 * <pre>{@code
 * IdenplaneClient client = IdenplaneClient.builder(
 *         "https://idenplane.example.com/realms/my-realm", "my-client-id")
 *     .build();
 *
 * String verifier = PkceUtil.generateCodeVerifier();
 * String challenge = PkceUtil.deriveCodeChallenge(verifier);
 * String authorizeUrl = client.buildAuthorizationUrl(redirectUri, state, challenge, List.of());
 * // ... redirect the user, receive `code` back at redirectUri ...
 * TokenResponse tokens = client.exchangeAuthorizationCode(code, redirectUri, verifier);
 * TokenClaims claims = client.validateIdToken(tokens.getIdToken());
 * }</pre>
 */
public final class IdenplaneClient {

    private static final Duration DEFAULT_DISCOVERY_TTL = Duration.ofHours(1);
    private static final Duration DEFAULT_JWKS_TTL = Duration.ofMinutes(15);
    // Tolerates small clock differences between the token issuer and this JVM, matching the
    // 60s default used by most mainstream OIDC client libraries.
    private static final Duration CLOCK_SKEW = Duration.ofSeconds(60);

    private final String issuer;
    private final String clientId;
    private final String clientSecret;
    private final HttpTransport transport;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final Clock clock;
    private final Duration discoveryTtl;

    private OpenIDConfiguration discoveryCache;
    private Instant discoveryFetchedAt = Instant.EPOCH;
    private JwksCache jwksCache;

    private IdenplaneClient(Builder builder) {
        this.issuer = stripTrailingSlash(Objects.requireNonNull(builder.issuer, "issuer is required"));
        this.clientId = Objects.requireNonNull(builder.clientId, "clientId is required");
        this.clientSecret = builder.clientSecret;
        this.transport = builder.transport != null ? builder.transport : new ApacheHttpTransport();
        this.clock = builder.clock != null ? builder.clock : Clock.systemUTC();
        this.discoveryTtl = builder.discoveryTtl != null ? builder.discoveryTtl : DEFAULT_DISCOVERY_TTL;
    }

    /**
     * Starts building a client for a realm.
     *
     * @param issuer   the realm issuer URL, e.g. {@code https://host/realms/my-realm}
     *                 (matches the {@code iss} claim on tokens issued by that realm)
     * @param clientId the OAuth2 client ID registered in that realm
     * @return a new builder
     */
    public static Builder builder(String issuer, String clientId) {
        return new Builder(issuer, clientId);
    }

    /**
     * Fetches (and caches) the realm's OIDC discovery document.
     *
     * @return the discovery document
     */
    public synchronized OpenIDConfiguration discover() {
        if (discoveryCache == null || isStale(discoveryFetchedAt, discoveryTtl)) {
            String json = transport.get(issuer + "/.well-known/openid-configuration");
            try {
                discoveryCache = objectMapper.readValue(json, OpenIDConfiguration.class);
            } catch (Exception e) {
                throw new IdenplaneClientException("Failed to parse discovery document from " + issuer, e);
            }
            discoveryFetchedAt = clock.instant();
        }
        return discoveryCache;
    }

    /**
     * Validates an ID token: verifies its RS256 signature against the realm's JWKS, then checks
     * expiry, issuer, audience, and that it really is an ID token (not an access token).
     *
     * @param idToken the raw ID token JWT
     * @return the validated claims
     * @throws TokenValidationException if the signature or any claim check fails
     */
    public TokenClaims validateIdToken(String idToken) {
        TokenClaims claims = validate(idToken);
        if (!"ID".equals(claims.getTyp())) {
            throw new TokenValidationException("Expected an ID token (typ=ID), got typ=" + claims.getTyp());
        }
        return claims;
    }

    /**
     * Validates an access token: verifies its RS256 signature against the realm's JWKS, then
     * checks expiry, issuer, audience, and that it really is an access token (not an ID token).
     *
     * @param accessToken the raw access token JWT
     * @return the validated claims
     * @throws TokenValidationException if the signature or any claim check fails
     */
    public TokenClaims validateAccessToken(String accessToken) {
        TokenClaims claims = validate(accessToken);
        if (!"Bearer".equals(claims.getTyp())) {
            throw new TokenValidationException("Expected an access token (typ=Bearer), got typ=" + claims.getTyp());
        }
        return claims;
    }

    /**
     * Builds the Authorization Code + PKCE authorization URL to redirect the user-agent to.
     *
     * @param redirectUri   the registered redirect URI
     * @param state         an opaque value echoed back on the callback — the caller must
     *                      generate it randomly and verify it matches, to mitigate CSRF
     * @param codeChallenge the S256 PKCE code challenge, see {@link PkceUtil#deriveCodeChallenge}
     * @param scopes        additional requested scopes; {@code openid} is always included
     * @return the fully-formed authorization URL
     */
    public String buildAuthorizationUrl(String redirectUri, String state, String codeChallenge, List<String> scopes) {
        List<String> effectiveScopes = new ArrayList<>();
        effectiveScopes.add("openid");
        if (scopes != null) {
            for (String scope : scopes) {
                if (!effectiveScopes.contains(scope)) {
                    effectiveScopes.add(scope);
                }
            }
        }
        Map<String, String> params = new LinkedHashMap<>();
        params.put("response_type", "code");
        params.put("client_id", clientId);
        params.put("redirect_uri", redirectUri);
        params.put("scope", String.join(" ", effectiveScopes));
        params.put("state", state);
        params.put("code_challenge", codeChallenge);
        params.put("code_challenge_method", "S256");
        return buildUrl(discover().getAuthorizationEndpoint(), params);
    }

    /**
     * Exchanges an authorization code for tokens (Authorization Code + PKCE flow).
     *
     * @param code         the authorization code returned to the redirect URI
     * @param redirectUri  the same redirect URI passed to {@link #buildAuthorizationUrl}
     * @param codeVerifier the PKCE code verifier that produced the original code challenge
     * @return the token response
     */
    public TokenResponse exchangeAuthorizationCode(String code, String redirectUri, String codeVerifier) {
        Map<String, String> form = new LinkedHashMap<>();
        form.put("grant_type", "authorization_code");
        form.put("client_id", clientId);
        form.put("code", code);
        form.put("redirect_uri", redirectUri);
        form.put("code_verifier", codeVerifier);
        addClientSecretIfPresent(form);
        return postForToken(form);
    }

    /**
     * Exchanges a refresh token for a new token response.
     *
     * @param refreshToken a refresh token previously issued to this client
     * @return the new token response
     */
    public TokenResponse refreshToken(String refreshToken) {
        Map<String, String> form = new LinkedHashMap<>();
        form.put("grant_type", "refresh_token");
        form.put("client_id", clientId);
        form.put("refresh_token", refreshToken);
        addClientSecretIfPresent(form);
        return postForToken(form);
    }

    /**
     * Retrieves the authenticated user's profile from the realm's userinfo endpoint.
     *
     * @param accessToken a valid access token
     * @return the user's profile information
     */
    public UserInfo getUserInfo(String accessToken) {
        String json = transport.getWithBearerToken(discover().getUserinfoEndpoint(), accessToken);
        try {
            return objectMapper.readValue(json, UserInfo.class);
        } catch (Exception e) {
            throw new IdenplaneClientException("Failed to parse userinfo response", e);
        }
    }

    /**
     * Builds a logout (end-session) URL. Only meaningful if the realm's discovery document
     * advertises an {@code end_session_endpoint}.
     *
     * @param idTokenHint            the ID token issued at login, hinting who is logging out;
     *                               may be {@code null}
     * @param postLogoutRedirectUri  where to redirect the user after logout; may be {@code null}
     * @return the end-session URL
     * @throws IdenplaneClientException if the realm has no {@code end_session_endpoint}
     */
    public String buildLogoutUrl(String idTokenHint, String postLogoutRedirectUri) {
        String endSessionEndpoint = discover().getEndSessionEndpoint();
        if (endSessionEndpoint == null) {
            throw new IdenplaneClientException("This realm does not advertise an end_session_endpoint");
        }
        Map<String, String> params = new LinkedHashMap<>();
        if (idTokenHint != null) {
            params.put("id_token_hint", idTokenHint);
        }
        if (postLogoutRedirectUri != null) {
            params.put("post_logout_redirect_uri", postLogoutRedirectUri);
        }
        return buildUrl(endSessionEndpoint, params);
    }

    private TokenClaims validate(String jwt) {
        SignedJWT signedJwt;
        try {
            signedJwt = SignedJWT.parse(jwt);
        } catch (ParseException e) {
            throw new TokenValidationException("Malformed JWT", e);
        }

        // Pinned rather than accepted from the token: RSASSAVerifier alone would happily accept
        // RS384/RS512/PS256/etc, and this realm only ever issues RS256 (see auth.service.ts /
        // jwk.service.ts). Not pinning this wouldn't allow a signature bypass here, but it's
        // exactly the kind of "he server changed, the client silently widened" gap OIDC Core
        // 3.1.3.7 (verify alg matches what was negotiated) exists to close.
        if (!JWSAlgorithm.RS256.equals(signedJwt.getHeader().getAlgorithm())) {
            throw new TokenValidationException(
                    "Unexpected JWS algorithm: " + signedJwt.getHeader().getAlgorithm());
        }

        String keyId = signedJwt.getHeader().getKeyID();
        if (keyId == null) {
            throw new TokenValidationException("JWT header is missing 'kid'");
        }
        RSAPublicKey publicKey = jwks().getRsaPublicKey(keyId);

        boolean signatureValid;
        try {
            signatureValid = signedJwt.verify(new RSASSAVerifier(publicKey));
        } catch (JOSEException e) {
            throw new TokenValidationException("Signature verification failed", e);
        }
        if (!signatureValid) {
            throw new TokenValidationException("Invalid token signature");
        }

        TokenClaims claims;
        try {
            claims = objectMapper.readValue(signedJwt.getPayload().toString(), TokenClaims.class);
        } catch (Exception e) {
            throw new TokenValidationException("Failed to parse token claims", e);
        }

        Instant now = clock.instant();
        if (claims.getExp() == 0 || Instant.ofEpochSecond(claims.getExp()).plus(CLOCK_SKEW).isBefore(now)) {
            throw new TokenValidationException("Token has expired");
        }
        if (claims.getIat() != 0 && Instant.ofEpochSecond(claims.getIat()).minus(CLOCK_SKEW).isAfter(now)) {
            throw new TokenValidationException("Token issued-at claim is in the future");
        }
        if (!issuer.equals(claims.getIss())) {
            throw new TokenValidationException("Unexpected issuer: " + claims.getIss());
        }
        // The server only ever issues a single string audience equal to the client ID (never an
        // array) — see auth.service.ts. getAudAsString() also handles the array case defensively
        // in case that changes, but a plain equality check is the correct match for today's shape.
        if (!clientId.equals(claims.getAudAsString())) {
            throw new TokenValidationException("Unexpected audience: " + claims.getAudAsString());
        }

        return claims;
    }

    private JwksCache jwks() {
        if (jwksCache == null) {
            jwksCache = new JwksCache(discover().getJwksUri(), transport, DEFAULT_JWKS_TTL, clock);
        }
        return jwksCache;
    }

    private boolean isStale(Instant fetchedAt, Duration ttl) {
        return Duration.between(fetchedAt, clock.instant()).compareTo(ttl) >= 0;
    }

    private void addClientSecretIfPresent(Map<String, String> form) {
        if (clientSecret != null) {
            form.put("client_secret", clientSecret);
        }
    }

    private TokenResponse postForToken(Map<String, String> form) {
        String json = transport.postForm(discover().getTokenEndpoint(), form);
        try {
            return objectMapper.readValue(json, TokenResponse.class);
        } catch (Exception e) {
            throw new IdenplaneClientException("Failed to parse token response", e);
        }
    }

    private static String buildUrl(String base, Map<String, String> params) {
        StringBuilder query = new StringBuilder();
        for (Map.Entry<String, String> entry : params.entrySet()) {
            if (entry.getValue() == null) {
                continue;
            }
            if (query.length() > 0) {
                query.append('&');
            }
            query.append(urlEncode(entry.getKey())).append('=').append(urlEncode(entry.getValue()));
        }
        if (query.length() == 0) {
            return base;
        }
        return base + (base.contains("?") ? '&' : '?') + query;
    }

    private static String urlEncode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private static String stripTrailingSlash(String url) {
        return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
    }

    /**
     * Builder for {@link IdenplaneClient}.
     */
    public static final class Builder {
        private final String issuer;
        private final String clientId;
        private String clientSecret;
        private HttpTransport transport;
        private Clock clock;
        private Duration discoveryTtl;

        private Builder(String issuer, String clientId) {
            this.issuer = issuer;
            this.clientId = clientId;
        }

        /**
         * Sets the client secret, for confidential clients. Public/native clients (mobile, SPA)
         * should omit this and rely on PKCE alone.
         */
        public Builder clientSecret(String clientSecret) {
            this.clientSecret = clientSecret;
            return this;
        }

        /**
         * Overrides the HTTP transport. Intended for tests; production code should leave this
         * unset to use the default Apache HttpClient 5-backed transport.
         */
        public Builder transport(HttpTransport transport) {
            this.transport = transport;
            return this;
        }

        /**
         * Overrides the clock used for token expiry and cache TTL checks. Intended for tests.
         */
        public Builder clock(Clock clock) {
            this.clock = clock;
            return this;
        }

        /**
         * Overrides how long the discovery document is cached before being refetched.
         */
        public Builder discoveryTtl(Duration discoveryTtl) {
            this.discoveryTtl = discoveryTtl;
            return this;
        }

        public IdenplaneClient build() {
            return new IdenplaneClient(this);
        }
    }
}
