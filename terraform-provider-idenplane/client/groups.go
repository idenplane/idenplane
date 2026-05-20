// Package client provides HTTP client functionality for Idenplane API communication
package client

import (
	"context"
	"fmt"
)

// Group represents a group in the Idenplane API
type Group struct {
	ID          string  `json:"id"`
	RealmID     string  `json:"realmId"`
	Name        string  `json:"name"`
	Path        string  `json:"path,omitempty"`
	Description string  `json:"description,omitempty"`
	ParentID    *string `json:"parentId,omitempty"`
	// Sub-groups and counts (populated based on query)
	Children []Group `json:"children,omitempty"`
	Members  []User  `json:"members,omitempty"`
	// Count information
	MemberCount int `json:"memberCount,omitempty"`
	RoleCount   int `json:"roleCount,omitempty"`
	// Timestamps
	CreatedAt string `json:"createdAt,omitempty"`
	UpdatedAt string `json:"updatedAt,omitempty"`
}

// GroupMembersCount represents count information for a group
type GroupMembersCount struct {
	UserGroups int `json:"userGroups"`
	GroupRoles int `json:"groupRoles"`
}

// CreateGroupRequest represents the request body for creating a group
type CreateGroupRequest struct {
	Name        string  `json:"name"`
	Description string  `json:"description,omitempty"`
	ParentID    *string `json:"parentId,omitempty"`
}

// UpdateGroupRequest represents the request body for updating a group
type UpdateGroupRequest struct {
	Name        string  `json:"name,omitempty"`
	Description string  `json:"description,omitempty"`
	ParentID    *string `json:"parentId,omitempty"`
}

// AssignGroupRolesRequest represents the request body for assigning roles to a group
type AssignGroupRolesRequest struct {
	Roles []Role `json:"roles"`
}

// AssignGroupRolesResponse represents the response when assigning roles to a group
type AssignGroupRolesResponse struct {
	Assigned []string `json:"assigned"`
}

// GroupsClient provides methods for interacting with Idenplane groups API
type GroupsClient struct {
	httpClient *HTTPClient
}

// NewGroupsClient creates a new GroupsClient
func NewGroupsClient(httpClient *HTTPClient) *GroupsClient {
	return &GroupsClient{
		httpClient: httpClient,
	}
}

// CreateGroup creates a new group
func (c *GroupsClient) CreateGroup(ctx context.Context, realmName string, req CreateGroupRequest) (*Group, error) {
	var group Group
	path := fmt.Sprintf("/admin/realms/%s/groups", realmName)
	err := c.httpClient.PostJSON(ctx, path, req, nil, &group)
	if err != nil {
		return nil, fmt.Errorf("failed to create group: %w", err)
	}
	return &group, nil
}

// ListGroups returns all groups in a realm
func (c *GroupsClient) ListGroups(ctx context.Context, realmName string) ([]Group, error) {
	var groups []Group
	path := fmt.Sprintf("/admin/realms/%s/groups", realmName)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &groups)
	if err != nil {
		return nil, fmt.Errorf("failed to list groups: %w", err)
	}
	return groups, nil
}

// GetGroup returns a group by ID
func (c *GroupsClient) GetGroup(ctx context.Context, realmName, groupID string) (*Group, error) {
	var group Group
	path := fmt.Sprintf("/admin/realms/%s/groups/%s", realmName, groupID)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &group)
	if err != nil {
		return nil, fmt.Errorf("failed to get group %s: %w", groupID, err)
	}
	return &group, nil
}

// UpdateGroup updates a group
func (c *GroupsClient) UpdateGroup(ctx context.Context, realmName, groupID string, req UpdateGroupRequest) (*Group, error) {
	var group Group
	path := fmt.Sprintf("/admin/realms/%s/groups/%s", realmName, groupID)
	err := c.httpClient.PutJSON(ctx, path, req, &group)
	if err != nil {
		return nil, fmt.Errorf("failed to update group %s: %w", groupID, err)
	}
	return &group, nil
}

// DeleteGroup deletes a group
func (c *GroupsClient) DeleteGroup(ctx context.Context, realmName, groupID string) error {
	path := fmt.Sprintf("/admin/realms/%s/groups/%s", realmName, groupID)
	_, err := c.httpClient.Delete(ctx, path, nil)
	if err != nil {
		return fmt.Errorf("failed to delete group %s: %w", groupID, err)
	}
	return nil
}

// ─── Membership ──────────────────────────────────────

// GetGroupMembers returns all members of a group
func (c *GroupsClient) GetGroupMembers(ctx context.Context, realmName, groupID string) ([]User, error) {
	var users []User
	path := fmt.Sprintf("/admin/realms/%s/groups/%s/members", realmName, groupID)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &users)
	if err != nil {
		return nil, fmt.Errorf("failed to get group members: %w", err)
	}
	return users, nil
}

// AddUserToGroup adds a user to a group
func (c *GroupsClient) AddUserToGroup(ctx context.Context, realmName, userID, groupID string) error {
	path := fmt.Sprintf("/admin/realms/%s/groups/%s/members/%s", realmName, groupID, userID)
	_, err := c.httpClient.Put(ctx, path, nil)
	if err != nil {
		return fmt.Errorf("failed to add user to group: %w", err)
	}
	return nil
}

// RemoveUserFromGroup removes a user from a group
func (c *GroupsClient) RemoveUserFromGroup(ctx context.Context, realmName, userID, groupID string) error {
	path := fmt.Sprintf("/admin/realms/%s/groups/%s/members/%s", realmName, groupID, userID)
	_, err := c.httpClient.Delete(ctx, path, nil)
	if err != nil {
		return fmt.Errorf("failed to remove user from group: %w", err)
	}
	return nil
}

// GetUserGroups returns all groups a user belongs to
func (c *GroupsClient) GetUserGroups(ctx context.Context, realmName, userID string) ([]Group, error) {
	var groups []Group
	path := fmt.Sprintf("/admin/realms/%s/users/%s/groups", realmName, userID)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &groups)
	if err != nil {
		return nil, fmt.Errorf("failed to get user groups: %w", err)
	}
	return groups, nil
}

// ─── Group Role Mappings ─────────────────────────────────────

// GetGroupRoles returns all roles assigned to a group
func (c *GroupsClient) GetGroupRoles(ctx context.Context, realmName, groupID string) ([]Role, error) {
	var roles []Role
	path := fmt.Sprintf("/admin/realms/%s/groups/%s/role-mappings", realmName, groupID)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &roles)
	if err != nil {
		return nil, fmt.Errorf("failed to get group roles: %w", err)
	}
	return roles, nil
}

// AssignRolesToGroup assigns realm roles to a group
func (c *GroupsClient) AssignRolesToGroup(ctx context.Context, realmName, groupID string, roles []Role) (*AssignGroupRolesResponse, error) {
	var resp AssignGroupRolesResponse
	path := fmt.Sprintf("/admin/realms/%s/groups/%s/role-mappings/realm", realmName, groupID)
	req := AssignGroupRolesRequest{Roles: roles}
	err := c.httpClient.PostJSON(ctx, path, req, nil, &resp)
	if err != nil {
		return nil, fmt.Errorf("failed to assign roles to group: %w", err)
	}
	return &resp, nil
}

// RemoveRolesFromGroup removes realm roles from a group
func (c *GroupsClient) RemoveRolesFromGroup(ctx context.Context, realmName, groupID string, roles []Role) error {
	path := fmt.Sprintf("/admin/realms/%s/groups/%s/role-mappings/realm", realmName, groupID)
	req := AssignGroupRolesRequest{Roles: roles}
	_, err := c.httpClient.Delete(ctx, path, req)
	if err != nil {
		return fmt.Errorf("failed to remove roles from group: %w", err)
	}
	return nil
}

// GetUserGroupRoles returns all roles a user inherits through group membership
func (c *GroupsClient) GetUserGroupRoles(ctx context.Context, realmName, userID string) ([]Role, error) {
	var roles []Role
	path := fmt.Sprintf("/admin/realms/%s/users/%s/role-mappings/groups", realmName, userID)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &roles)
	if err != nil {
		return nil, fmt.Errorf("failed to get user group roles: %w", err)
	}
	return roles, nil
}