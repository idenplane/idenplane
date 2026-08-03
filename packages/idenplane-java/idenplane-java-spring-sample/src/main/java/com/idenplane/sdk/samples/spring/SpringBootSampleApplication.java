package com.idenplane.sdk.samples.spring;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Runnable demo of {@code idenplane-java-spring}'s OAuth2 Resource Server auto-configuration.
 *
 * <p>Set {@code idenplane.issuer-uri} and {@code idenplane.client-id} (e.g. in
 * {@code application.yml}, or as {@code IDENPLANE_ISSUER_URI}/{@code IDENPLANE_CLIENT_ID}
 * environment variables) to point at a real realm, then:
 *
 * <pre>{@code
 * mvn spring-boot:run
 * curl http://localhost:8080/public
 * curl -H "Authorization: Bearer <access-token>" http://localhost:8080/api/me
 * }</pre>
 */
@SpringBootApplication
public class SpringBootSampleApplication {

    public static void main(String[] args) {
        SpringApplication.run(SpringBootSampleApplication.class, args);
    }
}
