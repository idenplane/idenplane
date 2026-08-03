package com.idenplane.sdk.spring;

import org.junit.jupiter.api.Test;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class IdenplaneAuthoritiesConverterTest {

    private static final String CLIENT_ID = "my-client";
    private final IdenplaneAuthoritiesConverter converter = new IdenplaneAuthoritiesConverter(CLIENT_ID);

    @Test
    void mapsRealmRolesToRolePrefixedAuthorities() {
        Jwt jwt = jwtWithClaims(Map.of("realm_access", Map.of("roles", List.of("user", "admin"))));

        Collection<GrantedAuthority> authorities = converter.convert(jwt);

        assertThat(authorities).extracting(GrantedAuthority::getAuthority)
                .containsExactlyInAnyOrder("ROLE_user", "ROLE_admin");
    }

    @Test
    void mapsResourceRolesForConfiguredClientOnly() {
        Jwt jwt = jwtWithClaims(Map.of("resource_access", Map.of(
                CLIENT_ID, Map.of("roles", List.of("manage-account")),
                "some-other-client", Map.of("roles", List.of("should-not-appear")))));

        Collection<GrantedAuthority> authorities = converter.convert(jwt);

        assertThat(authorities).extracting(GrantedAuthority::getAuthority)
                .containsExactly("ROLE_my-client_manage-account");
    }

    @Test
    void combinesRealmAndResourceRoles() {
        Jwt jwt = jwtWithClaims(Map.of(
                "realm_access", Map.of("roles", List.of("user")),
                "resource_access", Map.of(CLIENT_ID, Map.of("roles", List.of("viewer")))));

        Collection<GrantedAuthority> authorities = converter.convert(jwt);

        assertThat(authorities).extracting(GrantedAuthority::getAuthority)
                .containsExactlyInAnyOrder("ROLE_user", "ROLE_my-client_viewer");
    }

    @Test
    void returnsEmptyWhenNeitherClaimPresent() {
        Jwt jwt = jwtWithClaims(Map.of());

        assertThat(converter.convert(jwt)).isEmpty();
    }

    private static Jwt jwtWithClaims(Map<String, Object> extraClaims) {
        Jwt.Builder builder = Jwt.withTokenValue("token-value")
                .header("alg", "RS256")
                .subject("user-123")
                .issuedAt(Instant.now())
                .expiresAt(Instant.now().plusSeconds(300));
        extraClaims.forEach(builder::claim);
        return builder.build();
    }
}
