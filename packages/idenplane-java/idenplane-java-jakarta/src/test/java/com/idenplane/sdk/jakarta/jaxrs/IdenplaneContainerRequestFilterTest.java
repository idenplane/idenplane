package com.idenplane.sdk.jakarta.jaxrs;

import com.idenplane.sdk.IdenplaneClient;
import com.idenplane.sdk.jakarta.JakartaTestTokens;
import com.idenplane.sdk.jakarta.LocalOidcServer;
import com.nimbusds.jwt.JWTClaimsSet;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.Response;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.time.Instant;
import java.util.Date;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class IdenplaneContainerRequestFilterTest {

    private static final String CLIENT_ID = "my-client";

    private JakartaTestTokens tokens;
    private LocalOidcServer oidc;
    private IdenplaneContainerRequestFilter filter;
    private ContainerRequestContext requestContext;

    @BeforeEach
    void setUp() throws IOException {
        tokens = JakartaTestTokens.generate();
        oidc = LocalOidcServer.start(tokens);

        IdenplaneClient client = IdenplaneClient.builder(oidc.issuer, CLIENT_ID).build();
        filter = new IdenplaneContainerRequestFilter(client);
        requestContext = mock(ContainerRequestContext.class);
    }

    @AfterEach
    void tearDown() {
        oidc.close();
    }

    @Test
    void rejectsRequestWithNoAuthorizationHeader() {
        when(requestContext.getHeaderString(HttpHeaders.AUTHORIZATION)).thenReturn(null);

        filter.filter(requestContext);

        verify(requestContext).abortWith(argThatStatusIs(Response.Status.UNAUTHORIZED));
        verify(requestContext, never()).setProperty(any(), any());
    }

    @Test
    void acceptsValidTokenAndExposesClaims() {
        String token = tokens.sign(validClaims());
        when(requestContext.getHeaderString(HttpHeaders.AUTHORIZATION)).thenReturn("Bearer " + token);

        filter.filter(requestContext);

        verify(requestContext, never()).abortWith(any());
        verify(requestContext).setProperty(eq("com.idenplane.sdk.claims"), any());
    }

    @Test
    void rejectsExpiredToken() {
        JWTClaimsSet expired = new JWTClaimsSet.Builder()
                .claim("iss", oidc.issuer)
                .claim("sub", "user-123")
                .claim("aud", CLIENT_ID)
                .claim("typ", "Bearer")
                .issueTime(Date.from(Instant.now().minusSeconds(1200)))
                .expirationTime(Date.from(Instant.now().minusSeconds(600)))
                .build();
        String token = tokens.sign(expired);
        when(requestContext.getHeaderString(HttpHeaders.AUTHORIZATION)).thenReturn("Bearer " + token);

        filter.filter(requestContext);

        verify(requestContext).abortWith(argThatStatusIs(Response.Status.UNAUTHORIZED));
    }

    @Test
    void getClaims_returnsNullWhenPropertyAbsent() {
        when(requestContext.getProperty("com.idenplane.sdk.claims")).thenReturn(null);

        assertThat(IdenplaneContainerRequestFilter.getClaims(requestContext)).isNull();
    }

    private JWTClaimsSet validClaims() {
        return new JWTClaimsSet.Builder()
                .claim("iss", oidc.issuer)
                .claim("sub", "user-123")
                .claim("aud", CLIENT_ID)
                .claim("typ", "Bearer")
                .issueTime(Date.from(Instant.now()))
                .expirationTime(Date.from(Instant.now().plusSeconds(300)))
                .build();
    }

    private static Response argThatStatusIs(Response.Status status) {
        return org.mockito.ArgumentMatchers.argThat(
                response -> response != null && response.getStatus() == status.getStatusCode());
    }
}
