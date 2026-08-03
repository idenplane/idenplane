package com.idenplane.sdk.spring;

import com.idenplane.sdk.IdenplaneClient;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;

/**
 * Auto-configures Spring Security OAuth2 Resource Server support for an Idenplane realm: a
 * {@link JwtDecoder} (issuer + audience validated) and a {@link JwtAuthenticationConverter} that
 * maps {@code realm_access}/{@code resource_access} roles to authorities — plus an
 * {@link IdenplaneClient} bean for apps that need more than Bearer-token validation (the
 * Authorization Code flow, userinfo, logout).
 *
 * <p>Activates once {@code idenplane.issuer-uri} is set. To use it in a resource server, just
 * reference the {@code JwtDecoder} bean as usual:
 *
 * <pre>{@code
 * http.oauth2ResourceServer(oauth2 -> oauth2.jwt(Customizer.withDefaults()));
 * }</pre>
 *
 * Spring Security picks up the {@code JwtAuthenticationConverter} bean automatically.
 */
@AutoConfiguration
@ConditionalOnClass(JwtDecoder.class)
@ConditionalOnProperty(prefix = "idenplane", name = "issuer-uri")
@EnableConfigurationProperties(IdenplaneProperties.class)
public class IdenplaneAutoConfiguration {

    private final IdenplaneProperties properties;

    public IdenplaneAutoConfiguration(IdenplaneProperties properties) {
        this.properties = properties;
    }

    @Bean
    @ConditionalOnMissingBean(JwtDecoder.class)
    public JwtDecoder idenplaneJwtDecoder() {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withIssuerLocation(properties.getIssuerUri()).build();

        OAuth2TokenValidator<Jwt> withIssuer = JwtValidators.createDefaultWithIssuer(properties.getIssuerUri());
        OAuth2TokenValidator<Jwt> withAudience = new IdenplaneAudienceValidator(properties.getClientId());
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(withIssuer, withAudience));

        return decoder;
    }

    @Bean
    @ConditionalOnMissingBean(JwtAuthenticationConverter.class)
    public JwtAuthenticationConverter idenplaneJwtAuthenticationConverter() {
        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(new IdenplaneAuthoritiesConverter(properties.getClientId()));
        return converter;
    }

    @Bean
    @ConditionalOnMissingBean(IdenplaneClient.class)
    public IdenplaneClient idenplaneClient() {
        IdenplaneClient.Builder builder =
                IdenplaneClient.builder(properties.getIssuerUri(), properties.getClientId());
        if (properties.getClientSecret() != null) {
            builder.clientSecret(properties.getClientSecret());
        }
        return builder.build();
    }
}
