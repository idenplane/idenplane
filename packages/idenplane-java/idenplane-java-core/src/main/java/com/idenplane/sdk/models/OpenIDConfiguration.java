package com.authme.sdk.models;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * OIDC Discovery document shape.
 * Represents the configuration metadata returned by the OIDC .well-known endpoint.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class OpenIDConfiguration {

    @JsonProperty("issuer")
    private String issuer;

    @JsonProperty("authorization_endpoint")
    private String authorizationEndpoint;

    @JsonProperty("token_endpoint")
    private String tokenEndpoint;

    @JsonProperty("userinfo_endpoint")
    private String userinfoEndpoint;

    @JsonProperty("jwks_uri")
    private String jwksUri;

    @JsonProperty("end_session_endpoint")
    private String endSessionEndpoint;

    @JsonProperty("introspection_endpoint")
    private String introspectionEndpoint;

    @JsonProperty("revocation_endpoint")
    private String revocationEndpoint;

    @JsonProperty("device_authorization_endpoint")
    private String deviceAuthorizationEndpoint;

    @JsonProperty("check_session_iframe")
    private String checkSessionIframe;

    @JsonProperty("response_types_supported")
    private java.util.List<String> responseTypesSupported;

    @JsonProperty("grant_types_supported")
    private java.util.List<String> grantTypesSupported;

    @JsonProperty("subject_types_supported")
    private java.util.List<String> subjectTypesSupported;

    @JsonProperty("id_token_signing_alg_values_supported")
    private java.util.List<String> idTokenSigningAlgValuesSupported;

    @JsonProperty("scopes_supported")
    private java.util.List<String> scopesSupported;

    @JsonProperty("token_endpoint_auth_methods_supported")
    private java.util.List<String> tokenEndpointAuthMethodsSupported;

    @JsonProperty("claims_supported")
    private java.util.List<String> claimsSupported;

    @JsonProperty("code_challenge_methods_supported")
    private java.util.List<String> codeChallengeMethodsSupported;

    /**
     * Creates an empty OpenIDConfiguration.
     */
    public OpenIDConfiguration() {
    }

    /**
     * Gets the issuer identifier.
     *
     * @return The issuer
     */
    public String getIssuer() {
        return issuer;
    }

    /**
     * Sets the issuer identifier.
     *
     * @param issuer The issuer
     */
    public void setIssuer(String issuer) {
        this.issuer = issuer;
    }

    /**
     * Gets the authorization endpoint URL.
     *
     * @return The authorization endpoint
     */
    public String getAuthorizationEndpoint() {
        return authorizationEndpoint;
    }

    /**
     * Sets the authorization endpoint URL.
     *
     * @param authorizationEndpoint The authorization endpoint
     */
    public void setAuthorizationEndpoint(String authorizationEndpoint) {
        this.authorizationEndpoint = authorizationEndpoint;
    }

    /**
     * Gets the token endpoint URL.
     *
     * @return The token endpoint
     */
    public String getTokenEndpoint() {
        return tokenEndpoint;
    }

    /**
     * Sets the token endpoint URL.
     *
     * @param tokenEndpoint The token endpoint
     */
    public void setTokenEndpoint(String tokenEndpoint) {
        this.tokenEndpoint = tokenEndpoint;
    }

    /**
     * Gets the userinfo endpoint URL.
     *
     * @return The userinfo endpoint
     */
    public String getUserinfoEndpoint() {
        return userinfoEndpoint;
    }

    /**
     * Sets the userinfo endpoint URL.
     *
     * @param userinfoEndpoint The userinfo endpoint
     */
    public void setUserinfoEndpoint(String userinfoEndpoint) {
        this.userinfoEndpoint = userinfoEndpoint;
    }

    /**
     * Gets the JWKS URI.
     *
     * @return The JWKS URI
     */
    public String getJwksUri() {
        return jwksUri;
    }

    /**
     * Sets the JWKS URI.
     *
     * @param jwksUri The JWKS URI
     */
    public void setJwksUri(String jwksUri) {
        this.jwksUri = jwksUri;
    }

    /**
     * Gets the end session (logout) endpoint URL.
     *
     * @return The end session endpoint, or null if not supported
     */
    public String getEndSessionEndpoint() {
        return endSessionEndpoint;
    }

    /**
     * Sets the end session (logout) endpoint URL.
     *
     * @param endSessionEndpoint The end session endpoint
     */
    public void setEndSessionEndpoint(String endSessionEndpoint) {
        this.endSessionEndpoint = endSessionEndpoint;
    }

    /**
     * Gets the token introspection endpoint URL.
     *
     * @return The introspection endpoint, or null if not supported
     */
    public String getIntrospectionEndpoint() {
        return introspectionEndpoint;
    }

    /**
     * Sets the token introspection endpoint URL.
     *
     * @param introspectionEndpoint The introspection endpoint
     */
    public void setIntrospectionEndpoint(String introspectionEndpoint) {
        this.introspectionEndpoint = introspectionEndpoint;
    }

    /**
     * Gets the token revocation endpoint URL.
     *
     * @return The revocation endpoint, or null if not supported
     */
    public String getRevocationEndpoint() {
        return revocationEndpoint;
    }

    /**
     * Sets the token revocation endpoint URL.
     *
     * @param revocationEndpoint The revocation endpoint
     */
    public void setRevocationEndpoint(String revocationEndpoint) {
        this.revocationEndpoint = revocationEndpoint;
    }

    /**
     * Gets the device authorization endpoint URL.
     *
     * @return The device authorization endpoint, or null if not supported
     */
    public String getDeviceAuthorizationEndpoint() {
        return deviceAuthorizationEndpoint;
    }

    /**
     * Sets the device authorization endpoint URL.
     *
     * @param deviceAuthorizationEndpoint The device authorization endpoint
     */
    public void setDeviceAuthorizationEndpoint(String deviceAuthorizationEndpoint) {
        this.deviceAuthorizationEndpoint = deviceAuthorizationEndpoint;
    }

    /**
     * Gets the check session iframe URL.
     *
     * @return The check session iframe, or null if not supported
     */
    public String getCheckSessionIframe() {
        return checkSessionIframe;
    }

    /**
     * Sets the check session iframe URL.
     *
     * @param checkSessionIframe The check session iframe
     */
    public void setCheckSessionIframe(String checkSessionIframe) {
        this.checkSessionIframe = checkSessionIframe;
    }

    /**
     * Gets the supported response types.
     *
     * @return The supported response types
     */
    public java.util.List<String> getResponseTypesSupported() {
        return responseTypesSupported;
    }

    /**
     * Sets the supported response types.
     *
     * @param responseTypesSupported The supported response types
     */
    public void setResponseTypesSupported(java.util.List<String> responseTypesSupported) {
        this.responseTypesSupported = responseTypesSupported;
    }

    /**
     * Gets the supported grant types.
     *
     * @return The supported grant types
     */
    public java.util.List<String> getGrantTypesSupported() {
        return grantTypesSupported;
    }

    /**
     * Sets the supported grant types.
     *
     * @param grantTypesSupported The supported grant types
     */
    public void setGrantTypesSupported(java.util.List<String> grantTypesSupported) {
        this.grantTypesSupported = grantTypesSupported;
    }

    /**
     * Gets the supported subject types.
     *
     * @return The supported subject types
     */
    public java.util.List<String> getSubjectTypesSupported() {
        return subjectTypesSupported;
    }

    /**
     * Sets the supported subject types.
     *
     * @param subjectTypesSupported The supported subject types
     */
    public void setSubjectTypesSupported(java.util.List<String> subjectTypesSupported) {
        this.subjectTypesSupported = subjectTypesSupported;
    }

    /**
     * Gets the supported ID token signing algorithms.
     *
     * @return The supported signing algorithms
     */
    public java.util.List<String> getIdTokenSigningAlgValuesSupported() {
        return idTokenSigningAlgValuesSupported;
    }

    /**
     * Sets the supported ID token signing algorithms.
     *
     * @param idTokenSigningAlgValuesSupported The supported signing algorithms
     */
    public void setIdTokenSigningAlgValuesSupported(java.util.List<String> idTokenSigningAlgValuesSupported) {
        this.idTokenSigningAlgValuesSupported = idTokenSigningAlgValuesSupported;
    }

    /**
     * Gets the supported scopes.
     *
     * @return The supported scopes
     */
    public java.util.List<String> getScopesSupported() {
        return scopesSupported;
    }

    /**
     * Sets the supported scopes.
     *
     * @param scopesSupported The supported scopes
     */
    public void setScopesSupported(java.util.List<String> scopesSupported) {
        this.scopesSupported = scopesSupported;
    }

    /**
     * Gets the supported token endpoint authentication methods.
     *
     * @return The supported auth methods
     */
    public java.util.List<String> getTokenEndpointAuthMethodsSupported() {
        return tokenEndpointAuthMethodsSupported;
    }

    /**
     * Sets the supported token endpoint authentication methods.
     *
     * @param tokenEndpointAuthMethodsSupported The supported auth methods
     */
    public void setTokenEndpointAuthMethodsSupported(java.util.List<String> tokenEndpointAuthMethodsSupported) {
        this.tokenEndpointAuthMethodsSupported = tokenEndpointAuthMethodsSupported;
    }

    /**
     * Gets the supported claims.
     *
     * @return The supported claims
     */
    public java.util.List<String> getClaimsSupported() {
        return claimsSupported;
    }

    /**
     * Sets the supported claims.
     *
     * @param claimsSupported The supported claims
     */
    public void setClaimsSupported(java.util.List<String> claimsSupported) {
        this.claimsSupported = claimsSupported;
    }

    /**
     * Gets the supported code challenge methods (PKCE).
     *
     * @return The supported code challenge methods
     */
    public java.util.List<String> getCodeChallengeMethodsSupported() {
        return codeChallengeMethodsSupported;
    }

    /**
     * Sets the supported code challenge methods (PKCE).
     *
     * @param codeChallengeMethodsSupported The supported code challenge methods
     */
    public void setCodeChallengeMethodsSupported(java.util.List<String> codeChallengeMethodsSupported) {
        this.codeChallengeMethodsSupported = codeChallengeMethodsSupported;
    }

    @Override
    public String toString() {
        return "OpenIDConfiguration{" +
                "issuer='" + issuer + '\'' +
                ", authorizationEndpoint='" + authorizationEndpoint + '\'' +
                ", tokenEndpoint='" + tokenEndpoint + '\'' +
                ", userinfoEndpoint='" + userinfoEndpoint + '\'' +
                ", jwksUri='" + jwksUri + '\'' +
                '}';
    }
}
