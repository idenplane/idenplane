package com.idenplane.sdk.models;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class TokenClaimsTest {

    @Test
    void roundTripsThroughJsonPreservingAllFields() throws Exception {
        String json = "{"
                + "\"sub\":\"user-1\",\"iss\":\"https://issuer\",\"aud\":\"client-1\","
                + "\"exp\":2000000000,\"iat\":1999999000,\"typ\":\"Bearer\",\"azp\":\"client-1\","
                + "\"sid\":\"session-1\",\"jti\":\"jwt-1\",\"scope\":\"openid email\",\"nonce\":\"nonce-1\","
                + "\"auth_time\":1999999500,\"at_hash\":\"hash-1\",\"acr\":\"1\","
                + "\"name\":\"Ada Lovelace\",\"given_name\":\"Ada\",\"family_name\":\"Lovelace\","
                + "\"preferred_username\":\"ada\",\"email\":\"ada@example.com\",\"email_verified\":true,"
                + "\"updated_at\":1999999999,"
                + "\"realm_access\":{\"roles\":[\"user\",\"admin\"]},"
                + "\"resource_access\":{\"client-1\":{\"roles\":[\"viewer\"]}}"
                + "}";

        TokenClaims claims = new ObjectMapper().readValue(json, TokenClaims.class);

        assertThat(claims.getSub()).isEqualTo("user-1");
        assertThat(claims.getIss()).isEqualTo("https://issuer");
        assertThat(claims.getAud()).isEqualTo("client-1");
        assertThat(claims.getAudAsString()).isEqualTo("client-1");
        assertThat(claims.getExp()).isEqualTo(2000000000L);
        assertThat(claims.getIat()).isEqualTo(1999999000L);
        assertThat(claims.getTyp()).isEqualTo("Bearer");
        assertThat(claims.getAzp()).isEqualTo("client-1");
        assertThat(claims.getSid()).isEqualTo("session-1");
        assertThat(claims.getJti()).isEqualTo("jwt-1");
        assertThat(claims.getScope()).isEqualTo("openid email");
        assertThat(claims.getNonce()).isEqualTo("nonce-1");
        assertThat(claims.getAuthTime()).isEqualTo(1999999500L);
        assertThat(claims.getAtHash()).isEqualTo("hash-1");
        assertThat(claims.getAcr()).isEqualTo("1");
        assertThat(claims.getName()).isEqualTo("Ada Lovelace");
        assertThat(claims.getGivenName()).isEqualTo("Ada");
        assertThat(claims.getFamilyName()).isEqualTo("Lovelace");
        assertThat(claims.getPreferredUsername()).isEqualTo("ada");
        assertThat(claims.getEmail()).isEqualTo("ada@example.com");
        assertThat(claims.isEmailVerified()).isTrue();
        assertThat(claims.getUpdatedAt()).isEqualTo(1999999999L);
        assertThat(claims.getRealmRoles()).containsExactlyInAnyOrder("user", "admin");
        assertThat(claims.getResourceRoles("client-1")).containsExactly("viewer");
        assertThat(claims.getResourceRoles("nonexistent-client")).isEmpty();
    }

    @Test
    void getAudAsString_handlesArrayAudience() throws Exception {
        String json = "{\"aud\":[\"client-a\",\"client-b\"]}";

        TokenClaims claims = new ObjectMapper().readValue(json, TokenClaims.class);

        assertThat(claims.getAudAsString()).isEqualTo("client-a");
    }

    @Test
    void getAudAsString_returnsNullWhenAudIsAbsent() {
        assertThat(new TokenClaims().getAudAsString()).isNull();
    }

    @Test
    void getRealmRoles_returnsEmptyListWhenNoRealmAccess() {
        assertThat(new TokenClaims().getRealmRoles()).isEmpty();
    }

    @Test
    void getResourceRoles_returnsEmptyListWhenNoResourceAccess() {
        assertThat(new TokenClaims().getResourceRoles("any-client")).isEmpty();
    }

    @Test
    void settersAllowDirectConstruction() {
        TokenClaims claims = new TokenClaims();
        claims.setSub("s");
        claims.setIss("i");
        claims.setAud("a");
        claims.setExp(1);
        claims.setIat(2);
        claims.setTyp("t");
        claims.setAzp("az");
        claims.setSid("si");
        claims.setJti("j");
        claims.setScope("sc");
        claims.setNonce("n");
        claims.setAuthTime(3);
        claims.setAtHash("ah");
        claims.setAcr("ac");
        claims.setName("nm");
        claims.setGivenName("gn");
        claims.setFamilyName("fn");
        claims.setPreferredUsername("pu");
        claims.setEmail("e");
        claims.setEmailVerified(true);
        claims.setUpdatedAt(4);
        TokenClaims.RealmAccess realmAccess = new TokenClaims.RealmAccess();
        realmAccess.setRoles(List.of("r"));
        claims.setRealmAccess(realmAccess);
        claims.setResourceAccess(Map.of());

        assertThat(claims.getRealmAccess()).isSameAs(realmAccess);
        assertThat(claims.getResourceAccess()).isEmpty();
        assertThat(claims.getAud()).isEqualTo("a");
    }
}
