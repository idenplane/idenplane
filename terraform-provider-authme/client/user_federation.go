// Package client provides HTTP client functionality for AuthMe API communication
package client

import (
	"context"
	"fmt"
)

// UserFederation represents a user federation configuration in the AuthMe API
type UserFederation struct {
	ID               string `json:"id"`
	RealmID          string `json:"realmId,omitempty"`
	Name             string `json:"name"`
	ProviderType     string `json:"providerType,omitempty"`
	Enabled          bool   `json:"enabled,omitempty"`
	Priority         int    `json:"priority,omitempty"`
	// LDAP connection settings
	ConnectionURL    string `json:"connectionUrl,omitempty"`
	BindDn           string `json:"bindDn,omitempty"`
	BindCredential   string `json:"bindCredential,omitempty"`
	StartTLS         bool   `json:"startTls,omitempty"`
	ConnectionTimeout int   `json:"connectionTimeout,omitempty"`
	// LDAP user search settings
	UsersDn          string `json:"usersDn,omitempty"`
	UserObjectClass  string `json:"userObjectClass,omitempty"`
	UsernameLdapAttr string `json:"usernameLdapAttr,omitempty"`
	RdnLdapAttr      string `json:"rdnLdapAttr,omitempty"`
	UuidLdapAttr     string `json:"uuidLdapAttr,omitempty"`
	SearchFilter     string `json:"searchFilter,omitempty"`
	// LDAP sync settings
	SyncMode         string `json:"syncMode,omitempty"`
	SyncPeriod       int    `json:"syncPeriod,omitempty"`
	ImportEnabled    bool   `json:"importEnabled,omitempty"`
	EditMode         string `json:"editMode,omitempty"`
	// Sync status
	LastSyncAt       string `json:"lastSyncAt,omitempty"`
	LastSyncStatus   string `json:"lastSyncStatus,omitempty"`
	// Timestamps
	CreatedAt        string `json:"createdAt,omitempty"`
	UpdatedAt        string `json:"updatedAt,omitempty"`
}

// UserFederationMapper represents an attribute mapper for user federation
type UserFederationMapper struct {
	ID                 string `json:"id"`
	FederationID       string `json:"federationId,omitempty"`
	Name               string `json:"name"`
	MapperType         string `json:"mapperType,omitempty"`
	LdapProperty       string `json:"ldapProperty,omitempty"`
	UserModelAttribute string `json:"userModelAttribute,omitempty"`
}

// CreateUserFederationRequest represents the request body for creating a user federation
type CreateUserFederationRequest struct {
	Name             string  `json:"name"`
	ProviderType     string  `json:"providerType,omitempty"`
	Enabled          *bool   `json:"enabled,omitempty"`
	Priority         int     `json:"priority,omitempty"`
	// LDAP connection settings
	ConnectionURL     string `json:"connectionUrl,omitempty"`
	BindDn            string `json:"bindDn,omitempty"`
	BindCredential    string `json:"bindCredential,omitempty"`
	StartTLS          *bool  `json:"startTls,omitempty"`
	ConnectionTimeout int    `json:"connectionTimeout,omitempty"`
	// LDAP user search settings
	UsersDn           string `json:"usersDn,omitempty"`
	UserObjectClass   string `json:"userObjectClass,omitempty"`
	UsernameLdapAttr  string `json:"usernameLdapAttr,omitempty"`
	RdnLdapAttr       string `json:"rdnLdapAttr,omitempty"`
	UuidLdapAttr      string `json:"uuidLdapAttr,omitempty"`
	SearchFilter      string `json:"searchFilter,omitempty"`
	// LDAP sync settings
	SyncMode          string `json:"syncMode,omitempty"`
	SyncPeriod        int    `json:"syncPeriod,omitempty"`
	ImportEnabled     *bool  `json:"importEnabled,omitempty"`
	EditMode          string `json:"editMode,omitempty"`
}

// UpdateUserFederationRequest represents the request body for updating a user federation
type UpdateUserFederationRequest struct {
	Name             string  `json:"name,omitempty"`
	ProviderType     string  `json:"providerType,omitempty"`
	Enabled          *bool   `json:"enabled,omitempty"`
	Priority         int     `json:"priority,omitempty"`
	// LDAP connection settings
	ConnectionURL     string `json:"connectionUrl,omitempty"`
	BindDn            string `json:"bindDn,omitempty"`
	BindCredential    string `json:"bindCredential,omitempty"`
	StartTLS          *bool  `json:"startTls,omitempty"`
	ConnectionTimeout int    `json:"connectionTimeout,omitempty"`
	// LDAP user search settings
	UsersDn           string `json:"usersDn,omitempty"`
	UserObjectClass   string `json:"userObjectClass,omitempty"`
	UsernameLdapAttr  string `json:"usernameLdapAttr,omitempty"`
	RdnLdapAttr       string `json:"rdnLdapAttr,omitempty"`
	UuidLdapAttr      string `json:"uuidLdapAttr,omitempty"`
	SearchFilter      string `json:"searchFilter,omitempty"`
	// LDAP sync settings
	SyncMode          string `json:"syncMode,omitempty"`
	SyncPeriod        int    `json:"syncPeriod,omitempty"`
	ImportEnabled     *bool  `json:"importEnabled,omitempty"`
	EditMode          string `json:"editMode,omitempty"`
}

// TestConnectionResponse represents the response for testing a federation connection
type TestConnectionResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message,omitempty"`
}

// SyncUsersResponse represents the response for a user sync operation
type SyncUsersResponse struct {
	Synced int    `json:"synced,omitempty"`
	Total  int    `json:"total,omitempty"`
	Message string `json:"message,omitempty"`
}

// UserFederationsClient provides methods for interacting with AuthMe user federations API
type UserFederationsClient struct {
	httpClient *HTTPClient
}

// NewUserFederationsClient creates a new UserFederationsClient
func NewUserFederationsClient(httpClient *HTTPClient) *UserFederationsClient {
	return &UserFederationsClient{
		httpClient: httpClient,
	}
}

// ─── User Federation CRUD ─────────────────────────────────

// CreateUserFederation creates a new user federation
func (c *UserFederationsClient) CreateUserFederation(ctx context.Context, realmName string, req CreateUserFederationRequest) (*UserFederation, error) {
	var federation UserFederation
	path := fmt.Sprintf("/admin/realms/%s/user-federations", realmName)
	err := c.httpClient.PostJSON(ctx, path, req, nil, &federation)
	if err != nil {
		return nil, fmt.Errorf("failed to create user federation: %w", err)
	}
	return &federation, nil
}

// ListUserFederations returns all user federations in a realm
func (c *UserFederationsClient) ListUserFederations(ctx context.Context, realmName string) ([]UserFederation, error) {
	var federations []UserFederation
	path := fmt.Sprintf("/admin/realms/%s/user-federations", realmName)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &federations)
	if err != nil {
		return nil, fmt.Errorf("failed to list user federations: %w", err)
	}
	return federations, nil
}

// GetUserFederation returns a user federation by ID
func (c *UserFederationsClient) GetUserFederation(ctx context.Context, realmName, federationID string) (*UserFederation, error) {
	var federation UserFederation
	path := fmt.Sprintf("/admin/realms/%s/user-federations/%s", realmName, federationID)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &federation)
	if err != nil {
		return nil, fmt.Errorf("failed to get user federation %s: %w", federationID, err)
	}
	return &federation, nil
}

// UpdateUserFederation updates a user federation
func (c *UserFederationsClient) UpdateUserFederation(ctx context.Context, realmName, federationID string, req UpdateUserFederationRequest) (*UserFederation, error) {
	var federation UserFederation
	path := fmt.Sprintf("/admin/realms/%s/user-federations/%s", realmName, federationID)
	err := c.httpClient.PutJSON(ctx, path, req, &federation)
	if err != nil {
		return nil, fmt.Errorf("failed to update user federation %s: %w", federationID, err)
	}
	return &federation, nil
}

// DeleteUserFederation deletes a user federation
func (c *UserFederationsClient) DeleteUserFederation(ctx context.Context, realmName, federationID string) error {
	path := fmt.Sprintf("/admin/realms/%s/user-federations/%s", realmName, federationID)
	_, err := c.httpClient.Delete(ctx, path, nil)
	if err != nil {
		return fmt.Errorf("failed to delete user federation %s: %w", federationID, err)
	}
	return nil
}

// ─── Connection Testing ─────────────────────────────────

// TestConnection tests the connection to a user federation
func (c *UserFederationsClient) TestConnection(ctx context.Context, realmName, federationID string) (*TestConnectionResponse, error) {
	var result TestConnectionResponse
	path := fmt.Sprintf("/admin/realms/%s/user-federations/%s/test", realmName, federationID)
	err := c.httpClient.PostJSON(ctx, path, nil, nil, &result)
	if err != nil {
		return nil, fmt.Errorf("failed to test connection for federation %s: %w", federationID, err)
	}
	return &result, nil
}

// ─── User Sync ─────────────────────────────────────────

// SyncUsers synchronizes users from a user federation
func (c *UserFederationsClient) SyncUsers(ctx context.Context, realmName, federationID string) (*SyncUsersResponse, error) {
	var result SyncUsersResponse
	path := fmt.Sprintf("/admin/realms/%s/user-federations/%s/sync", realmName, federationID)
	err := c.httpClient.PostJSON(ctx, path, nil, nil, &result)
	if err != nil {
		return nil, fmt.Errorf("failed to sync users for federation %s: %w", federationID, err)
	}
	return &result, nil
}

// ─── Attribute Mappers ─────────────────────────────────

// CreateMapper creates an attribute mapper for a user federation
func (c *UserFederationsClient) CreateMapper(ctx context.Context, realmName, federationID string, req map[string]interface{}) (*UserFederationMapper, error) {
	var mapper UserFederationMapper
	path := fmt.Sprintf("/admin/realms/%s/user-federations/%s/mappers", realmName, federationID)
	err := c.httpClient.PostJSON(ctx, path, req, nil, &mapper)
	if err != nil {
		return nil, fmt.Errorf("failed to create mapper: %w", err)
	}
	return &mapper, nil
}

// ListMappers returns all attribute mappers for a user federation
func (c *UserFederationsClient) ListMappers(ctx context.Context, realmName, federationID string) ([]UserFederationMapper, error) {
	var mappers []UserFederationMapper
	path := fmt.Sprintf("/admin/realms/%s/user-federations/%s/mappers", realmName, federationID)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &mappers)
	if err != nil {
		return nil, fmt.Errorf("failed to list mappers: %w", err)
	}
	return mappers, nil
}

// GetMapper returns an attribute mapper by ID
func (c *UserFederationsClient) GetMapper(ctx context.Context, realmName, federationID, mapperID string) (*UserFederationMapper, error) {
	var mapper UserFederationMapper
	path := fmt.Sprintf("/admin/realms/%s/user-federations/%s/mappers/%s", realmName, federationID, mapperID)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &mapper)
	if err != nil {
		return nil, fmt.Errorf("failed to get mapper %s: %w", mapperID, err)
	}
	return &mapper, nil
}

// UpdateMapper updates an attribute mapper
func (c *UserFederationsClient) UpdateMapper(ctx context.Context, realmName, federationID, mapperID string, req map[string]interface{}) (*UserFederationMapper, error) {
	var mapper UserFederationMapper
	path := fmt.Sprintf("/admin/realms/%s/user-federations/%s/mappers/%s", realmName, federationID, mapperID)
	err := c.httpClient.PutJSON(ctx, path, req, &mapper)
	if err != nil {
		return nil, fmt.Errorf("failed to update mapper %s: %w", mapperID, err)
	}
	return &mapper, nil
}

// DeleteMapper deletes an attribute mapper
func (c *UserFederationsClient) DeleteMapper(ctx context.Context, realmName, federationID, mapperID string) error {
	path := fmt.Sprintf("/admin/realms/%s/user-federations/%s/mappers/%s", realmName, federationID, mapperID)
	_, err := c.httpClient.Delete(ctx, path, nil)
	if err != nil {
		return fmt.Errorf("failed to delete mapper %s: %w", mapperID, err)
	}
	return nil
}