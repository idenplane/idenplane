package idenplane

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

// CreateRoleRequest is the payload for creating a realm role via the admin API.
type CreateRoleRequest struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

// UpdateRoleRequest is the payload for partial role updates. All fields are optional.
type UpdateRoleRequest struct {
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
}

// Role is the wire representation of a realm role from the admin API.
// CreatedAt and UpdatedAt are ISO 8601 strings; Prisma serializes DateTime
// columns to ISO strings rather than Unix-epoch integers.
//
// ClientID is only populated for client roles. The admin API's list/get
// endpoints used by this SDK only address realm roles, so it is typically
// empty, but the field is kept on the read model in case the server ever
// returns a client role through the same shape.
type Role struct {
	ID          string `json:"id"`
	RealmID     string `json:"realmId"`
	ClientID    string `json:"clientId,omitempty"`
	Name        string `json:"name"`
	Description string `json:"description"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

// RoleService exposes admin operations on the realm's roles endpoint. Unlike
// users and groups, roles are addressed by name rather than by ID.
type RoleService struct {
	client *Client
}

func (rs *RoleService) rolesURL() string {
	return fmt.Sprintf("%s/admin/realms/%s/roles", strings.TrimSuffix(rs.client.config.ServerURL, "/"), rs.client.config.Realm)
}

func (rs *RoleService) roleURL(name string) string {
	return rs.rolesURL() + "/" + url.PathEscape(name)
}

// Create creates a realm role and returns the resulting record.
func (rs *RoleService) Create(ctx context.Context, req CreateRoleRequest) (*Role, error) {
	if req.Name == "" {
		return nil, ErrInvalidConfig("Name is required")
	}
	resp, err := rs.client.doRequest(ctx, http.MethodPost, rs.rolesURL(), req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, ErrServerError(fmt.Sprintf("create role: status %d", resp.StatusCode))
	}

	var role Role
	if err := json.NewDecoder(resp.Body).Decode(&role); err != nil {
		return nil, ErrServerError("invalid role payload: " + err.Error())
	}
	return &role, nil
}

// Get fetches a single realm role by name.
func (rs *RoleService) Get(ctx context.Context, name string) (*Role, error) {
	resp, err := rs.client.doRequest(ctx, http.MethodGet, rs.roleURL(name), nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, ErrRoleNotFound(name)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, ErrServerError(fmt.Sprintf("get role: status %d", resp.StatusCode))
	}

	var role Role
	if err := json.NewDecoder(resp.Body).Decode(&role); err != nil {
		return nil, ErrServerError("invalid role payload: " + err.Error())
	}
	return &role, nil
}

// List returns all realm roles. Client roles are excluded by the backend.
func (rs *RoleService) List(ctx context.Context) ([]*Role, error) {
	resp, err := rs.client.doRequest(ctx, http.MethodGet, rs.rolesURL(), nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, ErrServerError(fmt.Sprintf("list roles: status %d", resp.StatusCode))
	}

	var roles []*Role
	if err := json.NewDecoder(resp.Body).Decode(&roles); err != nil {
		return nil, ErrServerError("invalid list payload: " + err.Error())
	}
	return roles, nil
}

// Update applies a partial update to the role with the given name and
// returns the updated record.
func (rs *RoleService) Update(ctx context.Context, name string, req UpdateRoleRequest) (*Role, error) {
	resp, err := rs.client.doRequest(ctx, http.MethodPut, rs.roleURL(name), req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, ErrRoleNotFound(name)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, ErrServerError(fmt.Sprintf("update role: status %d", resp.StatusCode))
	}

	var role Role
	if err := json.NewDecoder(resp.Body).Decode(&role); err != nil {
		return nil, ErrServerError("invalid role payload: " + err.Error())
	}
	return &role, nil
}

// Delete removes the role with the given name.
func (rs *RoleService) Delete(ctx context.Context, name string) error {
	resp, err := rs.client.doRequest(ctx, http.MethodDelete, rs.roleURL(name), nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return ErrRoleNotFound(name)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ErrServerError(fmt.Sprintf("delete role: status %d", resp.StatusCode))
	}
	return nil
}
