package com.idenplane.sdk;

/**
 * Thrown for network, HTTP, or configuration failures while talking to the Idenplane server.
 */
public class IdenplaneClientException extends RuntimeException {

    public IdenplaneClientException(String message) {
        super(message);
    }

    public IdenplaneClientException(String message, Throwable cause) {
        super(message, cause);
    }
}
