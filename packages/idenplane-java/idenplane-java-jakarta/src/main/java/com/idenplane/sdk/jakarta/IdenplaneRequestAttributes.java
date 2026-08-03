package com.idenplane.sdk.jakarta;

import com.idenplane.sdk.models.TokenClaims;
import jakarta.servlet.ServletRequest;

/**
 * Holds the request-attribute key {@link IdenplaneAuthenticationFilter} uses to expose the
 * validated token claims to downstream servlets, and a convenience accessor.
 */
public final class IdenplaneRequestAttributes {

    public static final String CLAIMS_ATTRIBUTE = "com.idenplane.sdk.claims";

    private IdenplaneRequestAttributes() {
    }

    /**
     * Gets the claims validated by {@link IdenplaneAuthenticationFilter} for this request.
     *
     * @param request the current request
     * @return the validated claims, or {@code null} if the filter didn't run or authentication
     *         failed
     */
    public static TokenClaims getClaims(ServletRequest request) {
        Object claims = request.getAttribute(CLAIMS_ATTRIBUTE);
        return claims instanceof TokenClaims ? (TokenClaims) claims : null;
    }
}
