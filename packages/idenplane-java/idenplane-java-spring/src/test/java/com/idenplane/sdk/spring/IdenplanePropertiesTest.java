package com.idenplane.sdk.spring;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class IdenplanePropertiesTest {

    @Test
    void gettersAndSettersRoundTrip() {
        IdenplaneProperties properties = new IdenplaneProperties();
        properties.setIssuerUri("https://idenplane.test/realms/r");
        properties.setClientId("my-client");
        properties.setClientSecret("shh");

        assertThat(properties.getIssuerUri()).isEqualTo("https://idenplane.test/realms/r");
        assertThat(properties.getClientId()).isEqualTo("my-client");
        assertThat(properties.getClientSecret()).isEqualTo("shh");
    }
}
