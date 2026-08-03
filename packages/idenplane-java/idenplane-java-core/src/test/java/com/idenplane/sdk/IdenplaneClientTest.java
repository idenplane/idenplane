package com.idenplane.sdk;

import com.idenplane.sdk.models.TokenClaims;
import com.idenplane.sdk.models.TokenResponse;
import com.idenplane.sdk.models.UserInfo;
import com.nimbusds.jwt.JWTClaimsSet;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class IdenplaneClientTest {

    private static final String ISSUER = "https://idenplane.test/realms/test-realm";
    private static final String CLIENT_ID = "my-client";
    private static final String AUTHORIZATION_ENDPOINT = ISSUER + "/protocol/openid-connect/auth";
    private static final String TOKEN_ENDPOINT = ISSUER + "/protocol/openid-connect/token";
    private static final String USERINFO_ENDPOINT = ISSUER + "/protocol/openid-connect/userinfo";
    private static final String JWKS_URI = ISSUER + "/protocol/openid-connect/certs";
    private static final String END_SESSION_ENDPOINT = ISSUER + "/protocol/openid-connect/logout";
    private static final String DISCOVERY_URL = ISSUER + "/.well-known/openid-configuration";

    private static final Instant NOW = Instant.parse("2026-08-03T12:00:00Z");

    private TestTokens signingKey;
    private FakeHttpTransport transport;
    private IdenplaneClient client;

    @BeforeEach
    void setUp() {
        signingKey = TestTokens.generate();
        transport = new FakeHttpTransport()
                .withGetResponse(DISCOVERY_URL, discoveryJson())
                .withGetResponse(JWKS_URI, signingKey.jwksJson());
        client = IdenplaneClient.builder(ISSUER, CLIENT_ID)
                .transport(transport)
                .clock(Clock.fixed(NOW, ZoneOffset.UTC))
                .build();
    }

    private static String discoveryJson() {
        return "{"
                + "\"issuer\":\"" + ISSUER + "\","
                + "\"authorization_endpoint\":\"" + AUTHORIZATION_ENDPOINT + "\","
                + "\"token_endpoint\":\"" + TOKEN_ENDPOINT + "\","
                + "\"userinfo_endpoint\":\"" + USERINFO_ENDPOINT + "\","
                + "\"jwks_uri\":\"" + JWKS_URI + "\","
                + "\"end_session_endpoint\":\"" + END_SESSION_ENDPOINT + "\""
                + "}";
    }

    private JWTClaimsSet.Builder baseClaims(String typ, long expEpochSeconds) {
        return new JWTClaimsSet.Builder()
                .claim("iss", ISSUER)
                .claim("sub", "user-123")
                .claim("aud", CLIENT_ID)
                .claim("azp", CLIENT_ID)
                .claim("sid", "session-abc")
                .claim("typ", typ)
                .claim("iat", NOW.getEpochSecond())
                .claim("exp", expEpochSeconds);
    }

    private String validAccessToken() {
        JWTClaimsSet claims = baseClaims("Bearer", NOW.plusSeconds(300).getEpochSecond())
                .claim("scope", "openid profile email")
                .claim("realm_access", Map.of("roles", List.of("user", "admin")))
                .claim("resource_access", Map.of(CLIENT_ID, Map.of("roles", List.of("viewer"))))
                .build();
        return signingKey.sign(claims);
    }

    private String validIdToken() {
        JWTClaimsSet claims = baseClaims("ID", NOW.plusSeconds(300).getEpochSecond())
                .claim("auth_time", NOW.getEpochSecond())
                .claim("name", "Ada Lovelace")
                .claim("email", "ada@example.com")
                .build();
        return signingKey.sign(claims);
    }

    @Test
    void discover_parsesDiscoveryDocument() {
        var config = client.discover();

        assertThat(config.getIssuer()).isEqualTo(ISSUER);
        assertThat(config.getAuthorizationEndpoint()).isEqualTo(AUTHORIZATION_ENDPOINT);
        assertThat(config.getTokenEndpoint()).isEqualTo(TOKEN_ENDPOINT);
        assertThat(config.getJwksUri()).isEqualTo(JWKS_URI);
    }

    @Test
    void discover_isCachedAcrossCalls() {
        client.discover();
        client.discover();

        assertThat(transport.requestedGetUrls).filteredOn(DISCOVERY_URL::equals).hasSize(1);
    }

    @Test
    void validateAccessToken_succeedsForValidTokenAndExposesRoles() {
        TokenClaims claims = client.validateAccessToken(validAccessToken());

        assertThat(claims.getSub()).isEqualTo("user-123");
        assertThat(claims.getAudAsString()).isEqualTo(CLIENT_ID);
        assertThat(claims.getTyp()).isEqualTo("Bearer");
        assertThat(claims.getRealmRoles()).containsExactlyInAnyOrder("user", "admin");
        assertThat(claims.getResourceRoles(CLIENT_ID)).containsExactly("viewer");
    }

    @Test
    void validateIdToken_succeedsForValidToken() {
        TokenClaims claims = client.validateIdToken(validIdToken());

        assertThat(claims.getSub()).isEqualTo("user-123");
        assertThat(claims.getTyp()).isEqualTo("ID");
        assertThat(claims.getName()).isEqualTo("Ada Lovelace");
        assertThat(claims.getEmail()).isEqualTo("ada@example.com");
    }

    @Test
    void validateAccessToken_rejectsAnIdTokenPresentedAsAccessToken() {
        String idToken = validIdToken();

        assertThatThrownBy(() -> client.validateAccessToken(idToken))
                .isInstanceOf(TokenValidationException.class)
                .hasMessageContaining("typ=Bearer");
    }

    @Test
    void validateIdToken_rejectsAnAccessTokenPresentedAsIdToken() {
        String accessToken = validAccessToken();

        assertThatThrownBy(() -> client.validateIdToken(accessToken))
                .isInstanceOf(TokenValidationException.class)
                .hasMessageContaining("typ=ID");
    }

    @Test
    void validate_rejectsExpiredToken() {
        String expired = signingKey.sign(baseClaims("Bearer", NOW.minusSeconds(600).getEpochSecond()).build());

        assertThatThrownBy(() -> client.validateAccessToken(expired))
                .isInstanceOf(TokenValidationException.class)
                .hasMessageContaining("expired");
    }

    @Test
    void validate_toleratesClockSkewWithinBounds() {
        // Expired 30s ago — inside the 60s clock-skew tolerance, so this must still pass.
        String barelyExpired = signingKey.sign(
                baseClaims("Bearer", NOW.minusSeconds(30).getEpochSecond()).build());

        assertThat(client.validateAccessToken(barelyExpired)).isNotNull();
    }

    @Test
    void validate_rejectsWrongIssuer() {
        JWTClaimsSet claims = baseClaims("Bearer", NOW.plusSeconds(300).getEpochSecond())
                .claim("iss", "https://not-the-real-issuer.example.com/realms/other")
                .build();
        String token = signingKey.sign(claims);

        assertThatThrownBy(() -> client.validateAccessToken(token))
                .isInstanceOf(TokenValidationException.class)
                .hasMessageContaining("issuer");
    }

    @Test
    void validate_rejectsWrongAudience() {
        JWTClaimsSet claims = baseClaims("Bearer", NOW.plusSeconds(300).getEpochSecond())
                .claim("aud", "some-other-client")
                .build();
        String token = signingKey.sign(claims);

        assertThatThrownBy(() -> client.validateAccessToken(token))
                .isInstanceOf(TokenValidationException.class)
                .hasMessageContaining("audience");
    }

    @Test
    void validate_rejectsTokenSignedWithAnUnrelatedKey() {
        TestTokens attackerKey = TestTokens.generate();
        JWTClaimsSet claims = baseClaims("Bearer", NOW.plusSeconds(300).getEpochSecond()).build();
        // Header kid matches the real signing key's kid (as registered in the realm's JWKS),
        // but the signature itself is produced by a different, attacker-controlled key.
        String forged = signingKey.signWithMismatchedKey(claims, attackerKey);

        assertThatThrownBy(() -> client.validateAccessToken(forged))
                .isInstanceOf(TokenValidationException.class)
                .hasMessageContaining("signature");
    }

    @Test
    void validate_rejectsMalformedJwt() {
        assertThatThrownBy(() -> client.validateAccessToken("not-a-jwt"))
                .isInstanceOf(TokenValidationException.class);
    }

    @Test
    void jwksCacheMiss_refreshesOnceAndRecoversFromKeyRotation() {
        TestTokens rotatedKey = TestTokens.generate();
        // The client's cache is warmed with only the old key; the token below is signed with a
        // key that only shows up in the JWKS *after* rotation.
        transport.withGetResponses(JWKS_URI, signingKey.jwksJson(), rotatedKey.jwksJson());
        JWTClaimsSet claims = baseClaims("Bearer", NOW.plusSeconds(300).getEpochSecond()).build();
        String tokenFromRotatedKey = rotatedKey.sign(claims);

        TokenClaims validated = client.validateAccessToken(tokenFromRotatedKey);

        assertThat(validated.getSub()).isEqualTo("user-123");
        assertThat(transport.requestedGetUrls).filteredOn(JWKS_URI::equals).hasSize(2);
    }

    @Test
    void jwksCacheMiss_failsAfterOneRefreshIfKeyStillUnknown() {
        JWTClaimsSet claims = baseClaims("Bearer", NOW.plusSeconds(300).getEpochSecond()).build();
        String tokenFromUnknownKey = TestTokens.generate().sign(claims);

        // TokenValidationException, not IdenplaneClientException: an unresolvable kid is bad
        // caller input (a 401-shaped problem), not an infrastructure failure — a caller that
        // maps TokenValidationException to 401 and everything else to 500 must get this right.
        assertThatThrownBy(() -> client.validateAccessToken(tokenFromUnknownKey))
                .isInstanceOf(TokenValidationException.class)
                .hasMessageContaining("No signing key found");
    }

    @Test
    void jwksCacheMiss_isRateLimitedAcrossRepeatedMisses() {
        JWTClaimsSet claims = baseClaims("Bearer", NOW.plusSeconds(300).getEpochSecond()).build();
        String tokenFromUnknownKey = TestTokens.generate().sign(claims);

        assertThatThrownBy(() -> client.validateAccessToken(tokenFromUnknownKey))
                .isInstanceOf(TokenValidationException.class);
        long jwksCallsAfterFirstMiss = transport.requestedGetUrls.stream().filter(JWKS_URI::equals).count();

        assertThatThrownBy(() -> client.validateAccessToken(tokenFromUnknownKey))
                .isInstanceOf(TokenValidationException.class);
        long jwksCallsAfterSecondMiss = transport.requestedGetUrls.stream().filter(JWKS_URI::equals).count();

        // The clock never advances in this test, so the second miss must NOT trigger another
        // JWKS fetch — otherwise an attacker could force unlimited outbound requests to the
        // realm's own JWKS endpoint just by sending many distinct unknown kids.
        assertThat(jwksCallsAfterSecondMiss).isEqualTo(jwksCallsAfterFirstMiss);
    }

    @Test
    void validate_rejectsTokenWithUnexpectedAlgorithm() {
        JWTClaimsSet claims = baseClaims("Bearer", NOW.plusSeconds(300).getEpochSecond()).build();
        // Still a cryptographically valid RSA signature from the real key — RSASSAVerifier alone
        // would accept RS384, so this specifically exercises the explicit alg pin, not signature
        // verification.
        String token = signingKey.signWithAlgorithm(claims, com.nimbusds.jose.JWSAlgorithm.RS384);

        assertThatThrownBy(() -> client.validateAccessToken(token))
                .isInstanceOf(TokenValidationException.class)
                .hasMessageContaining("algorithm");
    }

    @Test
    void buildAuthorizationUrl_includesRequiredPkceAndOidcParams() {
        String url = client.buildAuthorizationUrl(
                "https://app.example.com/callback", "xyz-state", "abc-challenge", List.of("email"));

        assertThat(url).startsWith(AUTHORIZATION_ENDPOINT + "?");
        assertThat(url).contains("response_type=code");
        assertThat(url).contains("client_id=" + CLIENT_ID);
        assertThat(url).contains("redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback");
        assertThat(url).contains("scope=openid+email");
        assertThat(url).contains("state=xyz-state");
        assertThat(url).contains("code_challenge=abc-challenge");
        assertThat(url).contains("code_challenge_method=S256");
    }

    @Test
    void buildAuthorizationUrl_doesNotDuplicateOpenidScope() {
        String url = client.buildAuthorizationUrl("https://app.example.com/callback", "s", "c",
                List.of("openid", "email"));

        String scopeParam = Arrays.stream(url.split("[?&]"))
                .filter(param -> param.startsWith("scope="))
                .findFirst()
                .orElseThrow();
        assertThat(scopeParam).isEqualTo("scope=openid+email");
    }

    @Test
    void exchangeAuthorizationCode_postsExpectedFormAndParsesResponse() {
        transport.withPostResponse(TOKEN_ENDPOINT, "{"
                + "\"access_token\":\"at-123\","
                + "\"token_type\":\"Bearer\","
                + "\"expires_in\":300,"
                + "\"refresh_token\":\"rt-456\","
                + "\"id_token\":\"idtok-789\""
                + "}");

        TokenResponse response = client.exchangeAuthorizationCode("auth-code", "https://app.example.com/cb", "verifier-1");

        assertThat(response.getAccessToken()).isEqualTo("at-123");
        assertThat(response.getRefreshToken()).isEqualTo("rt-456");
        assertThat(response.getIdToken()).isEqualTo("idtok-789");
        Map<String, String> form = transport.postedForms.get(0);
        assertThat(form).containsEntry("grant_type", "authorization_code");
        assertThat(form).containsEntry("code", "auth-code");
        assertThat(form).containsEntry("code_verifier", "verifier-1");
        assertThat(form).doesNotContainKey("client_secret");
    }

    @Test
    void exchangeAuthorizationCode_includesClientSecretForConfidentialClients() {
        IdenplaneClient confidentialClient = IdenplaneClient.builder(ISSUER, CLIENT_ID)
                .clientSecret("shh-secret")
                .transport(transport)
                .clock(Clock.fixed(NOW, ZoneOffset.UTC))
                .build();
        transport.withPostResponse(TOKEN_ENDPOINT, "{\"access_token\":\"at\",\"token_type\":\"Bearer\",\"expires_in\":300}");

        confidentialClient.exchangeAuthorizationCode("code", "https://app.example.com/cb", "verifier");

        assertThat(transport.postedForms.get(0)).containsEntry("client_secret", "shh-secret");
    }

    @Test
    void refreshToken_postsRefreshTokenGrant() {
        transport.withPostResponse(TOKEN_ENDPOINT, "{\"access_token\":\"new-at\",\"token_type\":\"Bearer\",\"expires_in\":300}");

        TokenResponse response = client.refreshToken("old-refresh-token");

        assertThat(response.getAccessToken()).isEqualTo("new-at");
        assertThat(transport.postedForms.get(0)).containsEntry("grant_type", "refresh_token");
        assertThat(transport.postedForms.get(0)).containsEntry("refresh_token", "old-refresh-token");
    }

    @Test
    void getUserInfo_sendsBearerTokenAndParsesProfile() {
        transport.withGetResponse(USERINFO_ENDPOINT, "{"
                + "\"sub\":\"user-123\",\"preferred_username\":\"ada\",\"email\":\"ada@example.com\""
                + "}");

        UserInfo userInfo = client.getUserInfo("some-access-token");

        assertThat(userInfo.getSub()).isEqualTo("user-123");
        assertThat(userInfo.getPreferredUsername()).isEqualTo("ada");
        assertThat(transport.lastBearerToken).isEqualTo("some-access-token");
    }

    @Test
    void buildLogoutUrl_includesHintAndRedirect() {
        String url = client.buildLogoutUrl("id-token-value", "https://app.example.com/bye");

        assertThat(url).startsWith(END_SESSION_ENDPOINT + "?");
        assertThat(url).contains("id_token_hint=id-token-value");
        assertThat(url).contains("post_logout_redirect_uri=https%3A%2F%2Fapp.example.com%2Fbye");
    }

    @Test
    void buildLogoutUrl_omitsNullParams() {
        String url = client.buildLogoutUrl(null, null);

        assertThat(url).isEqualTo(END_SESSION_ENDPOINT);
    }
}
