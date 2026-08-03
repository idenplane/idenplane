package com.idenplane.sdk.spring;

import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;

/**
 * Validates that a JWT's {@code aud} claim contains the configured client ID.
 *
 * <p>{@link org.springframework.security.oauth2.jwt.JwtValidators#createDefaultWithIssuer}
 * checks the issuer and timestamps but deliberately leaves audience validation to the
 * application, since it's application-specific — without this, a token minted for a completely
 * different client in the same realm would still pass.
 */
public class IdenplaneAudienceValidator implements OAuth2TokenValidator<Jwt> {

    private static final OAuth2Error INVALID_AUDIENCE =
            new OAuth2Error("invalid_token", "The required audience is missing", null);

    private final String clientId;

    public IdenplaneAudienceValidator(String clientId) {
        this.clientId = clientId;
    }

    @Override
    public OAuth2TokenValidatorResult validate(Jwt jwt) {
        if (jwt.getAudience() != null && jwt.getAudience().contains(clientId)) {
            return OAuth2TokenValidatorResult.success();
        }
        return OAuth2TokenValidatorResult.failure(INVALID_AUDIENCE);
    }
}
