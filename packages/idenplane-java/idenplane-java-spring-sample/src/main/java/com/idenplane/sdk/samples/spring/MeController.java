package com.idenplane.sdk.samples.spring;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
public class MeController {

    @GetMapping("/public")
    public Map<String, String> publicEndpoint() {
        return Map.of("message", "No authentication required for this endpoint.");
    }

    /**
     * Requires a valid access token. The subject and authorities here come straight from
     * {@code idenplane-java-spring}'s auto-configured {@code JwtDecoder} (signature/issuer/
     * audience validated) and {@code JwtAuthenticationConverter} (realm_access/resource_access
     * roles mapped to {@code ROLE_...} authorities) — this controller does no OIDC work itself.
     */
    @GetMapping("/api/me")
    public MeResponse me(@AuthenticationPrincipal Jwt jwt, Authentication authentication) {
        List<String> authorities = authentication.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .toList();
        return new MeResponse(jwt.getSubject(), authorities);
    }

    public record MeResponse(String sub, List<String> authorities) {
    }
}
