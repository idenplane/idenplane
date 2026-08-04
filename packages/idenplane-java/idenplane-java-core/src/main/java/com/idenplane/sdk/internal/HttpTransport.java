package com.idenplane.sdk.internal;

import java.util.Map;

/**
 * Minimal HTTP seam. Not part of the SDK's public API — it exists so {@code IdenplaneClient}
 * can be tested against a fake transport instead of a real network call. {@link ApacheHttpTransport}
 * is the production implementation.
 */
public interface HttpTransport {

    String get(String url);

    String getWithBearerToken(String url, String bearerToken);

    String postForm(String url, Map<String, String> formParams);
}
