package com.idenplane.sdk.models;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class OpenIDConfigurationTest {

    @Test
    void roundTripsThroughJsonPreservingAllFields() throws Exception {
        OpenIDConfiguration original = new OpenIDConfiguration();
        original.setIssuer("https://idenplane.test/realms/r");
        original.setAuthorizationEndpoint("https://idenplane.test/realms/r/protocol/openid-connect/auth");
        original.setTokenEndpoint("https://idenplane.test/realms/r/protocol/openid-connect/token");
        original.setUserinfoEndpoint("https://idenplane.test/realms/r/protocol/openid-connect/userinfo");
        original.setJwksUri("https://idenplane.test/realms/r/protocol/openid-connect/certs");
        original.setEndSessionEndpoint("https://idenplane.test/realms/r/protocol/openid-connect/logout");
        original.setIntrospectionEndpoint("https://idenplane.test/realms/r/protocol/openid-connect/token/introspect");
        original.setRevocationEndpoint("https://idenplane.test/realms/r/protocol/openid-connect/revoke");
        original.setDeviceAuthorizationEndpoint("https://idenplane.test/realms/r/protocol/openid-connect/auth/device");
        original.setCheckSessionIframe("https://idenplane.test/realms/r/protocol/openid-connect/login-status-iframe.html");
        original.setResponseTypesSupported(List.of("code"));
        original.setGrantTypesSupported(List.of("authorization_code", "refresh_token"));
        original.setSubjectTypesSupported(List.of("public"));
        original.setIdTokenSigningAlgValuesSupported(List.of("RS256"));
        original.setScopesSupported(List.of("openid", "profile", "email"));
        original.setTokenEndpointAuthMethodsSupported(List.of("client_secret_post"));
        original.setClaimsSupported(List.of("sub", "email"));
        original.setCodeChallengeMethodsSupported(List.of("S256"));

        ObjectMapper mapper = new ObjectMapper();
        String json = mapper.writeValueAsString(original);
        OpenIDConfiguration parsed = mapper.readValue(json, OpenIDConfiguration.class);

        assertThat(parsed.getIssuer()).isEqualTo(original.getIssuer());
        assertThat(parsed.getAuthorizationEndpoint()).isEqualTo(original.getAuthorizationEndpoint());
        assertThat(parsed.getTokenEndpoint()).isEqualTo(original.getTokenEndpoint());
        assertThat(parsed.getUserinfoEndpoint()).isEqualTo(original.getUserinfoEndpoint());
        assertThat(parsed.getJwksUri()).isEqualTo(original.getJwksUri());
        assertThat(parsed.getEndSessionEndpoint()).isEqualTo(original.getEndSessionEndpoint());
        assertThat(parsed.getIntrospectionEndpoint()).isEqualTo(original.getIntrospectionEndpoint());
        assertThat(parsed.getRevocationEndpoint()).isEqualTo(original.getRevocationEndpoint());
        assertThat(parsed.getDeviceAuthorizationEndpoint()).isEqualTo(original.getDeviceAuthorizationEndpoint());
        assertThat(parsed.getCheckSessionIframe()).isEqualTo(original.getCheckSessionIframe());
        assertThat(parsed.getResponseTypesSupported()).isEqualTo(original.getResponseTypesSupported());
        assertThat(parsed.getGrantTypesSupported()).isEqualTo(original.getGrantTypesSupported());
        assertThat(parsed.getSubjectTypesSupported()).isEqualTo(original.getSubjectTypesSupported());
        assertThat(parsed.getIdTokenSigningAlgValuesSupported())
                .isEqualTo(original.getIdTokenSigningAlgValuesSupported());
        assertThat(parsed.getScopesSupported()).isEqualTo(original.getScopesSupported());
        // Regression check: this getter/setter pair (and its backing field) used to be named
        // tokenEndpointIdenplanethodsSupported — mangled by a blind "AuthMe" -> "Idenplane"
        // rebrand find/replace ("AuthMethodsSupported" contains "AuthMe" as a substring).
        assertThat(parsed.getTokenEndpointAuthMethodsSupported())
                .isEqualTo(original.getTokenEndpointAuthMethodsSupported());
        assertThat(parsed.getClaimsSupported()).isEqualTo(original.getClaimsSupported());
        assertThat(parsed.getCodeChallengeMethodsSupported()).isEqualTo(original.getCodeChallengeMethodsSupported());
        assertThat(parsed.toString()).contains(original.getIssuer());
    }

    @Test
    void ignoresUnknownJsonProperties() throws Exception {
        String json = "{\"issuer\":\"https://x\",\"totally_unknown_field\":\"value\"}";

        OpenIDConfiguration parsed = new ObjectMapper().readValue(json, OpenIDConfiguration.class);

        assertThat(parsed.getIssuer()).isEqualTo("https://x");
    }
}
