package com.idenplane.sdk.reactive;

import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;

/** A minimal real HTTP server serving an OIDC discovery document, JWKS, and token endpoint. */
final class LocalOidcServer implements AutoCloseable {

    private final HttpServer server;
    final String issuer;

    private LocalOidcServer(HttpServer server, String issuer) {
        this.server = server;
        this.issuer = issuer;
    }

    static LocalOidcServer start(ReactiveTestTokens tokens) throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        String issuer = "http://127.0.0.1:" + server.getAddress().getPort();

        server.createContext("/.well-known/openid-configuration", exchange -> respond(exchange, "{"
                + "\"issuer\":\"" + issuer + "\","
                + "\"authorization_endpoint\":\"" + issuer + "/protocol/openid-connect/auth\","
                + "\"token_endpoint\":\"" + issuer + "/protocol/openid-connect/token\","
                + "\"userinfo_endpoint\":\"" + issuer + "/protocol/openid-connect/userinfo\","
                + "\"end_session_endpoint\":\"" + issuer + "/protocol/openid-connect/logout\","
                + "\"jwks_uri\":\"" + issuer + "/protocol/openid-connect/certs\""
                + "}"));
        server.createContext("/protocol/openid-connect/certs", exchange -> respond(exchange, tokens.jwksJson()));
        server.createContext("/protocol/openid-connect/token", exchange -> respond(exchange,
                "{\"access_token\":\"at-123\",\"token_type\":\"Bearer\",\"expires_in\":300}"));
        server.createContext("/protocol/openid-connect/userinfo", exchange -> respond(exchange,
                "{\"sub\":\"user-123\",\"preferred_username\":\"ada\"}"));
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
