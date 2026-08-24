package com.idenplane.sdk.samples.spring;

import com.nimbusds.jwt.JWTClaimsSet;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.autoconfigure.AutoConfigureRestTestClient;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.client.RestTestClient;

import java.io.IOException;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * End-to-end smoke test: a real embedded servlet container, the real Spring Security filter
 * chain, and a real local OIDC server — proving idenplane-java-spring's auto-configuration
 * actually protects an endpoint and maps roles, not just that the app context loads.
 *
 * <p>Uses {@link RestTestClient} rather than {@code TestRestTemplate}: Spring Boot 4 no longer
 * contributes a web test client from {@code @SpringBootTest} alone, and points at
 * {@code RestTestClient} as the replacement. It is bound to the running server by
 * {@link AutoConfigureRestTestClient}, so there is no port to inject or URL to assemble here.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureRestTestClient
class SpringBootSampleApplicationTests {

    private static final String CLIENT_ID = "my-spring-app";

    private static SampleTestTokens tokens;
    private static LocalOidcServer oidc;

    @DynamicPropertySource
    static void idenplaneProperties(DynamicPropertyRegistry registry) throws IOException {
        tokens = SampleTestTokens.generate();
        oidc = LocalOidcServer.start(tokens);
        registry.add("idenplane.issuer-uri", () -> oidc.issuer);
        registry.add("idenplane.client-id", () -> CLIENT_ID);
    }

    @AfterAll
    static void tearDown() {
        oidc.close();
    }

    @Autowired
    private RestTestClient restTestClient;

    @Test
    void publicEndpoint_isAccessibleWithoutAuthentication() {
        restTestClient.get()
                .uri("/public")
                .exchange()
                .expectStatus().isEqualTo(HttpStatus.OK);
    }

    @Test
    void meEndpoint_rejectsRequestsWithNoToken() {
        restTestClient.get()
                .uri("/api/me")
                .exchange()
                .expectStatus().isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @SuppressWarnings("unchecked")
    void meEndpoint_returnsSubjectAndAuthoritiesForAValidToken() {
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
                .claim("iss", oidc.issuer)
                .claim("sub", "user-123")
                .claim("aud", CLIENT_ID)
                .claim("typ", "Bearer")
                .claim("realm_access", Map.of("roles", List.of("user")))
                .issueTime(Date.from(Instant.now()))
                .expirationTime(Date.from(Instant.now().plusSeconds(300)))
                .build();
        String token = tokens.sign(claims);

        Map<String, Object> body = restTestClient.get()
                .uri("/api/me")
                .headers(headers -> headers.setBearerAuth(token))
                .exchange()
                .expectStatus().isEqualTo(HttpStatus.OK)
                .expectBody(Map.class)
                .returnResult()
                .getResponseBody();

        assertThat(body).isNotNull();
        assertThat(body.get("sub")).isEqualTo("user-123");
        assertThat((List<String>) body.get("authorities")).contains("ROLE_user");
    }
}
