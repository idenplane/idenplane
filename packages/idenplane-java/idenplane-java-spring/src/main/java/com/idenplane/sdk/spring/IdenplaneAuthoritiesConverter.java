package com.idenplane.sdk.spring;

import org.springframework.core.convert.converter.Converter;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;

/**
 * Maps Idenplane's {@code realm_access.roles} and {@code resource_access.<clientId>.roles}
 * claims onto Spring Security {@link GrantedAuthority} instances, so {@code @PreAuthorize} and
 * friends can use {@code hasRole(...)}/{@code hasAuthority(...)} directly against roles issued
 * by the realm, without every application reimplementing this claim traversal.
 *
 * <p>Realm roles map to {@code ROLE_<role>} (Spring's {@code hasRole(...)} convention). Client
 * (resource) roles for the configured {@code clientId} map to {@code ROLE_<clientId>_<role>} to
 * avoid colliding with realm roles or another client's roles of the same name.
 */
public class IdenplaneAuthoritiesConverter implements Converter<Jwt, Collection<GrantedAuthority>> {

    private final String clientId;

    public IdenplaneAuthoritiesConverter(String clientId) {
        this.clientId = clientId;
    }

    @Override
    public Collection<GrantedAuthority> convert(Jwt jwt) {
        List<GrantedAuthority> authorities = new ArrayList<>();

        Map<String, Object> realmAccess = jwt.getClaimAsMap("realm_access");
        if (realmAccess != null) {
            for (String role : rolesOf(realmAccess)) {
                authorities.add(new SimpleGrantedAuthority("ROLE_" + role));
            }
        }

        Map<String, Object> resourceAccess = jwt.getClaimAsMap("resource_access");
        if (resourceAccess != null && resourceAccess.get(clientId) instanceof Map<?, ?> clientAccess) {
            for (String role : rolesOf(asStringObjectMap(clientAccess))) {
                authorities.add(new SimpleGrantedAuthority("ROLE_" + clientId + "_" + role));
            }
        }

        return authorities;
    }

    @SuppressWarnings("unchecked")
    private static List<String> rolesOf(Map<String, Object> accessClaim) {
        Object roles = accessClaim.get("roles");
        if (roles instanceof List<?> list) {
            return (List<String>) list;
        }
        return List.of();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asStringObjectMap(Map<?, ?> map) {
        return (Map<String, Object>) map;
    }
}
