package com.idenplane.sdk.spring;

import com.idenplane.sdk.IdenplaneClient;
import com.nimbusds.jwt.JWTClaimsSet;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidationException;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;

import java.io.IOException;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class IdenplaneAutoConfigurationTest {

    private static final String CLIENT_ID = "my-client";

    private final ApplicationContextRunner contextRunner =
            new ApplicationContextRunner().withConfiguration(AutoConfigurations.of(IdenplaneAutoConfiguration.class));

    @Test
    void doesNotActivateWithoutIssuerUri() {
        contextRunner.run(context -> {
            assertThat(context).doesNotHaveBean(JwtDecoder.class);
            assertThat(context).doesNotHaveBean(JwtAuthenticationConverter.class);
            assertThat(context).doesNotHaveBean(IdenplaneClient.class);
        });
    }

    @Test
    void createsExpectedBeansOnceIssuerUriIsSet() throws IOException {
        try (LocalOidcServer oidc = LocalOidcServer.start(SpringTestTokens.generate())) {
            contextRunner
                    .withPropertyValues("idenplane.issuer-uri=" + oidc.issuer, "idenplane.client-id=" + CLIENT_ID)
                    .run(context -> {
                        assertThat(context).hasSingleBean(JwtDecoder.class);
                        assertThat(context).hasSingleBean(JwtAuthenticationConverter.class);
                        assertThat(context).hasSingleBean(IdenplaneClient.class);
                    });
        }
    }

    @Test
    void jwtDecoder_decodesAndValidatesARealToken() throws IOException {
        SpringTestTokens tokens = SpringTestTokens.generate();
        try (LocalOidcServer oidc = LocalOidcServer.start(tokens)) {
            String token = tokens.sign(validClaims(oidc.issuer));

            contextRunner
                    .withPropertyValues("idenplane.issuer-uri=" + oidc.issuer, "idenplane.client-id=" + CLIENT_ID)
                    .run(context -> {
                        JwtDecoder decoder = context.getBean(JwtDecoder.class);
                        Jwt jwt = decoder.decode(token);
                        assertThat(jwt.getSubject()).isEqualTo("user-123");
                        assertThat(jwt.getAudience()).contains(CLIENT_ID);
                    });
        }
    }

    @Test
    void jwtDecoder_rejectsTokenWithWrongAudience() throws IOException {
        SpringTestTokens tokens = SpringTestTokens.generate();
        try (LocalOidcServer oidc = LocalOidcServer.start(tokens)) {
            JWTClaimsSet wrongAudience = new JWTClaimsSet.Builder()
                    .claim("iss", oidc.issuer)
                    .claim("sub", "user-123")
                    .claim("aud", "some-other-client")
                    .issueTime(java.util.Date.from(Instant.now()))
                    .expirationTime(java.util.Date.from(Instant.now().plusSeconds(300)))
                    .build();
            String token = tokens.sign(wrongAudience);

            contextRunner
                    .withPropertyValues("idenplane.issuer-uri=" + oidc.issuer, "idenplane.client-id=" + CLIENT_ID)
                    .run(context -> {
                        JwtDecoder decoder = context.getBean(JwtDecoder.class);
                        assertThatThrownBy(() -> decoder.decode(token)).isInstanceOf(JwtValidationException.class);
                    });
        }
    }

    @Test
    void existingJwtDecoderBeanIsNotOverridden() throws IOException {
        try (LocalOidcServer oidc = LocalOidcServer.start(SpringTestTokens.generate())) {
            contextRunner
                    .withPropertyValues("idenplane.issuer-uri=" + oidc.issuer, "idenplane.client-id=" + CLIENT_ID)
                    .withUserConfiguration(CustomJwtDecoderConfig.class)
                    .run(context -> {
                        assertThat(context).hasSingleBean(JwtDecoder.class);
                        assertThat(context.getBean(JwtDecoder.class)).isSameAs(CustomJwtDecoderConfig.STUB);
                    });
        }
    }

    private static JWTClaimsSet validClaims(String issuer) {
        return new JWTClaimsSet.Builder()
                .claim("iss", issuer)
                .claim("sub", "user-123")
                .claim("aud", CLIENT_ID)
                .issueTime(java.util.Date.from(Instant.now()))
                .expirationTime(java.util.Date.from(Instant.now().plusSeconds(300)))
                .build();
    }

    @Configuration
    static class CustomJwtDecoderConfig {
        static final JwtDecoder STUB = token -> {
            throw new UnsupportedOperationException("stub decoder — should never actually be invoked");
        };

        @Bean
        JwtDecoder jwtDecoder() {
            return STUB;
        }
    }
}
