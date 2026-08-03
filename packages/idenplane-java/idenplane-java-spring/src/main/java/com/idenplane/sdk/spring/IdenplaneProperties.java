package com.idenplane.sdk.spring;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Configuration properties for the Idenplane Spring Boot integration, bound from the
 * {@code idenplane.*} prefix (e.g. {@code application.yml}).
 *
 * <pre>{@code
 * idenplane:
 *   issuer-uri: https://idenplane.example.com/realms/my-realm
 *   client-id: my-spring-app
 * }</pre>
 */
@ConfigurationProperties(prefix = "idenplane")
public class IdenplaneProperties {

    /**
     * The realm issuer URL, e.g. {@code https://host/realms/my-realm}. Required — the
     * auto-configuration in this module only activates once this is set.
     */
    private String issuerUri;

    /**
     * The OAuth2 client ID registered in the realm. Required for token audience validation.
     */
    private String clientId;

    /**
     * The client secret, for confidential clients. Public/native clients should omit this.
     */
    private String clientSecret;

    public String getIssuerUri() {
        return issuerUri;
    }

    public void setIssuerUri(String issuerUri) {
        this.issuerUri = issuerUri;
    }

    public String getClientId() {
        return clientId;
    }

    public void setClientId(String clientId) {
        this.clientId = clientId;
    }

    public String getClientSecret() {
        return clientSecret;
    }

    public void setClientSecret(String clientSecret) {
        this.clientSecret = clientSecret;
    }
}
