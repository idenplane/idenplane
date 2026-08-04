package com.idenplane.sdk.reactive;

import com.idenplane.sdk.IdenplaneClient;
import com.idenplane.sdk.TokenValidationException;
import com.idenplane.sdk.models.TokenClaims;
import com.idenplane.sdk.models.TokenResponse;
import com.idenplane.sdk.models.UserInfo;
import com.nimbusds.jwt.JWTClaimsSet;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import reactor.core.scheduler.Schedulers;
import reactor.test.StepVerifier;

import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

class ReactiveIdenplaneClientTest {

    private static final String CLIENT_ID = "my-client";

    private ReactiveTestTokens tokens;
    private LocalOidcServer oidc;
    private ReactiveIdenplaneClient reactiveClient;

    @BeforeEach
    void setUp() throws Exception {
        tokens = ReactiveTestTokens.generate();
        oidc = LocalOidcServer.start(tokens);
        IdenplaneClient client = IdenplaneClient.builder(oidc.issuer, CLIENT_ID).build();
        // Schedulers.immediate() runs "blocking" calls synchronously on the test thread, so
        // StepVerifier assertions don't need to deal with cross-thread timing — this still
        // exercises the Mono.fromCallable wrapping and error-propagation logic for real.
        reactiveClient = ReactiveIdenplaneClient.wrap(client, Schedulers.immediate());
    }

    @AfterEach
    void tearDown() {
        oidc.close();
    }

    @Test
    void discover_emitsConfiguration() {
        StepVerifier.create(reactiveClient.discover())
                .assertNext(config -> assertThat(config.getIssuer()).isEqualTo(oidc.issuer))
                .verifyComplete();
    }

    @Test
    void validateAccessToken_emitsClaimsForValidToken() {
        String token = tokens.sign(validClaims("Bearer"));

        StepVerifier.create(reactiveClient.validateAccessToken(token))
                .assertNext(claims -> assertThat(claims.getSub()).isEqualTo("user-123"))
                .verifyComplete();
    }

    @Test
    void validateAccessToken_propagatesValidationErrorForExpiredToken() {
        JWTClaimsSet expired = new JWTClaimsSet.Builder()
                .claim("iss", oidc.issuer)
                .claim("sub", "user-123")
                .claim("aud", CLIENT_ID)
                .claim("typ", "Bearer")
                .issueTime(Date.from(Instant.now().minusSeconds(1200)))
                .expirationTime(Date.from(Instant.now().minusSeconds(600)))
                .build();
        String token = tokens.sign(expired);

        StepVerifier.create(reactiveClient.validateAccessToken(token))
                .expectError(TokenValidationException.class)
                .verify();
    }

    @Test
    void validateIdToken_emitsClaimsForValidToken() {
        String token = tokens.sign(validClaims("ID"));

        StepVerifier.create(reactiveClient.validateIdToken(token))
                .assertNext(claims -> assertThat(claims.getTyp()).isEqualTo("ID"))
                .verifyComplete();
    }

    @Test
    void exchangeAuthorizationCode_emitsTokenResponse() {
        StepVerifier.create(reactiveClient.exchangeAuthorizationCode("code", "https://app.example.com/cb", "verifier"))
                .assertNext((TokenResponse response) -> assertThat(response.getAccessToken()).isEqualTo("at-123"))
                .verifyComplete();
    }

    @Test
    void refreshToken_emitsTokenResponse() {
        StepVerifier.create(reactiveClient.refreshToken("old-refresh-token"))
                .assertNext((TokenResponse response) -> assertThat(response.getAccessToken()).isEqualTo("at-123"))
                .verifyComplete();
    }

    @Test
    void getUserInfo_emitsUserInfo() {
        StepVerifier.create(reactiveClient.getUserInfo("some-access-token"))
                .assertNext((UserInfo info) -> assertThat(info.getPreferredUsername()).isEqualTo("ada"))
                .verifyComplete();
    }

    @Test
    void buildAuthorizationUrl_emitsUrlContainingExpectedParams() {
        StepVerifier.create(reactiveClient.buildAuthorizationUrl(
                        "https://app.example.com/cb", "state-1", "challenge-1", List.of()))
                .assertNext(url -> {
                    assertThat(url).contains("response_type=code");
                    assertThat(url).contains("client_id=" + CLIENT_ID);
                })
                .verifyComplete();
    }

    @Test
    void buildLogoutUrl_emitsUrl() {
        StepVerifier.create(reactiveClient.buildLogoutUrl("id-token", "https://app.example.com/bye"))
                .assertNext(url -> assertThat(url).contains("id_token_hint=id-token"))
                .verifyComplete();
    }

    @Test
    void defaultWrap_runsOffTheCallingThread() throws Exception {
        IdenplaneClient client = IdenplaneClient.builder(oidc.issuer, CLIENT_ID).build();
        ReactiveIdenplaneClient defaultClient = ReactiveIdenplaneClient.wrap(client);
        String callingThread = Thread.currentThread().getName();
        AtomicReference<String> executionThread = new AtomicReference<>();

        StepVerifier.create(defaultClient.discover().doOnNext(config -> executionThread.set(Thread.currentThread().getName())))
                .expectNextCount(1)
                .verifyComplete();

        assertThat(executionThread.get()).isNotEqualTo(callingThread);
    }

    private JWTClaimsSet validClaims(String typ) {
        return new JWTClaimsSet.Builder()
                .claim("iss", oidc.issuer)
                .claim("sub", "user-123")
                .claim("aud", CLIENT_ID)
                .claim("typ", typ)
                .issueTime(Date.from(Instant.now()))
                .expirationTime(Date.from(Instant.now().plusSeconds(300)))
                .build();
    }
}
