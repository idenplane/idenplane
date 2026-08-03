package com.idenplane.sdk.jakarta.jaxrs;

import com.idenplane.sdk.IdenplaneClient;
import com.idenplane.sdk.TokenValidationException;
import com.idenplane.sdk.jakarta.internal.BearerTokenExtractor;
import com.idenplane.sdk.jakarta.internal.JsonErrorBody;
import com.idenplane.sdk.models.TokenClaims;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

import java.util.Objects;

/**
 * JAX-RS {@link ContainerRequestFilter} that validates the {@code Authorization: Bearer <token>}
 * header against an Idenplane realm, aborting the request with 401 if it's missing or invalid.
 *
 * <p>On success, the validated claims are stored as a JAX-RS request property, retrievable via
 * {@link #getClaims(ContainerRequestContext)}.
 *
 * <p>Not annotated {@code @Provider} — register it explicitly (e.g.
 * {@code ResourceConfig.register(new IdenplaneContainerRequestFilter(client))}) since it needs an
 * {@link IdenplaneClient} instance, which a no-arg auto-discovered filter couldn't be given.
 */
public class IdenplaneContainerRequestFilter implements ContainerRequestFilter {

    private static final String CLAIMS_PROPERTY = "com.idenplane.sdk.claims";

    private final IdenplaneClient client;

    public IdenplaneContainerRequestFilter(IdenplaneClient client) {
        this.client = Objects.requireNonNull(client, "client is required");
    }

    @Override
    public void filter(ContainerRequestContext requestContext) {
        String authorizationHeader = requestContext.getHeaderString(HttpHeaders.AUTHORIZATION);
        String token = BearerTokenExtractor.extract(authorizationHeader);
        if (token == null) {
            abortUnauthorized(requestContext, "Missing Authorization: Bearer <token> header");
            return;
        }

        TokenClaims claims;
        try {
            claims = client.validateAccessToken(token);
        } catch (TokenValidationException e) {
            abortUnauthorized(requestContext, e.getMessage());
            return;
        }

        requestContext.setProperty(CLAIMS_PROPERTY, claims);
    }

    /**
     * Gets the claims validated by this filter for the current request.
     *
     * @param requestContext the current request context
     * @return the validated claims, or {@code null} if the filter didn't run or authentication
     *         failed
     */
    public static TokenClaims getClaims(ContainerRequestContext requestContext) {
        Object claims = requestContext.getProperty(CLAIMS_PROPERTY);
        return claims instanceof TokenClaims ? (TokenClaims) claims : null;
    }

    private static void abortUnauthorized(ContainerRequestContext requestContext, String message) {
        requestContext.abortWith(Response.status(Response.Status.UNAUTHORIZED)
                .type(MediaType.APPLICATION_JSON)
                .entity(JsonErrorBody.unauthorized(message))
                .build());
    }
}
