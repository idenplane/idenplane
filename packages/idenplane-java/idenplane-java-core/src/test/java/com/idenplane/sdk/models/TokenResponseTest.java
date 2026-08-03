package com.idenplane.sdk.models;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class TokenResponseTest {

    @Test
    void allArgsConstructorSetsAllFields() {
        TokenResponse response = new TokenResponse("at", "Bearer", 300, "rt", "idt", "openid email");

        assertThat(response.getAccessToken()).isEqualTo("at");
        assertThat(response.getTokenType()).isEqualTo("Bearer");
        assertThat(response.getExpiresIn()).isEqualTo(300);
        assertThat(response.getRefreshToken()).isEqualTo("rt");
        assertThat(response.getIdToken()).isEqualTo("idt");
        assertThat(response.getScope()).isEqualTo("openid email");
    }

    @Test
    void roundTripsThroughJson() throws Exception {
        String json = "{\"access_token\":\"at\",\"token_type\":\"Bearer\",\"expires_in\":600,"
                + "\"refresh_token\":\"rt\",\"id_token\":\"idt\",\"scope\":\"openid\"}";

        TokenResponse response = new ObjectMapper().readValue(json, TokenResponse.class);

        assertThat(response.getAccessToken()).isEqualTo("at");
        assertThat(response.getExpiresIn()).isEqualTo(600);
        assertThat(response.getRefreshToken()).isEqualTo("rt");
        assertThat(response.getIdToken()).isEqualTo("idt");
        assertThat(response.getScope()).isEqualTo("openid");
    }

    @Test
    void noArgsConstructorAndSettersWork() {
        TokenResponse response = new TokenResponse();
        response.setAccessToken("at2");
        response.setTokenType("Bearer");
        response.setExpiresIn(120);
        response.setRefreshToken("rt2");
        response.setIdToken("idt2");
        response.setScope("email");

        assertThat(response.getAccessToken()).isEqualTo("at2");
        assertThat(response.getTokenType()).isEqualTo("Bearer");
        assertThat(response.getExpiresIn()).isEqualTo(120);
        assertThat(response.getRefreshToken()).isEqualTo("rt2");
        assertThat(response.getIdToken()).isEqualTo("idt2");
        assertThat(response.getScope()).isEqualTo("email");
    }
}
