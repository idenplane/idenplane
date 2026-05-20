package com.idenplane.sdk.models;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * User information returned by the userinfo endpoint or parsed from the ID token.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class UserInfo {

    @JsonProperty("sub")
    private String sub;

    @JsonProperty("preferred_username")
    private String preferredUsername;

    @JsonProperty("name")
    private String name;

    @JsonProperty("given_name")
    private String givenName;

    @JsonProperty("family_name")
    private String familyName;

    @JsonProperty("email")
    private String email;

    @JsonProperty("email_verified")
    private boolean emailVerified;

    /**
     * Creates an empty UserInfo.
     */
    public UserInfo() {
    }

    /**
     * Creates a UserInfo with the subject.
     *
     * @param sub The subject (user ID)
     */
    public UserInfo(String sub) {
        this.sub = sub;
    }

    /**
     * Gets the subject (user ID).
     *
     * @return The subject
     */
    public String getSub() {
        return sub;
    }

    /**
     * Sets the subject (user ID).
     *
     * @param sub The subject
     */
    public void setSub(String sub) {
        this.sub = sub;
    }

    /**
     * Gets the preferred username.
     *
     * @return The preferred username
     */
    public String getPreferredUsername() {
        return preferredUsername;
    }

    /**
     * Sets the preferred username.
     *
     * @param preferredUsername The preferred username
     */
    public void setPreferredUsername(String preferredUsername) {
        this.preferredUsername = preferredUsername;
    }

    /**
     * Gets the user's full name.
     *
     * @return The name
     */
    public String getName() {
        return name;
    }

    /**
     * Sets the user's full name.
     *
     * @param name The name
     */
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

    /**
     * Sets the user's given name.
     *
     * @param givenName The given name
     */
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

    /**
     * Sets the user's family name.
     *
     * @param familyName The family name
     */
    public void setFamilyName(String familyName) {
        this.familyName = familyName;
    }

    /**
     * Gets the user's email address.
     *
     * @return The email
     */
    public String getEmail() {
        return email;
    }

    /**
     * Sets the user's email address.
     *
     * @param email The email
     */
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

    /**
     * Sets whether the email is verified.
     *
     * @param emailVerified True if email is verified
     */
    public void setEmailVerified(boolean emailVerified) {
        this.emailVerified = emailVerified;
    }

    @Override
    public String toString() {
        return "UserInfo{" +
                "sub='" + sub + '\'' +
                ", preferredUsername='" + preferredUsername + '\'' +
                ", name='" + name + '\'' +
                ", givenName='" + givenName + '\'' +
                ", familyName='" + familyName + '\'' +
                ", email='" + email + '\'' +
                ", emailVerified=" + emailVerified +
                '}';
    }
}
