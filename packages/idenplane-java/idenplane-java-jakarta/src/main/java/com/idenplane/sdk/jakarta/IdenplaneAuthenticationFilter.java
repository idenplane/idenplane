package com.idenplane.sdk.jakarta;

import com.idenplane.sdk.IdenplaneClient;
import com.idenplane.sdk.TokenValidationException;
import com.idenplane.sdk.jakarta.internal.BearerTokenExtractor;
import com.idenplane.sdk.jakarta.internal.JsonErrorBody;
import com.idenplane.sdk.models.TokenClaims;
import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.FilterConfig;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Objects;

/**
 * Servlet {@link Filter} that validates the {@code Authorization: Bearer <token>} header of
 * incoming requests against an Idenplane realm, rejecting unauthenticated/invalid requests with
 * 401 before they reach the rest of the filter chain.
 *
 * <p>On success, the validated {@link TokenClaims} are exposed via
 * {@link IdenplaneRequestAttributes#getClaims(ServletRequest)}.
 *
 * <p>Only {@link TokenValidationException} (bad token) becomes a 401 here — a genuine
 * infrastructure failure ({@code IdenplaneClientException}, e.g. the realm's JWKS endpoint is
 * unreachable) is deliberately left to propagate as an unchecked exception, so it surfaces as a
 * 500 rather than being misreported as "your token is invalid".
 *
 * <p>Can be built with an already-configured {@link IdenplaneClient} (for programmatic/DI-based
 * registration), or registered via {@code web.xml} with {@code issuer-uri}/{@code client-id}
 * init-params, in which case {@link #init(FilterConfig)} builds the client itself.
 */
public class IdenplaneAuthenticationFilter implements Filter {

    private static final String ISSUER_URI_PARAM = "issuer-uri";
    private static final String CLIENT_ID_PARAM = "client-id";

    private IdenplaneClient client;

    /**
     * For {@code web.xml}-based registration — {@link #init(FilterConfig)} builds the client
     * from init-params.
     */
    public IdenplaneAuthenticationFilter() {
    }

    /**
     * For programmatic registration with an already-configured client.
     *
     * @param client the client to validate access tokens against
     */
    public IdenplaneAuthenticationFilter(IdenplaneClient client) {
        this.client = Objects.requireNonNull(client, "client is required");
    }

    @Override
    public void init(FilterConfig filterConfig) {
        if (client != null) {
            return;
        }
        String issuerUri = filterConfig.getInitParameter(ISSUER_URI_PARAM);
        String clientId = filterConfig.getInitParameter(CLIENT_ID_PARAM);
        if (issuerUri == null || clientId == null) {
            throw new IllegalStateException(
                    "IdenplaneAuthenticationFilter requires '" + ISSUER_URI_PARAM + "' and '"
                            + CLIENT_ID_PARAM + "' init-params when constructed without an IdenplaneClient");
        }
        this.client = IdenplaneClient.builder(issuerUri, clientId).build();
    }

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        HttpServletRequest httpRequest = (HttpServletRequest) request;
        HttpServletResponse httpResponse = (HttpServletResponse) response;

        String token = BearerTokenExtractor.extract(httpRequest.getHeader("Authorization"));
        if (token == null) {
            unauthorized(httpResponse, "Missing Authorization: Bearer <token> header");
            return;
        }

        TokenClaims claims;
        try {
            claims = client.validateAccessToken(token);
        } catch (TokenValidationException e) {
            unauthorized(httpResponse, e.getMessage());
            return;
        }

        request.setAttribute(IdenplaneRequestAttributes.CLAIMS_ATTRIBUTE, claims);
        chain.doFilter(request, response);
    }

    private static void unauthorized(HttpServletResponse response, String message) throws IOException {
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType("application/json");
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.getWriter().write(JsonErrorBody.unauthorized(message));
    }
}
