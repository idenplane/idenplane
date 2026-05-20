package com.idenplane.sdk.models;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.ArrayList;
import java.util.List;

/**
 * Parsed JWT claims from an access token.
 * Contains standard JWT claims and Idenplane-specific user claims.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class TokenClaims {

    // Standard JWT claims
    @JsonProperty("sub")
    private String sub;

    @JsonProperty("iss")
    private String iss;

    @JsonProperty("aud")
    private Object aud;

    @JsonProperty("exp")
    private long exp;

    @JsonProperty("iat")
    private long iat;

    @JsonProperty("typ")
    private String typ;

    @JsonProperty("azp")
    private String azp;

    @JsonProperty("sid")
    private String sid;

    @JsonProperty("jti")
    private String jti;

    @JsonProperty("scope")
    private String scope;

    @JsonProperty("nonce")
    private String nonce;

    @JsonProperty("auth_time")
    private long authTime;

    @JsonProperty("at_hash")
    private String atHash;

    @JsonProperty("acr")
    private String acr;

    // User claims
    @JsonProperty("name")
    private String name;

    @JsonProperty("given_name")
    private String givenName;

    @JsonProperty("family_name")
    private String familyName;

    @JsonProperty("preferred_username")
    private String preferredUsername;

    @JsonProperty("email")
    private String email;

    @JsonProperty("email_verified")
    private boolean emailVerified;

    @JsonProperty("updated_at")
    private long updatedAt;

    // Role claims
    @JsonProperty("realm_access")
    private RealmAccess realmAccess;

    @JsonProperty("resource_access")
    private java.util.Map<String, ResourceAccess> resourceAccess;

    /**
     * Creates an empty TokenClaims.
     */
    public TokenClaims() {
    }

    /**
     * Gets the subject (user ID).
     *
     * @return The subject claim
     */
    public String getSub() {
        return sub;
    }

    public void setSub(String sub) {
        this.sub = sub;
    }

    /**
     * Gets the issuer.
     *
     * @return The issuer claim
     */
    public String getIss() {
        return iss;
    }

    public void setIss(String iss) {
        this.iss = iss;
    }

    /**
     * Gets the audience (client ID).
     *
     * @return The audience claim
     */
    public Object getAud() {
        return aud;
    }

    public void setAud(Object aud) {
        this.aud = aud;
    }

    /**
     * Gets the audience as a single string or list.
     *
     * @return The audience as string or first item if list
     */
    public String getAudAsString() {
        if (aud == null) {
            return null;
        }
        if (aud instanceof String) {
            return (String) aud;
        }
        if (aud instanceof List) {
            List<?> list = (List<?>) aud;
            return list.isEmpty() ? null : list.get(0).toString();
        }
        return aud.toString();
    }

    /**
     * Gets the expiration time (unix seconds).
     *
     * @return The expiration time
     */
    public long getExp() {
        return exp;
    }

    public void setExp(long exp) {
        this.exp = exp;
    }

    /**
     * Gets the issued at time (unix seconds).
     *
     * @return The issued at time
     */
    public long getIat() {
        return iat;
    }

    public void setIat(long iat) {
        this.iat = iat;
    }

    /**
     * Gets the token type.
     *
     * @return The token type
     */
    public String getTyp() {
        return typ;
    }

    public void setTyp(String typ) {
        this.typ = typ;
    }

    /**
     * Gets the authorized party (client ID).
     *
     * @return The authorized party
     */
    public String getAzp() {
        return azp;
    }

    public void setAzp(String azp) {
        this.azp = azp;
    }

    /**
     * Gets the session ID.
     *
     * @return The session ID
     */
    public String getSid() {
        return sid;
    }

    public void setSid(String sid) {
        this.sid = sid;
    }

    /**
     * Gets the JWT ID.
     *
     * @return The JWT ID
     */
    public String getJti() {
        return jti;
    }

    public void setJti(String jti) {
        this.jti = jti;
    }

    /**
     * Gets the granted scopes (space-separated).
     *
     * @return The granted scopes
     */
    public String getScope() {
        return scope;
    }

    public void setScope(String scope) {
        this.scope = scope;
    }

    /**
     * Gets the nonce from the authorization request.
     *
     * @return The nonce
     */
    public String getNonce() {
        return nonce;
    }

    public void setNonce(String nonce) {
        this.nonce = nonce;
    }

    /**
     * Gets the authentication time (unix seconds).
     *
     * @return The authentication time
     */
    public long getAuthTime() {
        return authTime;
    }

    public void setAuthTime(long authTime) {
        this.authTime = authTime;
    }

    /**
     * Gets the access token hash (ID tokens only).
     *
     * @return The access token hash
     */
    public String getAtHash() {
        return atHash;
    }

    public void setAtHash(String atHash) {
        this.atHash = atHash;
    }

    /**
     * Gets the Authentication Context Class Reference.
     *
     * @return The ACR value
     */
    public String getAcr() {
        return acr;
    }

    public void setAcr(String acr) {
        this.acr = acr;
    }

    /**
     * Gets the user's full name.
     *
     * @return The name
     */
    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    /**
     * Gets the user's given name.
     *
     * @return The given name
     */
    public String getGivenName() {
        return givenName;
    }

    public void setGivenName(String givenName) {
        this.givenName = givenName;
    }

    /**
     * Gets the user's family name.
     *
     * @return The family name
     */
    public String getFamilyName() {
        return familyName;
    }

    public void setFamilyName(String familyName) {
        this.familyName = familyName;
    }

    /**
     * Gets the user's preferred username.
     *
     * @return The preferred username
     */
    public String getPreferredUsername() {
        return preferredUsername;
    }

    public void setPreferredUsername(String preferredUsername) {
        this.preferredUsername = preferredUsername;
    }

    /**
     * Gets the user's email address.
     *
     * @return The email
     */
    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    /**
     * Gets whether the email is verified.
     *
     * @return True if email is verified
     */
    public boolean isEmailVerified() {
        return emailVerified;
    }

    public void setEmailVerified(boolean emailVerified) {
        this.emailVerified = emailVerified;
    }

    /**
     * Gets the last update time (unix seconds).
     *
     * @return The updated at time
     */
    public long getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(long updatedAt) {
        this.updatedAt = updatedAt;
    }

    /**
     * Gets the realm access with roles.
     *
     * @return The realm access
     */
    public RealmAccess getRealmAccess() {
        return realmAccess;
    }

    public void setRealmAccess(RealmAccess realmAccess) {
        this.realmAccess = realmAccess;
    }

    /**
     * Gets the resource access map.
     *
     * @return The resource access map
     */
    public java.util.Map<String, ResourceAccess> getResourceAccess() {
        return resourceAccess;
    }

    public void setResourceAccess(java.util.Map<String, ResourceAccess> resourceAccess) {
        this.resourceAccess = resourceAccess;
    }

    /**
     * Gets all roles from realm_access.
     *
     * @return List of realm roles
     */
    public List<String> getRealmRoles() {
        if (realmAccess == null || realmAccess.getRoles() == null) {
            return new ArrayList<>();
        }
        return new ArrayList<>(realmAccess.getRoles());
    }

    /**
     * Gets all roles from a specific resource.
     *
     * @param resource The resource name
     * @return List of roles for the resource
     */
    public List<String> getResourceRoles(String resource) {
        if (resourceAccess == null || resourceAccess.isEmpty()) {
            return new ArrayList<>();
        }
        ResourceAccess access = resourceAccess.get(resource);
        if (access == null || access.getRoles() == null) {
            return new ArrayList<>();
        }
        return new ArrayList<>(access.getRoles());
    }

    /**
     * Represents the realm_access claim structure.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class RealmAccess {
        private List<String> roles = new ArrayList<>();

        public List<String> getRoles() {
            return roles;
        }

        public void setRoles(List<String> roles) {
            this.roles = roles;
        }
    }

    /**
     * Represents resource access claim structure.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class ResourceAccess {
        private List<String> roles = new ArrayList<>();

        public List<String> getRoles() {
            return roles;
        }

        public void setRoles(List<String> roles) {
            this.roles = roles;
        }
    }
}
