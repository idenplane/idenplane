// Package idenplane provides a Go SDK for Idenplane server-side authentication,
// token validation, user management, and middleware integration.
package idenplane

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// DefaultScopes is the default set of OAuth 2.0 scopes requested.
var DefaultScopes = []string{"openid", "profile", "email"}

// DefaultDiscoveryTTL is the default TTL for cached OIDC discovery documents.
const DefaultDiscoveryTTL = 1 * time.Hour

// DefaultHTTPTimeout is the default timeout for HTTP requests.
const DefaultHTTPTimeout = 30 * time.Second

// TokenResponse represents the raw token response from the token endpoint.
type TokenResponse struct {
	// AccessToken is the OAuth 2.0 access token.
	AccessToken string `json:"access_token"`
	// TokenType is the token type (typically "Bearer").
	TokenType string `json:"token_type"`
	// ExpiresIn is the number of seconds until the token expires.
	ExpiresIn int `json:"expires_in"`
	// RefreshToken is the OAuth 2.0 refresh token (optional).
	RefreshToken string `json:"refresh_token,omitempty"`
	// IDToken is the OpenID Connect ID token (optional).
	IDToken string `json:"id_token,omitempty"`
	// Scope is the granted scope string (optional).
	Scope string `json:"scope,omitempty"`
}

// User represents user information returned by the userinfo endpoint.
type User struct {
	// Subject is the unique user identifier.
	Subject string `json:"sub"`
	// PreferredUsername is the user's preferred username.
	PreferredUsername string `json:"preferred_username,omitempty"`
	// Name is the user's full name.
	Name string `json:"name,omitempty"`
	// GivenName is the user's first name.
	GivenName string `json:"given_name,omitempty"`
	// FamilyName is the user's last name.
	FamilyName string `json:"family_name,omitempty"`
	// Email is the user's email address.
	Email string `json:"email,omitempty"`
	// EmailVerified indicates whether the email has been verified.
	EmailVerified bool `json:"email_verified,omitempty"`
}

// OIDCConfiguration is an alias for OpenIDConfiguration for API compatibility.
// The discovery document is typically fetched from {serverUrl}/realms/{realm}/.well-known/openid-configuration.
// See [OpenIDConfiguration] in discovery.go for the full type definition.
type OIDCConfiguration = OpenIDConfiguration

// Config holds the configuration for an Idenplane client.
type Config struct {
	// ServerURL is the base URL of the Idenplane server (e.g., "https://auth.example.com").
	ServerURL string

	// Realm is the realm name to authenticate against.
	Realm string

	// ClientID is the OAuth 2.0 client ID (must be a confidential or public client in Idenplane).
	ClientID string

	// ClientSecret is the client secret for confidential clients. Optional for public clients.
	ClientSecret string

	// Scopes is the OAuth 2.0 scopes to request (default: ["openid", "profile", "email"]).
	Scopes []string

	// HTTPClient is the HTTP client to use. If nil, a default client is used.
	HTTPClient *http.Client

	// DiscoveryTTL is the TTL for cached OIDC discovery documents. Default: 1 hour.
	DiscoveryTTL time.Duration

	// HTTPTimeout is the timeout for HTTP requests. Default: 30 seconds.
	HTTPTimeout time.Duration
}

// Validate checks that the config has all required fields and returns an error if not.
func (c Config) Validate() error {
	c.ServerURL = strings.TrimSuffix(c.ServerURL, "/")
	if c.ServerURL == "" {
		return ErrInvalidConfig("ServerURL is required")
	}
	if c.Realm == "" {
		return ErrInvalidConfig("Realm is required")
	}
	if c.ClientID == "" {
		return ErrInvalidConfig("ClientID is required")
	}
	return nil
}

// discoveryURL returns the OIDC discovery URL for this configuration.
func (c Config) discoveryURL() string {
	return fmt.Sprintf("%s/realms/%s/.well-known/openid-configuration", c.ServerURL, c.Realm)
}

// httpClient returns the HTTP client, using the default if not set.
func (c Config) httpClient() *http.Client {
	if c.HTTPClient != nil {
		return c.HTTPClient
	}
	timeout := c.HTTPTimeout
	if timeout <= 0 {
		timeout = DefaultHTTPTimeout
	}
	return &http.Client{Timeout: timeout}
}

// scopes returns the scopes, using defaults if not set.
func (c Config) scopes() []string {
	if len(c.Scopes) == 0 {
		return DefaultScopes
	}
	return c.Scopes
}

// Client is the main Idenplane client for server-side operations.
type Client struct {
	config Config
}

// NewClient creates a new Idenplane client with the given configuration.
// It validates the config and returns an error if invalid.
func NewClient(config Config) (*Client, error) {
	if err := config.Validate(); err != nil {
		return nil, err
	}
	return &Client{config: config}, nil
}

// NewClientWithDefaults creates a new Idenplane client with default values for optional fields.
func NewClientWithDefaults(serverURL, realm, clientID string) (*Client, error) {
	return NewClient(Config{
		ServerURL:    serverURL,
		Realm:        realm,
		ClientID:     clientID,
		DiscoveryTTL: DefaultDiscoveryTTL,
		HTTPTimeout:  DefaultHTTPTimeout,
	})
}

// Config returns a copy of the client's configuration.
func (c *Client) Config() Config {
	return c.config
}

// realmAccessToken is a helper to get the realm access token for admin operations.
// In server-side scenarios, this would typically come from a service account.
func (c *Client) realmAccessToken() string {
	// For server-side SDK, clients need to provide their own tokens
	// or use client credentials flow. This method returns the client secret
	// as a bearer token for admin API access.
	return c.config.ClientSecret
}

// doRequest performs an HTTP request with proper error handling.
func (c *Client) doRequest(ctx context.Context, method, url string, body interface{}) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.config.httpClient().Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}

	return resp, nil
}

// Error is the base error type for Idenplane errors.
type Error struct {
	// Code is the error code.
	Code ErrorCode
	// Message is the human-readable error message.
	Message string
	// Cause is the underlying error, if any.
	Cause error
}

// ErrorCode represents an Idenplane error code.
type ErrorCode string

// Error codes.
const (
	ErrCodeInvalidConfig     ErrorCode = "invalid_config"
	ErrCodeNotAuthenticated ErrorCode = "not_authenticated"
	ErrCodeTokenExpired     ErrorCode = "token_expired"
	ErrCodeServerError      ErrorCode = "server_error"
	ErrCodeNetworkError     ErrorCode = "network_error"
	ErrCodeDiscoveryFailed  ErrorCode = "discovery_failed"
	ErrCodeJWTError         ErrorCode = "jwt_error"
	ErrCodeUserNotFound     ErrorCode = "user_not_found"
	ErrCodeInvalidToken     ErrorCode = "invalid_token"
)

// Error returns the error message.
func (e *Error) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("%s: %s (%v)", e.Code, e.Message, e.Cause)
	}
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

// Unwrap returns the underlying error, if any.
func (e *Error) Unwrap() error {
	return e.Cause
}

// Is reports whether this error matches the target error.
func (e *Error) Is(target error) bool {
	if t, ok := target.(*Error); ok {
		return e.Code == t.Code
	}
	return false
}

// ErrInvalidConfig creates an invalid configuration error.
func ErrInvalidConfig(message string) *Error {
	return &Error{Code: ErrCodeInvalidConfig, Message: message}
}

// ErrNotAuthenticated creates a not authenticated error.
func ErrNotAuthenticated() *Error {
	return &Error{Code: ErrCodeNotAuthenticated, Message: "User is not authenticated"}
}

// ErrTokenExpired creates a token expired error.
func ErrTokenExpired() *Error {
	return &Error{Code: ErrCodeTokenExpired, Message: "Access token has expired"}
}

// ErrServerError creates a server error.
func ErrServerError(message string) *Error {
	return &Error{Code: ErrCodeServerError, Message: message}
}

// ErrNetworkError creates a network error.
func ErrNetworkError(message string, cause error) *Error {
	return &Error{Code: ErrCodeNetworkError, Message: message, Cause: cause}
}

// ErrDiscoveryFailed creates a discovery failed error.
func ErrDiscoveryFailed(message string) *Error {
	return &Error{Code: ErrCodeDiscoveryFailed, Message: message}
}

// ErrJWTError creates a JWT error.
func ErrJWTError(message string) *Error {
	return &Error{Code: ErrCodeJWTError, Message: message}
}

// ErrUserNotFound creates a user not found error.
func ErrUserNotFound(userID string) *Error {
	return &Error{Code: ErrCodeUserNotFound, Message: fmt.Sprintf("User not found: %s", userID)}
}

// ErrInvalidToken creates an invalid token error.
func ErrInvalidToken(message string) *Error {
	return &Error{Code: ErrCodeInvalidToken, Message: message}
}

// IsRetryable returns true if the error is retryable (network error or server error).
func IsRetryable(err error) bool {
	if err == nil {
		return false
	}
	var idenplaneErr *Error
	if errors.As(err, &idenplaneErr) {
		return idenplaneErr.Code == ErrCodeNetworkError || idenplaneErr.Code == ErrCodeServerError
	}
	return true
}