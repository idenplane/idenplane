package com.idenplane.sdk.internal;

import com.idenplane.sdk.IdenplaneClientException;
import org.apache.hc.client5.http.classic.methods.HttpGet;
import org.apache.hc.client5.http.classic.methods.HttpPost;
import org.apache.hc.client5.http.entity.UrlEncodedFormEntity;
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient;
import org.apache.hc.client5.http.impl.classic.CloseableHttpResponse;
import org.apache.hc.client5.http.impl.classic.HttpClients;
import org.apache.hc.core5.http.NameValuePair;
import org.apache.hc.core5.http.ParseException;
import org.apache.hc.core5.http.io.entity.EntityUtils;
import org.apache.hc.core5.http.message.BasicNameValuePair;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * {@link HttpTransport} backed by Apache HttpClient 5.
 */
public final class ApacheHttpTransport implements HttpTransport {

    private final CloseableHttpClient httpClient = HttpClients.createDefault();

    @Override
    public String get(String url) {
        try (CloseableHttpResponse response = httpClient.execute(new HttpGet(url))) {
            return readBody(url, response);
        } catch (IOException e) {
            throw new IdenplaneClientException("GET " + url + " failed", e);
        }
    }

    @Override
    public String getWithBearerToken(String url, String bearerToken) {
        HttpGet request = new HttpGet(url);
        request.addHeader("Authorization", "Bearer " + bearerToken);
        try (CloseableHttpResponse response = httpClient.execute(request)) {
            return readBody(url, response);
        } catch (IOException e) {
            throw new IdenplaneClientException("GET " + url + " failed", e);
        }
    }

    @Override
    public String postForm(String url, Map<String, String> formParams) {
        HttpPost request = new HttpPost(url);
        List<NameValuePair> params = new ArrayList<>();
        formParams.forEach((key, value) -> params.add(new BasicNameValuePair(key, value)));
        request.setEntity(new UrlEncodedFormEntity(params, StandardCharsets.UTF_8));
        try (CloseableHttpResponse response = httpClient.execute(request)) {
            return readBody(url, response);
        } catch (IOException e) {
            throw new IdenplaneClientException("POST " + url + " failed", e);
        }
    }

    private String readBody(String url, CloseableHttpResponse response) throws IOException {
        int status = response.getCode();
        String body;
        try {
            body = response.getEntity() == null
                    ? ""
                    : EntityUtils.toString(response.getEntity(), StandardCharsets.UTF_8);
        } catch (ParseException e) {
            throw new IOException("Failed to read response body from " + url, e);
        }
        if (status < 200 || status >= 300) {
            throw new IdenplaneClientException("Request to " + url + " failed with HTTP " + status + ": " + body);
        }
        return body;
    }
}
