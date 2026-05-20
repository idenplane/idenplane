// Package client provides HTTP client functionality for AuthMe API communication
package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGroupsClient_CreateGroup(t *testing.T) {
	expectedGroup := Group{
		ID:          "group-123",
		RealmID:     "realm-123",
		Name:        "test-group",
		Description: "Test Group",
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST method, got %s", r.Method)
		}
		if r.URL.Path != "/admin/realms/test-realm/groups" {
			t.Errorf("expected path /admin/realms/test-realm/groups, got %s", r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedGroup)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	groupsClient := NewGroupsClient(client)
	req := CreateGroupRequest{
		Name:        "test-group",
		Description: "Test Group",
	}

	group, err := groupsClient.CreateGroup(context.Background(), "test-realm", req)
	if err != nil {
		t.Fatalf("failed to create group: %v", err)
	}

	if group.ID != expectedGroup.ID {
		t.Errorf("expected group ID %s, got %s", expectedGroup.ID, group.ID)
	}
	if group.Name != expectedGroup.Name {
		t.Errorf("expected group name %s, got %s", expectedGroup.Name, group.Name)
	}
}

func TestGroupsClient_ListGroups(t *testing.T) {
	expectedGroups := []Group{
		{ID: "group-1", Name: "admins"},
		{ID: "group-2", Name: "users"},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET method, got %s", r.Method)
		}
		if r.URL.Path != "/admin/realms/test-realm/groups" {
			t.Errorf("expected path /admin/realms/test-realm/groups, got %s", r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedGroups)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	groupsClient := NewGroupsClient(client)
	groups, err := groupsClient.ListGroups(context.Background(), "test-realm")
	if err != nil {
		t.Fatalf("failed to list groups: %v", err)
	}

	if len(groups) != len(expectedGroups) {
		t.Errorf("expected %d groups, got %d", len(expectedGroups), len(groups))
	}
}

func TestGroupsClient_GetGroup(t *testing.T) {
	groupID := "group-123"
	expectedGroup := Group{
		ID:   groupID,
		Name: "test-group",
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/groups/" + groupID
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedGroup)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	groupsClient := NewGroupsClient(client)
	group, err := groupsClient.GetGroup(context.Background(), "test-realm", groupID)
	if err != nil {
		t.Fatalf("failed to get group: %v", err)
	}

	if group.ID != expectedGroup.ID {
		t.Errorf("expected group ID %s, got %s", expectedGroup.ID, group.ID)
	}
}

func TestGroupsClient_UpdateGroup(t *testing.T) {
	groupID := "group-123"
	expectedGroup := Group{
		ID:   groupID,
		Name: "Updated Group",
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			t.Errorf("expected PUT method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/groups/" + groupID
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedGroup)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	groupsClient := NewGroupsClient(client)
	req := UpdateGroupRequest{
		Name: "Updated Group",
	}

	group, err := groupsClient.UpdateGroup(context.Background(), "test-realm", groupID, req)
	if err != nil {
		t.Fatalf("failed to update group: %v", err)
	}

	if group.Name != expectedGroup.Name {
		t.Errorf("expected name %s, got %s", expectedGroup.Name, group.Name)
	}
}

func TestGroupsClient_DeleteGroup(t *testing.T) {
	groupID := "group-123"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			t.Errorf("expected DELETE method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/groups/" + groupID
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	groupsClient := NewGroupsClient(client)
	err = groupsClient.DeleteGroup(context.Background(), "test-realm", groupID)
	if err != nil {
		t.Fatalf("failed to delete group: %v", err)
	}
}

func TestGroupsClient_GetGroupMembers(t *testing.T) {
	groupID := "group-123"
	expectedMembers := []User{
		{ID: "user-1", Username: "user1"},
		{ID: "user-2", Username: "user2"},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/groups/" + groupID + "/members"
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedMembers)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	groupsClient := NewGroupsClient(client)
	members, err := groupsClient.GetGroupMembers(context.Background(), "test-realm", groupID)
	if err != nil {
		t.Fatalf("failed to get group members: %v", err)
	}

	if len(members) != len(expectedMembers) {
		t.Errorf("expected %d members, got %d", len(expectedMembers), len(members))
	}
}

func TestGroupsClient_AddUserToGroup(t *testing.T) {
	userID := "user-123"
	groupID := "group-123"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			t.Errorf("expected PUT method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/groups/" + groupID + "/members/" + userID
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	groupsClient := NewGroupsClient(client)
	err = groupsClient.AddUserToGroup(context.Background(), "test-realm", userID, groupID)
	if err != nil {
		t.Fatalf("failed to add user to group: %v", err)
	}
}

func TestGroupsClient_RemoveUserFromGroup(t *testing.T) {
	userID := "user-123"
	groupID := "group-123"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			t.Errorf("expected DELETE method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/groups/" + groupID + "/members/" + userID
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	groupsClient := NewGroupsClient(client)
	err = groupsClient.RemoveUserFromGroup(context.Background(), "test-realm", userID, groupID)
	if err != nil {
		t.Fatalf("failed to remove user from group: %v", err)
	}
}

func TestGroupsClient_GetUserGroups(t *testing.T) {
	userID := "user-123"
	expectedGroups := []Group{
		{ID: "group-1", Name: "admins"},
		{ID: "group-2", Name: "users"},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/users/" + userID + "/groups"
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedGroups)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	groupsClient := NewGroupsClient(client)
	groups, err := groupsClient.GetUserGroups(context.Background(), "test-realm", userID)
	if err != nil {
		t.Fatalf("failed to get user groups: %v", err)
	}

	if len(groups) != len(expectedGroups) {
		t.Errorf("expected %d groups, got %d", len(expectedGroups), len(groups))
	}
}

func TestGroupsClient_GetGroupRoles(t *testing.T) {
	groupID := "group-123"
	expectedRoles := []Role{
		{ID: "role-1", Name: "admin"},
		{ID: "role-2", Name: "user"},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/groups/" + groupID + "/role-mappings"
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedRoles)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	groupsClient := NewGroupsClient(client)
	roles, err := groupsClient.GetGroupRoles(context.Background(), "test-realm", groupID)
	if err != nil {
		t.Fatalf("failed to get group roles: %v", err)
	}

	if len(roles) != len(expectedRoles) {
		t.Errorf("expected %d roles, got %d", len(expectedRoles), len(roles))
	}
}

func TestGroupsClient_AssignRolesToGroup(t *testing.T) {
	groupID := "group-123"
	expectedResp := AssignGroupRolesResponse{
		Assigned: []string{"admin", "user"},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/groups/" + groupID + "/role-mappings/realm"
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedResp)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	groupsClient := NewGroupsClient(client)
	roles := []Role{
		{Name: "admin"},
		{Name: "user"},
	}

	resp, err := groupsClient.AssignRolesToGroup(context.Background(), "test-realm", groupID, roles)
	if err != nil {
		t.Fatalf("failed to assign roles to group: %v", err)
	}

	if len(resp.Assigned) != len(expectedResp.Assigned) {
		t.Errorf("expected %d assigned roles, got %d", len(expectedResp.Assigned), len(resp.Assigned))
	}
}

func TestGroupsClient_RemoveRolesFromGroup(t *testing.T) {
	groupID := "group-123"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			t.Errorf("expected DELETE method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/groups/" + groupID + "/role-mappings/realm"
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	groupsClient := NewGroupsClient(client)
	roles := []Role{
		{Name: "admin"},
	}

	err = groupsClient.RemoveRolesFromGroup(context.Background(), "test-realm", groupID, roles)
	if err != nil {
		t.Fatalf("failed to remove roles from group: %v", err)
	}
}

func TestGroupsClient_GetUserGroupRoles(t *testing.T) {
	userID := "user-123"
	expectedRoles := []Role{
		{ID: "role-1", Name: "admin"},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/users/" + userID + "/role-mappings/groups"
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedRoles)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	groupsClient := NewGroupsClient(client)
	roles, err := groupsClient.GetUserGroupRoles(context.Background(), "test-realm", userID)
	if err != nil {
		t.Fatalf("failed to get user group roles: %v", err)
	}

	if len(roles) != len(expectedRoles) {
		t.Errorf("expected %d roles, got %d", len(expectedRoles), len(roles))
	}
}