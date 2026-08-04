package com.idenplane.sdk.internal;

import com.idenplane.sdk.IdenplaneClientException;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Exercises {@link ApacheHttpTransport} against a real local HTTP server rather than mocks, so
 * the actual Apache HttpClient 5 wiring (headers, form encoding, status handling) is verified,
 * not just assumed from reading the client's API.
 */
class ApacheHttpTransportTest {

    private HttpServer server;
    private String baseUrl;
    private final ApacheHttpTransport transport = new ApacheHttpTransport();

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    @Test
    void get_returnsResponseBodyOn200() throws IOException {
        server.createContext("/ok", exchange -> respond(exchange, 200, "hello"));
        server.start();

        String body = transport.get(baseUrl + "/ok");

        assertThat(body).isEqualTo("hello");
    }

    @Test
    void get_throwsOnNon2xxStatusIncludingBodyAndStatus() throws IOException {
        server.createContext("/broken", exchange -> respond(exchange, 500, "server exploded"));
        server.start();

        assertThatThrownBy(() -> transport.get(baseUrl + "/broken"))
                .isInstanceOf(IdenplaneClientException.class)
                .hasMessageContaining("500")
                .hasMessageContaining("server exploded");
    }

    @Test
    void get_throwsOnConnectionFailure() {
        // Nothing is listening on this port — simulates a network-level failure without
        // depending on any external host.
        assertThatThrownBy(() -> transport.get("http://127.0.0.1:1/unreachable"))
                .isInstanceOf(IdenplaneClientException.class);
    }

    @Test
    void getWithBearerToken_sendsAuthorizationHeader() throws IOException {
        AtomicReference<String> receivedAuthHeader = new AtomicReference<>();
        server.createContext("/secure", exchange -> {
            receivedAuthHeader.set(exchange.getRequestHeaders().getFirst("Authorization"));
            respond(exchange, 200, "profile-data");
        });
        server.start();

        String body = transport.getWithBearerToken(baseUrl + "/secure", "token-abc");

        assertThat(body).isEqualTo("profile-data");
        assertThat(receivedAuthHeader.get()).isEqualTo("Bearer token-abc");
    }

    @Test
    void postForm_sendsUrlEncodedBodyAndContentType() throws IOException {
        AtomicReference<String> receivedContentType = new AtomicReference<>();
        AtomicReference<String> receivedBody = new AtomicReference<>();
        server.createContext("/token", exchange -> {
            receivedContentType.set(exchange.getRequestHeaders().getFirst("Content-Type"));
            receivedBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            respond(exchange, 200, "{\"access_token\":\"at\"}");
        });
        server.start();

        Map<String, String> form = new LinkedHashMap<>();
        form.put("grant_type", "authorization_code");
        form.put("code", "abc 123");
        String body = transport.postForm(baseUrl + "/token", form);

        assertThat(body).isEqualTo("{\"access_token\":\"at\"}");
        assertThat(receivedContentType.get()).startsWith("application/x-www-form-urlencoded");
        assertThat(receivedBody.get()).contains("grant_type=authorization_code");
        assertThat(receivedBody.get()).contains("code=abc+123");
    }

    private static void respond(com.sun.net.httpserver.HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }
}
