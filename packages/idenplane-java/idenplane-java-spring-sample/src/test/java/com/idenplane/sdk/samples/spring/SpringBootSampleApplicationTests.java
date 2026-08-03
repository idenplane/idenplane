package com.idenplane.sdk.samples.spring;

import com.nimbusds.jwt.JWTClaimsSet;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

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
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
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

    @LocalServerPort
    private int port;

    private final TestRestTemplate restTemplate = new TestRestTemplate();

    @Test
    void publicEndpoint_isAccessibleWithoutAuthentication() {
        ResponseEntity<String> response = restTemplate.getForEntity(url("/public"), String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    @Test
    void meEndpoint_rejectsRequestsWithNoToken() {
        ResponseEntity<String> response = restTemplate.getForEntity(url("/api/me"), String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
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
        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(token);

        ResponseEntity<Map> response =
                restTemplate.exchange(url("/api/me"), HttpMethod.GET, new HttpEntity<>(headers), Map.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody().get("sub")).isEqualTo("user-123");
        assertThat((List<String>) response.getBody().get("authorities")).contains("ROLE_user");
    }

    private String url(String path) {
        return "http://localhost:" + port + path;
    }
}
