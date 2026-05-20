// Package client provides HTTP client functionality for AuthMe API communication
package client

import (
	"context"
	"fmt"
)

// IdentityProvider represents an identity provider in the AuthMe API
type IdentityProvider struct {
	ID                       string   `json:"id"`
	RealmID                  string   `json:"realmId,omitempty"`
	Alias                    string   `json:"alias"`
	DisplayName              string   `json:"displayName,omitempty"`
	Enabled                  bool     `json:"enabled,omitempty"`
	ProviderID               string   `json:"providerId"`
	FirstBrokerLoginFlowAlias string  `json:"firstBrokerLoginFlowAlias,omitempty"`
	PostBrokerLoginFlowAlias string   `json:"postBrokerLoginFlowAlias,omitempty"`
	InternalID               string   `json:"internalId,omitempty"`
	// Provider configuration
	TrustEmail               bool     `json:"trustEmail,omitempty"`
	StoreToken               bool     `json:"storeToken,omitempty"`
	ReadOnly                 bool     `json:"readOnly,omitempty"`
	AddReadTokenRoleOnCreate bool     `json:"addReadTokenRoleOnCreate,omitempty"`
	SyncMode                 string   `json:"syncMode,omitempty"`
	// Discovery metadata
	Discoverable             bool     `json:"discoverable,omitempty"`
	// SAML specific
	SamlMetadataURL          string   `json:"samlMetadataUrl,omitempty"`
	SamlMetadata             string   `json:"samlMetadata,omitempty"`
	WantAssertionsSigned     bool     `json:"wantAssertionsSigned,omitempty"`
	// OIDC specific
	OidcMetadataURL          string   `json:"oidcMetadataUrl,omitempty"`
	ClientID                 string   `json:"clientId,omitempty"`
	ClientSecret             string   `json:"clientSecret,omitempty"`
	// Social configuration
	HideOnLoginPage          bool     `json:"hideOnLoginPage,omitempty"`
	// Mappers (stored as JSON)
	From                    string   `json:"from,omitempty"`
	// Timestamps
	CreatedAt string `json:"createdAt,omitempty"`
	UpdatedAt string `json:"updatedAt,omitempty"`
}

// CreateIdentityProviderRequest represents the request body for creating an identity provider
type CreateIdentityProviderRequest struct {
	Alias                    string   `json:"alias"`
	DisplayName              string   `json:"displayName,omitempty"`
	Enabled                  *bool    `json:"enabled,omitempty"`
	ProviderID               string   `json:"providerId"`
	FirstBrokerLoginFlowAlias string  `json:"firstBrokerLoginFlowAlias,omitempty"`
	PostBrokerLoginFlowAlias string   `json:"postBrokerLoginFlowAlias,omitempty"`
	TrustEmail               *bool    `json:"trustEmail,omitempty"`
	StoreToken              *bool    `json:"storeToken,omitempty"`
	AddReadTokenRoleOnCreate *bool   `json:"addReadTokenRoleOnCreate,omitempty"`
	SyncMode                 string   `json:"syncMode,omitempty"`
	Discoverable             *bool    `json:"discoverable,omitempty"`
	// SAML specific
	SamlMetadataURL          string   `json:"samlMetadataUrl,omitempty"`
	SamlMetadata             string   `json:"samlMetadata,omitempty"`
	WantAssertionsSigned     *bool    `json:"wantAssertionsSigned,omitempty"`
	// OIDC specific
	OidcMetadataURL          string   `json:"oidcMetadataUrl,omitempty"`
	ClientID                 string   `json:"clientId,omitempty"`
	ClientSecret             string   `json:"clientSecret,omitempty"`
	// Social configuration
	HideOnLoginPage          *bool    `json:"hideOnLoginPage,omitempty"`
}

// UpdateIdentityProviderRequest represents the request body for updating an identity provider
type UpdateIdentityProviderRequest struct {
	DisplayName              string   `json:"displayName,omitempty"`
	Enabled                  *bool    `json:"enabled,omitempty"`
	FirstBrokerLoginFlowAlias string  `json:"firstBrokerLoginFlowAlias,omitempty"`
	PostBrokerLoginFlowAlias string   `json:"postBrokerLoginFlowAlias,omitempty"`
	TrustEmail               *bool    `json:"trustEmail,omitempty"`
	StoreToken              *bool    `json:"storeToken,omitempty"`
	AddReadTokenRoleOnCreate *bool   `json:"addReadTokenRoleOnCreate,omitempty"`
	SyncMode                 string   `json:"syncMode,omitempty"`
	Discoverable             *bool    `json:"discoverable,omitempty"`
	// SAML specific
	SamlMetadataURL          string   `json:"samlMetadataUrl,omitempty"`
	SamlMetadata             string   `json:"samlMetadata,omitempty"`
	WantAssertionsSigned     *bool    `json:"wantAssertionsSigned,omitempty"`
	// OIDC specific
	OidcMetadataURL          string   `json:"oidcMetadataUrl,omitempty"`
	ClientID                 string   `json:"clientId,omitempty"`
	ClientSecret             string   `json:"clientSecret,omitempty"`
	// Social configuration
	HideOnLoginPage          *bool    `json:"hideOnLoginPage,omitempty"`
}

// IdentityProviderMapper represents a mapper for identity provider attributes
type IdentityProviderMapper struct {
	ID                string   `json:"id"`
	Name              string   `json:"name"`
	IdentityProviderAlias string `json:"identityProviderAlias"`
	IdentityProviderMapperType string `json:"identityProviderMapperType"`
	Config            map[string]string `json:"config,omitempty"`
}

// CreateIdentityProviderMapperRequest represents the request body for creating a mapper
type CreateIdentityProviderMapperRequest struct {
	Name                      string            `json:"name"`
	IdentityProviderAlias     string            `json:"identityProviderAlias"`
	IdentityProviderMapperType string           `json:"identityProviderMapperType"`
	Config                    map[string]string `json:"config,omitempty"`
}

// IdentityProvidersClient provides methods for interacting with AuthMe identity providers API
type IdentityProvidersClient struct {
	httpClient *HTTPClient
}

// NewIdentityProvidersClient creates a new IdentityProvidersClient
func NewIdentityProvidersClient(httpClient *HTTPClient) *IdentityProvidersClient {
	return &IdentityProvidersClient{
		httpClient: httpClient,
	}
}

// CreateIdentityProvider creates a new identity provider
func (c *IdentityProvidersClient) CreateIdentityProvider(ctx context.Context, realmName string, req CreateIdentityProviderRequest) (*IdentityProvider, error) {
	var idp IdentityProvider
	path := fmt.Sprintf("/admin/realms/%s/identity-provider/instances", realmName)
	err := c.httpClient.PostJSON(ctx, path, req, nil, &idp)
	if err != nil {
		return nil, fmt.Errorf("failed to create identity provider: %w", err)
	}
	return &idp, nil
}

// ListIdentityProviders returns all identity providers in a realm
func (c *IdentityProvidersClient) ListIdentityProviders(ctx context.Context, realmName string) ([]IdentityProvider, error) {
	var idps []IdentityProvider
	path := fmt.Sprintf("/admin/realms/%s/identity-provider/instances", realmName)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &idps)
	if err != nil {
		return nil, fmt.Errorf("failed to list identity providers: %w", err)
	}
	return idps, nil
}

// GetIdentityProvider returns an identity provider by alias
func (c *IdentityProvidersClient) GetIdentityProvider(ctx context.Context, realmName, alias string) (*IdentityProvider, error) {
	var idp IdentityProvider
	path := fmt.Sprintf("/admin/realms/%s/identity-provider/instances/%s", realmName, alias)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &idp)
	if err != nil {
		return nil, fmt.Errorf("failed to get identity provider %s: %w", alias, err)
	}
	return &idp, nil
}

// UpdateIdentityProvider updates an identity provider
func (c *IdentityProvidersClient) UpdateIdentityProvider(ctx context.Context, realmName, alias string, req UpdateIdentityProviderRequest) (*IdentityProvider, error) {
	var idp IdentityProvider
	path := fmt.Sprintf("/admin/realms/%s/identity-provider/instances/%s", realmName, alias)
	err := c.httpClient.PutJSON(ctx, path, req, &idp)
	if err != nil {
		return nil, fmt.Errorf("failed to update identity provider %s: %w", alias, err)
	}
	return &idp, nil
}

// DeleteIdentityProvider deletes an identity provider
func (c *IdentityProvidersClient) DeleteIdentityProvider(ctx context.Context, realmName, alias string) error {
	path := fmt.Sprintf("/admin/realms/%s/identity-provider/instances/%s", realmName, alias)
	_, err := c.httpClient.Delete(ctx, path, nil)
	if err != nil {
		return fmt.Errorf("failed to delete identity provider %s: %w", alias, err)
	}
	return nil
}

// ImportIdentityProvider imports an identity provider from URL
func (c *IdentityProvidersClient) ImportIdentityProvider(ctx context.Context, realmName, alias string, req CreateIdentityProviderRequest) (*IdentityProvider, error) {
	var idp IdentityProvider
	path := fmt.Sprintf("/admin/realms/%s/identity-provider/instances/%s/import", realmName, alias)
	err := c.httpClient.PostJSON(ctx, path, req, nil, &idp)
	if err != nil {
		return nil, fmt.Errorf("failed to import identity provider %s: %w", alias, err)
	}
	return &idp, nil
}

// ─── Identity Provider Mappers ─────────────────────────────────

// CreateMapper creates a new identity provider mapper
func (c *IdentityProvidersClient) CreateMapper(ctx context.Context, realmName, alias string, req CreateIdentityProviderMapperRequest) (*IdentityProviderMapper, error) {
	var mapper IdentityProviderMapper
	path := fmt.Sprintf("/admin/realms/%s/identity-provider/instances/%s/mappers", realmName, alias)
	err := c.httpClient.PostJSON(ctx, path, req, nil, &mapper)
	if err != nil {
		return nil, fmt.Errorf("failed to create identity provider mapper: %w", err)
	}
	return &mapper, nil
}

// ListMappers returns all mappers for an identity provider
func (c *IdentityProvidersClient) ListMappers(ctx context.Context, realmName, alias string) ([]IdentityProviderMapper, error) {
	var mappers []IdentityProviderMapper
	path := fmt.Sprintf("/admin/realms/%s/identity-provider/instances/%s/mappers", realmName, alias)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &mappers)
	if err != nil {
		return nil, fmt.Errorf("failed to list identity provider mappers: %w", err)
	}
	return mappers, nil
}

// GetMapper returns a mapper by ID
func (c *IdentityProvidersClient) GetMapper(ctx context.Context, realmName, alias, mapperID string) (*IdentityProviderMapper, error) {
	var mapper IdentityProviderMapper
	path := fmt.Sprintf("/admin/realms/%s/identity-provider/instances/%s/mappers/%s", realmName, alias, mapperID)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &mapper)
	if err != nil {
		return nil, fmt.Errorf("failed to get identity provider mapper %s: %w", mapperID, err)
	}
	return &mapper, nil
}

// UpdateMapper updates an identity provider mapper
func (c *IdentityProvidersClient) UpdateMapper(ctx context.Context, realmName, alias, mapperID string, req CreateIdentityProviderMapperRequest) (*IdentityProviderMapper, error) {
	var mapper IdentityProviderMapper
	path := fmt.Sprintf("/admin/realms/%s/identity-provider/instances/%s/mappers/%s", realmName, alias, mapperID)
	err := c.httpClient.PutJSON(ctx, path, req, &mapper)
	if err != nil {
		return nil, fmt.Errorf("failed to update identity provider mapper %s: %w", mapperID, err)
	}
	return &mapper, nil
}

// DeleteMapper deletes an identity provider mapper
func (c *IdentityProvidersClient) DeleteMapper(ctx context.Context, realmName, alias, mapperID string) error {
	path := fmt.Sprintf("/admin/realms/%s/identity-provider/instances/%s/mappers/%s", realmName, alias, mapperID)
	_, err := c.httpClient.Delete(ctx, path, nil)
	if err != nil {
		return fmt.Errorf("failed to delete identity provider mapper %s: %w", mapperID, err)
	}
	return nil
}