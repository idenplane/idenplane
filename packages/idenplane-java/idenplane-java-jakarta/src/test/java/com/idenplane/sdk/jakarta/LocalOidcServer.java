package com.idenplane.sdk.jakarta;

import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;

/**
 * A minimal real HTTP server serving an OIDC discovery document and JWKS, for real end-to-end
 * validation. Public so the jaxrs test package can reuse it.
 */
public final class LocalOidcServer implements AutoCloseable {

    private final HttpServer server;
    public final String issuer;

    private LocalOidcServer(HttpServer server, String issuer) {
        this.server = server;
        this.issuer = issuer;
    }

    public static LocalOidcServer start(JakartaTestTokens tokens) throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        String issuer = "http://127.0.0.1:" + server.getAddress().getPort();

        server.createContext("/.well-known/openid-configuration", exchange -> respond(exchange, "{"
                + "\"issuer\":\"" + issuer + "\","
                + "\"authorization_endpoint\":\"" + issuer + "/protocol/openid-connect/auth\","
                + "\"token_endpoint\":\"" + issuer + "/protocol/openid-connect/token\","
                + "\"jwks_uri\":\"" + issuer + "/protocol/openid-connect/certs\""
                + "}"));
        server.createContext("/protocol/openid-connect/certs", exchange -> respond(exchange, tokens.jwksJson()));
        server.start();

        return new LocalOidcServer(server, issuer);
    }

    private static void respond(com.sun.net.httpserver.HttpExchange exchange, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(200, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }

    @Override
    public void close() {
        server.stop(0);
    }
}
