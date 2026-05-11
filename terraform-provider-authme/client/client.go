// Package client provides HTTP client functionality for AuthMe API communication
package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// HTTPClient is the AuthMe API HTTP client
type HTTPClient struct {
	serverURL string
	apiKey    string
	headers   map[string]string
	client    *http.Client
}

// HTTPClientConfig contains configuration for creating an HTTP client
type HTTPClientConfig struct {
	ServerURL string
	APIKey    string
	Timeout   time.Duration
}

// NewHTTPClient creates a new HTTP client for AuthMe API communication
func NewHTTPClient(config HTTPClientConfig) *HTTPClient {
	// Remove trailing slash from server URL
	serverURL := config.ServerURL
	if len(serverURL) > 0 && serverURL[len(serverURL)-1] == '/' {
		serverURL = serverURL[:len(serverURL)-1]
	}

	// Default timeout
	timeout := config.Timeout
	if timeout == 0 {
		timeout = 30 * time.Second
	}

	headers := map[string]string{
		"Content-Type": "application/json",
	}

	// Add API key authentication
	if config.APIKey != "" {
		headers["x-admin-api-key"] = config.APIKey
	}

	return &HTTPClient{
		serverURL: serverURL,
		apiKey:    config.APIKey,
		headers:   headers,
		client: &http.Client{
			Timeout: timeout,
		},
	}
}

// buildURL constructs a full URL from a path
func (c *HTTPClient) buildURL(path string) string {
	return c.serverURL + path
}

// buildURLWithQuery constructs a full URL from a path and query parameters
func (c *HTTPClient) buildURLWithQuery(path string, query map[string]string) (string, error) {
	fullURL := c.buildURL(path)

	if len(query) > 0 {
		params := url.Values{}
		for k, v := range query {
			if v != "" {
				params.Set(k, v)
			}
		}
		if len(params) > 0 {
			fullURL = fullURL + "?" + params.Encode()
		}
	}

	return fullURL, nil
}

// doRequest performs an HTTP request and returns the response body
func (c *HTTPClient) doRequest(ctx context.Context, method, url string, body interface{}) ([]byte, int, error) {
	var reqBody []byte
	if body != nil {
		var err error
		reqBody, err = json.Marshal(body)
		if err != nil {
			return nil, 0, fmt.Errorf("failed to marshal request body: %w", err)
		}
	}

	req, err := http.NewRequestWithContext(ctx, method, url, bytes.NewReader(reqBody))
	if err != nil {
		return nil, 0, fmt.Errorf("failed to create request: %w", err)
	}

	// Set headers
	for k, v := range c.headers {
		req.Header.Set(k, v)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, fmt.Errorf("failed to read response body: %w", err)
	}

	return respBody, resp.StatusCode, nil
}

// handleError converts an error response into a Go error
func (c *HTTPClient) handleError(respBody []byte, statusCode int) error {
	if statusCode >= 200 && statusCode < 300 {
		return nil
	}

	// Try to parse error message from response
	var errResp ErrorResponse
	if len(respBody) > 0 {
		if err := json.Unmarshal(respBody, &errResp); err == nil {
			if errResp.Message != "" {
				return fmt.Errorf("error %d: %s", statusCode, errResp.Message)
			}
			if len(errResp.Error) > 0 {
				return fmt.Errorf("error %d: %s", statusCode, errResp.Error)
			}
		}
	}

	return fmt.Errorf("error %d: %s", statusCode, http.StatusText(statusCode))
}

// ErrorResponse represents an API error response
type ErrorResponse struct {
	Message string   `json:"message"`
	Error   string   `json:"error"`
	Errors  []string `json:"errors"`
}

// Get performs a GET request
func (c *HTTPClient) Get(ctx context.Context, path string, query map[string]string) ([]byte, error) {
	fullURL, err := c.buildURLWithQuery(path, query)
	if err != nil {
		return nil, err
	}

	respBody, statusCode, err := c.doRequest(ctx, http.MethodGet, fullURL, nil)
	if err != nil {
		return nil, err
	}

	if err := c.handleError(respBody, statusCode); err != nil {
		return nil, err
	}

	return respBody, nil
}

// GetJSON performs a GET request and unmarshals the response into dest
func (c *HTTPClient) GetJSON(ctx context.Context, path string, query map[string]string, dest interface{}) error {
	respBody, err := c.Get(ctx, path, query)
	if err != nil {
		return err
	}

	if len(respBody) > 0 {
		if err := json.Unmarshal(respBody, dest); err != nil {
			return fmt.Errorf("failed to unmarshal response: %w", err)
		}
	}

	return nil
}

// Post performs a POST request
func (c *HTTPClient) Post(ctx context.Context, path string, body interface{}, query map[string]string) ([]byte, error) {
	fullURL, err := c.buildURLWithQuery(path, query)
	if err != nil {
		return nil, err
	}

	respBody, statusCode, err := c.doRequest(ctx, http.MethodPost, fullURL, body)
	if err != nil {
		return nil, err
	}

	if err := c.handleError(respBody, statusCode); err != nil {
		return nil, err
	}

	return respBody, nil
}

// PostJSON performs a POST request and unmarshals the response into dest
func (c *HTTPClient) PostJSON(ctx context.Context, path string, body interface{}, query map[string]string, dest interface{}) error {
	respBody, err := c.Post(ctx, path, body, query)
	if err != nil {
		return err
	}

	if len(respBody) > 0 && dest != nil {
		if err := json.Unmarshal(respBody, dest); err != nil {
			return fmt.Errorf("failed to unmarshal response: %w", err)
		}
	}

	return nil
}

// Put performs a PUT request
func (c *HTTPClient) Put(ctx context.Context, path string, body interface{}) ([]byte, error) {
	fullURL := c.buildURL(path)

	respBody, statusCode, err := c.doRequest(ctx, http.MethodPut, fullURL, body)
	if err != nil {
		return nil, err
	}

	if err := c.handleError(respBody, statusCode); err != nil {
		return nil, err
	}

	return respBody, nil
}

// PutJSON performs a PUT request and unmarshals the response into dest
func (c *HTTPClient) PutJSON(ctx context.Context, path string, body interface{}, dest interface{}) error {
	respBody, err := c.Put(ctx, path, body)
	if err != nil {
		return err
	}

	if len(respBody) > 0 && dest != nil {
		if err := json.Unmarshal(respBody, dest); err != nil {
			return fmt.Errorf("failed to unmarshal response: %w", err)
		}
	}

	return nil
}

// Delete performs a DELETE request
func (c *HTTPClient) Delete(ctx context.Context, path string, body interface{}) ([]byte, error) {
	fullURL := c.buildURL(path)

	respBody, statusCode, err := c.doRequest(ctx, http.MethodDelete, fullURL, body)
	if err != nil {
		return nil, err
	}

	if err := c.handleError(respBody, statusCode); err != nil {
		return nil, err
	}

	return respBody, nil
}

// DeleteJSON performs a DELETE request and unmarshals the response into dest
func (c *HTTPClient) DeleteJSON(ctx context.Context, path string, body interface{}, dest interface{}) error {
	respBody, err := c.Delete(ctx, path, body)
	if err != nil {
		return err
	}

	if len(respBody) > 0 && dest != nil {
		if err := json.Unmarshal(respBody, dest); err != nil {
			return fmt.Errorf("failed to unmarshal response: %w", err)
		}
	}

	return nil
}