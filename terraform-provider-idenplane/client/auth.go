// Package client provides HTTP client functionality for AuthMe API communication
package client

import (
	"fmt"
	"net/http"
	"strings"
	"time"
)

// AuthMode defines the authentication mode for the AuthMe API
type AuthMode string

const (
	// AuthModeAPIKey uses API key authentication via x-admin-api-key header
	AuthModeAPIKey AuthMode = "api_key"
	// AuthModeBearer uses Bearer token authentication via Authorization header
	AuthModeBearer AuthMode = "bearer"
)

// AuthConfig contains authentication configuration for the AuthMe API
type AuthConfig struct {
	// APIKey is the Admin API key for x-admin-api-key authentication
	APIKey string
	// AccessToken is the Bearer token for Authorization authentication
	AccessToken string
	// AuthMode specifies which authentication method to use
	AuthMode AuthMode
}

// ClientOption is a functional option for configuring the HTTP client
type ClientOption func(*HTTPClient)

// WithTimeout sets a custom timeout for the HTTP client
func WithTimeout(timeout time.Duration) ClientOption {
	return func(c *HTTPClient) {
		c.client.Timeout = timeout
	}
}

// WithAuthMode sets the authentication mode and credentials
func WithAuthMode(auth AuthConfig) ClientOption {
	return func(c *HTTPClient) {
		switch auth.AuthMode {
		case AuthModeAPIKey:
			if auth.APIKey != "" {
				c.headers["x-admin-api-key"] = auth.APIKey
				// Remove Bearer token if set
				delete(c.headers, "Authorization")
			}
		case AuthModeBearer:
			if auth.AccessToken != "" {
				c.headers["Authorization"] = fmt.Sprintf("Bearer %s", auth.AccessToken)
				// Remove API key if set
				delete(c.headers, "x-admin-api-key")
			}
		default:
			// Default to API key if available
			if auth.APIKey != "" {
				c.headers["x-admin-api-key"] = auth.APIKey
			} else if auth.AccessToken != "" {
				c.headers["Authorization"] = fmt.Sprintf("Bearer %s", auth.AccessToken)
			}
		}
		c.apiKey = auth.APIKey
	}
}

// WithCustomHeader adds a custom header to all requests
func WithCustomHeader(key, value string) ClientOption {
	return func(c *HTTPClient) {
		c.headers[key] = value
	}
}

// NewClient creates a new AuthMe API client with the specified server URL and options
func NewClient(serverURL string, opts ...ClientOption) (*HTTPClient, error) {
	if serverURL == "" {
		return nil, fmt.Errorf("server URL is required")
	}

	// Normalize server URL
	serverURL = strings.TrimSuffix(serverURL, "/")

	client := &HTTPClient{
		serverURL: serverURL,
		headers: map[string]string{
			"Content-Type": "application/json",
		},
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}

	// Apply options
	for _, opt := range opts {
		opt(client)
	}

	return client, nil
}

// DefaultClient creates a client with API key authentication
func DefaultClient(serverURL, apiKey string) (*HTTPClient, error) {
	return NewClient(serverURL, WithAuthMode(AuthConfig{
		APIKey:   apiKey,
		AuthMode: AuthModeAPIKey,
	}))
}

// BearerTokenClient creates a client with Bearer token authentication
func BearerTokenClient(serverURL, accessToken string) (*HTTPClient, error) {
	return NewClient(serverURL, WithAuthMode(AuthConfig{
		AccessToken: accessToken,
		AuthMode:    AuthModeBearer,
	}))
}