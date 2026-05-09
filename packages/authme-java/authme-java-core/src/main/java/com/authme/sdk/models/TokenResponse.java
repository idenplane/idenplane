package com.authme.sdk.models;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Raw token response from the token endpoint.
 * Contains OAuth2/OIDC tokens returned by the authorization server.
 */
public class TokenResponse {

    @JsonProperty("access_token")
    private String accessToken;

    @JsonProperty("token_type")
    private String tokenType;

    @JsonProperty("expires_in")
    private int expiresIn;

    @JsonProperty("refresh_token")
    private String refreshToken;

    @JsonProperty("id_token")
    private String idToken;

    @JsonProperty("scope")
    private String scope;

    /**
     * Creates an empty TokenResponse.
     */
    public TokenResponse() {
    }

    /**
     * Creates a TokenResponse with all fields.
     *
     * @param accessToken   The OAuth2 access token
     * @param tokenType     The token type (typically "Bearer")
     * @param expiresIn     The number of seconds until the access token expires
     * @param refreshToken  The OAuth2 refresh token (optional)
     * @param idToken       The OIDC ID token (optional)
     * @param scope         The granted scopes (optional)
     */
    public TokenResponse(String accessToken, String tokenType, int expiresIn,
                        String refreshToken, String idToken, String scope) {
        this.accessToken = accessToken;
        this.tokenType = tokenType;
        this.expiresIn = expiresIn;
        this.refreshToken = refreshToken;
        this.idToken = idToken;
        this.scope = scope;
    }

    /**
     * Gets the OAuth2 access token.
     *
     * @return The access token
     */
    public String getAccessToken() {
        return accessToken;
    }

    /**
     * Sets the OAuth2 access token.
     *
     * @param accessToken The access token
     */
    public void setAccessToken(String accessToken) {
        this.accessToken = accessToken;
    }

    /**
     * Gets the token type.
     *
     * @return The token type
     */
    public String getTokenType() {
        return tokenType;
    }

    /**
     * Sets the token type.
     *
     * @param tokenType The token type
     */
    public void setTokenType(String tokenType) {
        this.tokenType = tokenType;
    }

    /**
     * Gets the number of seconds until the access token expires.
     *
     * @return The expiration time in seconds
     */
    public int getExpiresIn() {
        return expiresIn;
    }

    /**
     * Sets the number of seconds until the access token expires.
     *
     * @param expiresIn The expiration time in seconds
     */
    public void setExpiresIn(int expiresIn) {
        this.expiresIn = expiresIn;
    }

    /**
     * Gets the OAuth2 refresh token.
     *
     * @return The refresh token, or null if not provided
     */
    public String getRefreshToken() {
        return refreshToken;
    }

    /**
     * Sets the OAuth2 refresh token.
     *
     * @param refreshToken The refresh token
     */
    public void setRefreshToken(String refreshToken) {
        this.refreshToken = refreshToken;
    }

    /**
     * Gets the OIDC ID token.
     *
     * @return The ID token, or null if not provided
     */
    public String getIdToken() {
        return idToken;
    }

    /**
     * Sets the OIDC ID token.
     *
     * @param idToken The ID token
     */
    public void setIdToken(String idToken) {
        this.idToken = idToken;
    }

    /**
     * Gets the granted scopes.
     *
     * @return The granted scopes, or null if not provided
     */
    public String getScope() {
        return scope;
    }

    /**
     * Sets the granted scopes.
     *
     * @param scope The granted scopes
     */
    public void setScope(String scope) {
        this.scope = scope;
    }
}
