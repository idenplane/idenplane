package com.idenplane.sdk.jakarta.internal;

/**
 * Shared by the Servlet and JAX-RS filters — not part of the public API.
 */
public final class JsonErrorBody {

    private JsonErrorBody() {
    }

    public static String unauthorized(String message) {
        return "{\"error\":\"unauthorized\",\"error_description\":\"" + escape(message) + "\"}";
    }

    private static String escape(String value) {
        return value == null ? "" : value.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
