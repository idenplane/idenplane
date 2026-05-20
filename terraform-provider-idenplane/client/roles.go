// Package client provides HTTP client functionality for AuthMe API communication
package client

import (
	"context"
	"fmt"
)

// Role represents a role in the AuthMe API
type Role struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Description string  `json:"description,omitempty"`
	ClientID    *string `json:"clientId,omitempty"`
	// Timestamps
	CreatedAt string `json:"createdAt,omitempty"`
	UpdatedAt string `json:"updatedAt,omitempty"`
	// Composite role info
	Composite       bool     `json:"composite,omitempty"`
	ClientRole      bool     `json:"clientRole,omitempty"`
	ContainerID     string   `json:"containerId,omitempty"`
	Attributes      map[string][]string `json:"attributes,omitempty"`
}

// CreateRoleRequest represents the request body for creating a role
type CreateRoleRequest struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

// UpdateRoleRequest represents the request body for updating a role
type UpdateRoleRequest struct {
	Name        string `json:"name,omitempty"`
	Description string `json:"description,omitempty"`
}

// AssignRolesRequest represents the request body for assigning roles to a user or group
type AssignRolesRequest struct {
	Roles []Role `json:"roles"`
}

// AssignRolesResponse represents the response when assigning roles
type AssignRolesResponse struct {
	Assigned []string `json:"assigned"`
}

// RolesClient provides methods for interacting with AuthMe roles API
type RolesClient struct {
	httpClient *HTTPClient
}

// NewRolesClient creates a new RolesClient
func NewRolesClient(httpClient *HTTPClient) *RolesClient {
	return &RolesClient{
		httpClient: httpClient,
	}
}

// ─── Realm Roles ────────────────────────────────────────

// CreateRealmRole creates a new realm role
func (c *RolesClient) CreateRealmRole(ctx context.Context, realmName string, req CreateRoleRequest) (*Role, error) {
	var role Role
	path := fmt.Sprintf("/admin/realms/%s/roles", realmName)
	err := c.httpClient.PostJSON(ctx, path, req, nil, &role)
	if err != nil {
		return nil, fmt.Errorf("failed to create realm role: %w", err)
	}
	return &role, nil
}

// ListRealmRoles returns all realm roles
func (c *RolesClient) ListRealmRoles(ctx context.Context, realmName string) ([]Role, error) {
	var roles []Role
	path := fmt.Sprintf("/admin/realms/%s/roles", realmName)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &roles)
	if err != nil {
		return nil, fmt.Errorf("failed to list realm roles: %w", err)
	}
	return roles, nil
}

// GetRealmRole returns a realm role by name
func (c *RolesClient) GetRealmRole(ctx context.Context, realmName, roleName string) (*Role, error) {
	var role Role
	path := fmt.Sprintf("/admin/realms/%s/roles/%s", realmName, roleName)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &role)
	if err != nil {
		return nil, fmt.Errorf("failed to get realm role %s: %w", roleName, err)
	}
	return &role, nil
}

// UpdateRealmRole updates a realm role
func (c *RolesClient) UpdateRealmRole(ctx context.Context, realmName, roleName string, req UpdateRoleRequest) (*Role, error) {
	var role Role
	path := fmt.Sprintf("/admin/realms/%s/roles/%s", realmName, roleName)
	err := c.httpClient.PutJSON(ctx, path, req, &role)
	if err != nil {
		return nil, fmt.Errorf("failed to update realm role %s: %w", roleName, err)
	}
	return &role, nil
}

// DeleteRealmRole deletes a realm role
func (c *RolesClient) DeleteRealmRole(ctx context.Context, realmName, roleName string) error {
	path := fmt.Sprintf("/admin/realms/%s/roles/%s", realmName, roleName)
	_, err := c.httpClient.Delete(ctx, path, nil)
	if err != nil {
		return fmt.Errorf("failed to delete realm role %s: %w", roleName, err)
	}
	return nil
}

// ─── Client Roles ──────────────────────────────────────

// CreateClientRole creates a new client role
func (c *RolesClient) CreateClientRole(ctx context.Context, realmName, clientID string, req CreateRoleRequest) (*Role, error) {
	var role Role
	path := fmt.Sprintf("/admin/realms/%s/clients/%s/roles", realmName, clientID)
	err := c.httpClient.PostJSON(ctx, path, req, nil, &role)
	if err != nil {
		return nil, fmt.Errorf("failed to create client role: %w", err)
	}
	return &role, nil
}

// ListClientRoles returns all client roles
func (c *RolesClient) ListClientRoles(ctx context.Context, realmName, clientID string) ([]Role, error) {
	var roles []Role
	path := fmt.Sprintf("/admin/realms/%s/clients/%s/roles", realmName, clientID)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &roles)
	if err != nil {
		return nil, fmt.Errorf("failed to list client roles: %w", err)
	}
	return roles, nil
}

// GetClientRole returns a client role by name
func (c *RolesClient) GetClientRole(ctx context.Context, realmName, clientID, roleName string) (*Role, error) {
	var role Role
	path := fmt.Sprintf("/admin/realms/%s/clients/%s/roles/%s", realmName, clientID, roleName)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &role)
	if err != nil {
		return nil, fmt.Errorf("failed to get client role %s: %w", roleName, err)
	}
	return &role, nil
}

// UpdateClientRole updates a client role
func (c *RolesClient) UpdateClientRole(ctx context.Context, realmName, clientID, roleName string, req UpdateRoleRequest) (*Role, error) {
	var role Role
	path := fmt.Sprintf("/admin/realms/%s/clients/%s/roles/%s", realmName, clientID, roleName)
	err := c.httpClient.PutJSON(ctx, path, req, &role)
	if err != nil {
		return nil, fmt.Errorf("failed to update client role %s: %w", roleName, err)
	}
	return &role, nil
}

// DeleteClientRole deletes a client role
func (c *RolesClient) DeleteClientRole(ctx context.Context, realmName, clientID, roleName string) error {
	path := fmt.Sprintf("/admin/realms/%s/clients/%s/roles/%s", realmName, clientID, roleName)
	_, err := c.httpClient.Delete(ctx, path, nil)
	if err != nil {
		return fmt.Errorf("failed to delete client role %s: %w", roleName, err)
	}
	return nil
}

// ─── User Role Assignment ───────────────────────────────────

// GetUserRealmRoles returns all realm roles assigned to a user
func (c *RolesClient) GetUserRealmRoles(ctx context.Context, realmName, userID string) ([]Role, error) {
	var roles []Role
	path := fmt.Sprintf("/admin/realms/%s/users/%s/role-mappings/realm", realmName, userID)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &roles)
	if err != nil {
		return nil, fmt.Errorf("failed to get user realm roles: %w", err)
	}
	return roles, nil
}

// AssignRealmRoles assigns realm roles to a user
func (c *RolesClient) AssignRealmRoles(ctx context.Context, realmName, userID string, roles []Role) (*AssignRolesResponse, error) {
	var resp AssignRolesResponse
	path := fmt.Sprintf("/admin/realms/%s/users/%s/role-mappings/realm", realmName, userID)
	req := AssignRolesRequest{Roles: roles}
	err := c.httpClient.PostJSON(ctx, path, req, nil, &resp)
	if err != nil {
		return nil, fmt.Errorf("failed to assign realm roles to user: %w", err)
	}
	return &resp, nil
}

// RemoveUserRealmRoles removes realm roles from a user
func (c *RolesClient) RemoveUserRealmRoles(ctx context.Context, realmName, userID string, roles []Role) error {
	path := fmt.Sprintf("/admin/realms/%s/users/%s/role-mappings/realm", realmName, userID)
	req := AssignRolesRequest{Roles: roles}
	_, err := c.httpClient.Delete(ctx, path, req)
	if err != nil {
		return fmt.Errorf("failed to remove realm roles from user: %w", err)
	}
	return nil
}

// GetUserClientRoles returns all client roles assigned to a user for a specific client
func (c *RolesClient) GetUserClientRoles(ctx context.Context, realmName, userID, clientID string) ([]Role, error) {
	var roles []Role
	path := fmt.Sprintf("/admin/realms/%s/users/%s/role-mappings/clients/%s", realmName, userID, clientID)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &roles)
	if err != nil {
		return nil, fmt.Errorf("failed to get user client roles: %w", err)
	}
	return roles, nil
}

// AssignClientRoles assigns client roles to a user
func (c *RolesClient) AssignClientRoles(ctx context.Context, realmName, userID, clientID string, roles []Role) (*AssignRolesResponse, error) {
	var resp AssignRolesResponse
	path := fmt.Sprintf("/admin/realms/%s/users/%s/role-mappings/clients/%s", realmName, userID, clientID)
	req := AssignRolesRequest{Roles: roles}
	err := c.httpClient.PostJSON(ctx, path, req, nil, &resp)
	if err != nil {
		return nil, fmt.Errorf("failed to assign client roles to user: %w", err)
	}
	return &resp, nil
}

// RemoveUserClientRoles removes client roles from a user
func (c *RolesClient) RemoveUserClientRoles(ctx context.Context, realmName, userID, clientID string, roles []Role) error {
	path := fmt.Sprintf("/admin/realms/%s/users/%s/role-mappings/clients/%s", realmName, userID, clientID)
	req := AssignRolesRequest{Roles: roles}
	_, err := c.httpClient.Delete(ctx, path, req)
	if err != nil {
		return fmt.Errorf("failed to remove client roles from user: %w", err)
	}
	return nil
}