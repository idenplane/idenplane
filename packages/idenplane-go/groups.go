package idenplane

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

// CreateGroupRequest is the payload for creating a realm group via the admin API.
//
// Path is accepted by the backend's CreateGroupDto but, as of the current
// server implementation, is not persisted (the Prisma Group model has no
// path column) and will not be echoed back on the resulting Group. It is
// included here to match the request shape the API currently accepts.
type CreateGroupRequest struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	ParentID    string `json:"parentId,omitempty"`
	Path        string `json:"path,omitempty"`
}

// UpdateGroupRequest is the payload for partial group updates. All fields
// are optional. See the Path caveat on CreateGroupRequest.
type UpdateGroupRequest struct {
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
	ParentID    *string `json:"parentId,omitempty"`
	Path        *string `json:"path,omitempty"`
}

// Group is the wire representation of a realm group from the admin API.
// CreatedAt and UpdatedAt are ISO 8601 strings; Prisma serializes DateTime
// columns to ISO strings rather than Unix-epoch integers.
//
// ParentID is empty for top-level groups and set to the parent group's ID
// for nested groups.
//
// Path is always empty in practice: the backend accepts it on create/update
// requests but never stores or returns it (no path column on the Group
// model). It is kept on this struct for forward compatibility in case the
// server starts returning it.
type Group struct {
	ID          string `json:"id"`
	RealmID     string `json:"realmId"`
	Name        string `json:"name"`
	Description string `json:"description"`
	ParentID    string `json:"parentId,omitempty"`
	Path        string `json:"path,omitempty"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

// GroupService exposes admin operations on the realm's groups endpoint.
// Groups are addressed by ID and support nesting via ParentID.
type GroupService struct {
	client *Client
}

func (gs *GroupService) groupsURL() string {
	return fmt.Sprintf("%s/admin/realms/%s/groups", strings.TrimSuffix(gs.client.config.ServerURL, "/"), gs.client.config.Realm)
}

func (gs *GroupService) groupURL(id string) string {
	return gs.groupsURL() + "/" + url.PathEscape(id)
}

// Create creates a realm group and returns the resulting record.
func (gs *GroupService) Create(ctx context.Context, req CreateGroupRequest) (*Group, error) {
	if req.Name == "" {
		return nil, ErrInvalidConfig("Name is required")
	}
	resp, err := gs.client.doRequest(ctx, http.MethodPost, gs.groupsURL(), req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, ErrServerError(fmt.Sprintf("create group: status %d", resp.StatusCode))
	}

	var group Group
	if err := json.NewDecoder(resp.Body).Decode(&group); err != nil {
		return nil, ErrServerError("invalid group payload: " + err.Error())
	}
	return &group, nil
}

// Get fetches a single realm group by ID.
func (gs *GroupService) Get(ctx context.Context, id string) (*Group, error) {
	resp, err := gs.client.doRequest(ctx, http.MethodGet, gs.groupURL(id), nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, ErrGroupNotFound(id)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, ErrServerError(fmt.Sprintf("get group: status %d", resp.StatusCode))
	}

	var group Group
	if err := json.NewDecoder(resp.Body).Decode(&group); err != nil {
		return nil, ErrServerError("invalid group payload: " + err.Error())
	}
	return &group, nil
}

// List returns all realm groups.
func (gs *GroupService) List(ctx context.Context) ([]*Group, error) {
	resp, err := gs.client.doRequest(ctx, http.MethodGet, gs.groupsURL(), nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, ErrServerError(fmt.Sprintf("list groups: status %d", resp.StatusCode))
	}

	var groups []*Group
	if err := json.NewDecoder(resp.Body).Decode(&groups); err != nil {
		return nil, ErrServerError("invalid list payload: " + err.Error())
	}
	return groups, nil
}

// Update applies a partial update to the group with the given ID and
// returns the updated record.
func (gs *GroupService) Update(ctx context.Context, id string, req UpdateGroupRequest) (*Group, error) {
	resp, err := gs.client.doRequest(ctx, http.MethodPut, gs.groupURL(id), req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, ErrGroupNotFound(id)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, ErrServerError(fmt.Sprintf("update group: status %d", resp.StatusCode))
	}

	var group Group
	if err := json.NewDecoder(resp.Body).Decode(&group); err != nil {
		return nil, ErrServerError("invalid group payload: " + err.Error())
	}
	return &group, nil
}

// Delete removes the group with the given ID.
func (gs *GroupService) Delete(ctx context.Context, id string) error {
	resp, err := gs.client.doRequest(ctx, http.MethodDelete, gs.groupURL(id), nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return ErrGroupNotFound(id)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ErrServerError(fmt.Sprintf("delete group: status %d", resp.StatusCode))
	}
	return nil
}
