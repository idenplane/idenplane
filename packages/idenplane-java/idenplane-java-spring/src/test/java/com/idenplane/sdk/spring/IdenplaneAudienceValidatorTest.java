package com.idenplane.sdk.spring;

import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

class IdenplaneAudienceValidatorTest {

    private final IdenplaneAudienceValidator validator = new IdenplaneAudienceValidator("my-client");

    @Test
    void succeedsWhenAudienceContainsClientId() {
        Jwt jwt = jwtWithAudience("my-client");

        OAuth2TokenValidatorResult result = validator.validate(jwt);

        assertThat(result.hasErrors()).isFalse();
    }

    @Test
    void failsWhenAudienceIsDifferentClient() {
        Jwt jwt = jwtWithAudience("some-other-client");

        OAuth2TokenValidatorResult result = validator.validate(jwt);

        assertThat(result.hasErrors()).isTrue();
    }

    private static Jwt jwtWithAudience(String audience) {
        return Jwt.withTokenValue("token-value")
                .header("alg", "RS256")
                .subject("user-123")
                .audience(java.util.List.of(audience))
                .issuedAt(Instant.now())
                .expiresAt(Instant.now().plusSeconds(300))
                .build();
    }
}
