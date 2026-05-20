// Package client provides HTTP client functionality for Idenplane API communication
package client

import (
	"context"
	"fmt"
)

// ClientType represents the type of OAuth client
type ClientType string

const (
	ClientTypeConfidential ClientType = "CONFIDENTIAL"
	ClientTypePublic       ClientType = "PUBLIC"
)

// Client represents an OAuth client in the Idenplane API
type Client struct {
	ID                              string   `json:"id"`
	RealmID                         string   `json:"realmId"`
	ClientID                        string   `json:"clientId"`
	ClientType                      string   `json:"clientType"`
	Name                            string   `json:"name,omitempty"`
	Description                     string   `json:"description,omitempty"`
	Enabled                         bool     `json:"enabled,omitempty"`
	RedirectUris                    []string `json:"redirectUris,omitempty"`
	WebOrigins                      []string `json:"webOrigins,omitempty"`
	GrantTypes                      []string `json:"grantTypes,omitempty"`
	RequireConsent                  bool     `json:"requireConsent,omitempty"`
	BackchannelLogoutUri            string   `json:"backchannelLogoutUri,omitempty"`
	BackchannelLogoutSessionRequired bool    `json:"backchannelLogoutSessionRequired,omitempty"`
	ServiceAccountUserID            string   `json:"serviceAccountUserId,omitempty"`
	// Response-only fields (only populated on creation)
	ClientSecret       string `json:"clientSecret,omitempty"`
	SecretDisplayedOnce bool  `json:"secretDisplayedOnce,omitempty"`
	SecretWarning      string `json:"secretWarning,omitempty"`
	// Timestamps
	CreatedAt string `json:"createdAt,omitempty"`
	UpdatedAt string `json:"updatedAt,omitempty"`
}

// CreateClientRequest represents the request body for creating a client
type CreateClientRequest struct {
	ClientID                        string   `json:"clientId"`
	ClientType                      string   `json:"clientType,omitempty"`
	Name                            string   `json:"name,omitempty"`
	Description                     string   `json:"description,omitempty"`
	Enabled                         *bool    `json:"enabled,omitempty"`
	RedirectUris                    []string `json:"redirectUris,omitempty"`
	WebOrigins                      []string `json:"webOrigins,omitempty"`
	GrantTypes                      []string `json:"grantTypes,omitempty"`
	RequireConsent                  *bool    `json:"requireConsent,omitempty"`
	BackchannelLogoutUri            string   `json:"backchannelLogoutUri,omitempty"`
	BackchannelLogoutSessionRequired *bool   `json:"backchannelLogoutSessionRequired,omitempty"`
	PublicClient                    *bool    `json:"publicClient,omitempty"`
}

// UpdateClientRequest represents the request body for updating a client
type UpdateClientRequest struct {
	ClientType                      string   `json:"clientType,omitempty"`
	Name                            string   `json:"name,omitempty"`
	Description                     string   `json:"description,omitempty"`
	Enabled                         *bool    `json:"enabled,omitempty"`
	RedirectUris                    []string `json:"redirectUris,omitempty"`
	WebOrigins                      []string `json:"webOrigins,omitempty"`
	GrantTypes                      []string `json:"grantTypes,omitempty"`
	RequireConsent                  *bool    `json:"requireConsent,omitempty"`
	BackchannelLogoutUri            string   `json:"backchannelLogoutUri,omitempty"`
	BackchannelLogoutSessionRequired *bool   `json:"backchannelLogoutSessionRequired,omitempty"`
}

// RegenerateSecretResponse represents the response when regenerating a client secret
type RegenerateSecretResponse struct {
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
	SecretWarning string `json:"secretWarning,omitempty"`
}

// ServiceAccountUser represents a service account user
type ServiceAccountUser struct {
	ID        string   `json:"id"`
	Username  string   `json:"username"`
	Enabled   bool     `json:"enabled"`
	CreatedAt string   `json:"createdAt,omitempty"`
	UserRoles []Role   `json:"userRoles,omitempty"`
}

// ClientsClient provides methods for interacting with Idenplane clients API
type ClientsClient struct {
	httpClient *HTTPClient
}

// NewClientsClient creates a new ClientsClient
func NewClientsClient(httpClient *HTTPClient) *ClientsClient {
	return &ClientsClient{
		httpClient: httpClient,
	}
}

// CreateClient creates a new client in a realm
func (c *ClientsClient) CreateClient(ctx context.Context, realmName string, req CreateClientRequest) (*Client, error) {
	var client Client
	path := fmt.Sprintf("/admin/realms/%s/clients", realmName)
	err := c.httpClient.PostJSON(ctx, path, req, nil, &client)
	if err != nil {
		return nil, fmt.Errorf("failed to create client: %w", err)
	}
	return &client, nil
}

// ListClients returns all clients in a realm
func (c *ClientsClient) ListClients(ctx context.Context, realmName string) ([]Client, error) {
	var clients []Client
	path := fmt.Sprintf("/admin/realms/%s/clients", realmName)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &clients)
	if err != nil {
		return nil, fmt.Errorf("failed to list clients: %w", err)
	}
	return clients, nil
}

// GetClient returns a client by its clientId or UUID
func (c *ClientsClient) GetClient(ctx context.Context, realmName, clientID string) (*Client, error) {
	var client Client
	path := fmt.Sprintf("/admin/realms/%s/clients/%s", realmName, clientID)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &client)
	if err != nil {
		return nil, fmt.Errorf("failed to get client %s: %w", clientID, err)
	}
	return &client, nil
}

// UpdateClient updates a client
func (c *ClientsClient) UpdateClient(ctx context.Context, realmName, clientID string, req UpdateClientRequest) (*Client, error) {
	var client Client
	path := fmt.Sprintf("/admin/realms/%s/clients/%s", realmName, clientID)
	err := c.httpClient.PutJSON(ctx, path, req, &client)
	if err != nil {
		return nil, fmt.Errorf("failed to update client %s: %w", clientID, err)
	}
	return &client, nil
}

// DeleteClient deletes a client
func (c *ClientsClient) DeleteClient(ctx context.Context, realmName, clientID string) error {
	path := fmt.Sprintf("/admin/realms/%s/clients/%s", realmName, clientID)
	_, err := c.httpClient.Delete(ctx, path, nil)
	if err != nil {
		return fmt.Errorf("failed to delete client %s: %w", clientID, err)
	}
	return nil
}

// GetServiceAccount returns the service account user for a client
func (c *ClientsClient) GetServiceAccount(ctx context.Context, realmName, clientID string) (*ServiceAccountUser, error) {
	var user ServiceAccountUser
	path := fmt.Sprintf("/admin/realms/%s/clients/%s/service-account", realmName, clientID)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &user)
	if err != nil {
		return nil, fmt.Errorf("failed to get service account for client %s: %w", clientID, err)
	}
	return &user, nil
}

// RegenerateSecret regenerates the client secret for a confidential client
func (c *ClientsClient) RegenerateSecret(ctx context.Context, realmName, clientID string) (*RegenerateSecretResponse, error) {
	var resp RegenerateSecretResponse
	path := fmt.Sprintf("/admin/realms/%s/clients/%s/client-secret/regenerate", realmName, clientID)
	err := c.httpClient.PostJSON(ctx, path, nil, nil, &resp)
	if err != nil {
		return nil, fmt.Errorf("failed to regenerate secret for client %s: %w", clientID, err)
	}
	return &resp, nil
}