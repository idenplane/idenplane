package com.idenplane.sdk.jakarta;

import com.idenplane.sdk.IdenplaneClient;
import com.nimbusds.jwt.JWTClaimsSet;
import jakarta.servlet.FilterChain;
import jakarta.servlet.FilterConfig;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.time.Instant;
import java.util.Date;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class IdenplaneAuthenticationFilterTest {

    private static final String CLIENT_ID = "my-client";

    private JakartaTestTokens tokens;
    private LocalOidcServer oidc;
    private IdenplaneAuthenticationFilter filter;

    private HttpServletRequest request;
    private HttpServletResponse response;
    private FilterChain chain;
    private StringWriter responseBody;

    @BeforeEach
    void setUp() throws IOException {
        tokens = JakartaTestTokens.generate();
        oidc = LocalOidcServer.start(tokens);
        IdenplaneClient client = IdenplaneClient.builder(oidc.issuer, CLIENT_ID).build();
        filter = new IdenplaneAuthenticationFilter(client);

        request = mock(HttpServletRequest.class);
        response = mock(HttpServletResponse.class);
        chain = mock(FilterChain.class);
        responseBody = new StringWriter();
        when(response.getWriter()).thenReturn(new PrintWriter(responseBody));
    }

    @AfterEach
    void tearDown() {
        oidc.close();
    }

    @Test
    void rejectsRequestWithNoAuthorizationHeader() throws Exception {
        when(request.getHeader("Authorization")).thenReturn(null);

        filter.doFilter(request, response, chain);

        verify(response).setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        verify(chain, never()).doFilter(any(), any());
        assertThat(responseBody.toString()).contains("Missing Authorization");
    }

    @Test
    void rejectsMalformedAuthorizationHeader() throws Exception {
        when(request.getHeader("Authorization")).thenReturn("Basic dXNlcjpwYXNz");

        filter.doFilter(request, response, chain);

        verify(response).setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        verify(chain, never()).doFilter(any(), any());
    }

    @Test
    void acceptsValidTokenAndExposesClaims() throws Exception {
        String token = tokens.sign(validClaims());
        when(request.getHeader("Authorization")).thenReturn("Bearer " + token);

        filter.doFilter(request, response, chain);

        verify(chain).doFilter(request, response);
        verify(response, never()).setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        verify(request).setAttribute(org.mockito.ArgumentMatchers.eq(IdenplaneRequestAttributes.CLAIMS_ATTRIBUTE),
                any());
    }

    @Test
    void rejectsExpiredToken() throws Exception {
        JWTClaimsSet expired = new JWTClaimsSet.Builder()
                .claim("iss", oidc.issuer)
                .claim("sub", "user-123")
                .claim("aud", CLIENT_ID)
                .claim("typ", "Bearer")
                .issueTime(Date.from(Instant.now().minusSeconds(1200)))
                .expirationTime(Date.from(Instant.now().minusSeconds(600)))
                .build();
        String token = tokens.sign(expired);
        when(request.getHeader("Authorization")).thenReturn("Bearer " + token);

        filter.doFilter(request, response, chain);

        verify(response).setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        verify(chain, never()).doFilter(any(), any());
    }

    @Test
    void initBuildsClientFromInitParamsWhenNoneProvided() throws Exception {
        IdenplaneAuthenticationFilter webXmlFilter = new IdenplaneAuthenticationFilter();
        FilterConfig config = mock(FilterConfig.class);
        when(config.getInitParameter("issuer-uri")).thenReturn(oidc.issuer);
        when(config.getInitParameter("client-id")).thenReturn(CLIENT_ID);

        webXmlFilter.init(config);

        String token = tokens.sign(validClaims());
        when(request.getHeader("Authorization")).thenReturn("Bearer " + token);
        webXmlFilter.doFilter(request, response, chain);

        verify(chain).doFilter(request, response);
    }

    @Test
    void initThrowsWhenNoClientAndNoInitParams() {
        IdenplaneAuthenticationFilter webXmlFilter = new IdenplaneAuthenticationFilter();
        FilterConfig config = mock(FilterConfig.class);

        assertThatThrownBy(() -> webXmlFilter.init(config)).isInstanceOf(IllegalStateException.class);
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
}
