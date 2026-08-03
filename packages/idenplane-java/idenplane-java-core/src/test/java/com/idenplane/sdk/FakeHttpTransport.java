package com.idenplane.sdk;

import com.idenplane.sdk.internal.HttpTransport;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * In-memory {@link HttpTransport} test double. GET responses are registered per URL as a queue
 * so a test can simulate a value changing between calls (e.g. JWKS key rotation) — the last
 * queued value repeats once exhausted. Every call is recorded for assertions on what the client
 * actually sent.
 */
final class FakeHttpTransport implements HttpTransport {

    private final Map<String, Deque<String>> getResponseQueues = new HashMap<>();
    private final Map<String, String> postResponses = new HashMap<>();
    final List<String> requestedGetUrls = new ArrayList<>();
    final List<Map<String, String>> postedForms = new ArrayList<>();
    String lastPostUrl;
    String lastBearerToken;

    FakeHttpTransport withGetResponse(String url, String body) {
        return withGetResponses(url, body);
    }

    FakeHttpTransport withGetResponses(String url, String... bodies) {
        getResponseQueues.put(url, new ArrayDeque<>(Arrays.asList(bodies)));
        return this;
    }

    FakeHttpTransport withPostResponse(String url, String body) {
        postResponses.put(url, body);
        return this;
    }

    @Override
    public String get(String url) {
        requestedGetUrls.add(url);
        Deque<String> queue = getResponseQueues.get(url);
        if (queue == null || queue.isEmpty()) {
            throw new IdenplaneClientException("No fake response registered for GET " + url);
        }
        return queue.size() > 1 ? queue.poll() : queue.peek();
    }

    @Override
    public String getWithBearerToken(String url, String bearerToken) {
        this.lastBearerToken = bearerToken;
        return get(url);
    }

    @Override
    public String postForm(String url, Map<String, String> formParams) {
        lastPostUrl = url;
        postedForms.add(formParams);
        String body = postResponses.get(url);
        if (body == null) {
            throw new IdenplaneClientException("No fake response registered for POST " + url);
        }
        return body;
    }
}
