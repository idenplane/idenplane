// Package client provides HTTP client functionality for Idenplane API communication
package client

import (
	"context"
	"fmt"
)

// User represents a user in the Idenplane API
type User struct {
	ID            string   `json:"id"`
	RealmID       string   `json:"realmId,omitempty"`
	Username      string   `json:"username"`
	Email         string   `json:"email,omitempty"`
	EmailVerified bool     `json:"emailVerified,omitempty"`
	FirstName     string   `json:"firstName,omitempty"`
	LastName      string   `json:"lastName,omitempty"`
	Enabled       bool     `json:"enabled,omitempty"`
	CreatedAt     string   `json:"createdAt,omitempty"`
	UpdatedAt     string   `json:"updatedAt,omitempty"`
	Attributes    map[string][]string `json:"attributes,omitempty"`
	// Groups and roles (populated based on query)
	Groups []Group `json:"groups,omitempty"`
	Roles  []Role  `json:"roles,omitempty"`
}

// CreateUserRequest represents the request body for creating a user
type CreateUserRequest struct {
	Username      string   `json:"username"`
	Email         string   `json:"email,omitempty"`
	FirstName     string   `json:"firstName,omitempty"`
	LastName      string   `json:"lastName,omitempty"`
	Enabled       *bool    `json:"enabled,omitempty"`
	EmailVerified *bool    `json:"emailVerified,omitempty"`
	Attributes    map[string][]string `json:"attributes,omitempty"`
}

// UpdateUserRequest represents the request body for updating a user
type UpdateUserRequest struct {
	Email         *string  `json:"email,omitempty"`
	FirstName     *string  `json:"firstName,omitempty"`
	LastName      *string  `json:"lastName,omitempty"`
	Enabled       *bool    `json:"enabled,omitempty"`
	EmailVerified *bool    `json:"emailVerified,omitempty"`
	Attributes    map[string][]string `json:"attributes,omitempty"`
}

// ResetPasswordRequest represents the request body for resetting a user's password
type ResetPasswordRequest struct {
	Type      string `json:"type"`
	Temporary *bool  `json:"temporary,omitempty"`
	Value     string `json:"value"`
}

// UsersClient provides methods for interacting with Idenplane users API
type UsersClient struct {
	httpClient *HTTPClient
}

// NewUsersClient creates a new UsersClient
func NewUsersClient(httpClient *HTTPClient) *UsersClient {
	return &UsersClient{
		httpClient: httpClient,
	}
}

// ─── User CRUD ─────────────────────────────────────────

// CreateUser creates a new user in a realm
func (c *UsersClient) CreateUser(ctx context.Context, realmName string, req CreateUserRequest) (*User, error) {
	var user User
	path := fmt.Sprintf("/admin/realms/%s/users", realmName)
	err := c.httpClient.PostJSON(ctx, path, req, nil, &user)
	if err != nil {
		return nil, fmt.Errorf("failed to create user: %w", err)
	}
	return &user, nil
}

// ListUsers returns all users in a realm
func (c *UsersClient) ListUsers(ctx context.Context, realmName string) ([]User, error) {
	var users []User
	path := fmt.Sprintf("/admin/realms/%s/users", realmName)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &users)
	if err != nil {
		return nil, fmt.Errorf("failed to list users: %w", err)
	}
	return users, nil
}

// GetUser returns a user by ID
func (c *UsersClient) GetUser(ctx context.Context, realmName, userID string) (*User, error) {
	var user User
	path := fmt.Sprintf("/admin/realms/%s/users/%s", realmName, userID)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &user)
	if err != nil {
		return nil, fmt.Errorf("failed to get user %s: %w", userID, err)
	}
	return &user, nil
}

// UpdateUser updates a user
func (c *UsersClient) UpdateUser(ctx context.Context, realmName, userID string, req UpdateUserRequest) (*User, error) {
	var user User
	path := fmt.Sprintf("/admin/realms/%s/users/%s", realmName, userID)
	err := c.httpClient.PutJSON(ctx, path, req, &user)
	if err != nil {
		return nil, fmt.Errorf("failed to update user %s: %w", userID, err)
	}
	return &user, nil
}

// DeleteUser deletes a user
func (c *UsersClient) DeleteUser(ctx context.Context, realmName, userID string) error {
	path := fmt.Sprintf("/admin/realms/%s/users/%s", realmName, userID)
	_, err := c.httpClient.Delete(ctx, path, nil)
	if err != nil {
		return fmt.Errorf("failed to delete user %s: %w", userID, err)
	}
	return nil
}

// ─── User Password Management ─────────────────────────────────

// ResetUserPassword resets a user's password
func (c *UsersClient) ResetUserPassword(ctx context.Context, realmName, userID string, req ResetPasswordRequest) error {
	path := fmt.Sprintf("/admin/realms/%s/users/%s/reset-password", realmName, userID)
	_, err := c.httpClient.Put(ctx, path, req)
	if err != nil {
		return fmt.Errorf("failed to reset password for user %s: %w", userID, err)
	}
	return nil
}