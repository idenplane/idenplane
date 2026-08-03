package com.idenplane.sdk.models;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class UserInfoTest {

    @Test
    void subConstructorSetsSubject() {
        UserInfo userInfo = new UserInfo("user-1");

        assertThat(userInfo.getSub()).isEqualTo("user-1");
    }

    @Test
    void roundTripsThroughJson() throws Exception {
        String json = "{\"sub\":\"user-1\",\"preferred_username\":\"ada\",\"name\":\"Ada Lovelace\","
                + "\"given_name\":\"Ada\",\"family_name\":\"Lovelace\",\"email\":\"ada@example.com\","
                + "\"email_verified\":true}";

        UserInfo userInfo = new ObjectMapper().readValue(json, UserInfo.class);

        assertThat(userInfo.getSub()).isEqualTo("user-1");
        assertThat(userInfo.getPreferredUsername()).isEqualTo("ada");
        assertThat(userInfo.getName()).isEqualTo("Ada Lovelace");
        assertThat(userInfo.getGivenName()).isEqualTo("Ada");
        assertThat(userInfo.getFamilyName()).isEqualTo("Lovelace");
        assertThat(userInfo.getEmail()).isEqualTo("ada@example.com");
        assertThat(userInfo.isEmailVerified()).isTrue();
        assertThat(userInfo.toString()).contains("user-1", "ada@example.com");
    }

    @Test
    void noArgsConstructorAndSettersWork() {
        UserInfo userInfo = new UserInfo();
        userInfo.setSub("s");
        userInfo.setPreferredUsername("pu");
        userInfo.setName("n");
        userInfo.setGivenName("gn");
        userInfo.setFamilyName("fn");
        userInfo.setEmail("e");
        userInfo.setEmailVerified(false);

        assertThat(userInfo.getSub()).isEqualTo("s");
        assertThat(userInfo.getPreferredUsername()).isEqualTo("pu");
        assertThat(userInfo.getName()).isEqualTo("n");
        assertThat(userInfo.getGivenName()).isEqualTo("gn");
        assertThat(userInfo.getFamilyName()).isEqualTo("fn");
        assertThat(userInfo.getEmail()).isEqualTo("e");
        assertThat(userInfo.isEmailVerified()).isFalse();
    }

    @Test
    void ignoresUnknownJsonProperties() throws Exception {
        String json = "{\"sub\":\"user-1\",\"some_future_claim\":\"value\"}";

        UserInfo userInfo = new ObjectMapper().readValue(json, UserInfo.class);

        assertThat(userInfo.getSub()).isEqualTo("user-1");
    }
}
