// Package client provides HTTP client functionality for AuthMe API communication
package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRolesClient_CreateRealmRole(t *testing.T) {
	expectedRole := Role{
		ID:          "role-123",
		Name:        "test-role",
		Description: "Test Role",
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST method, got %s", r.Method)
		}
		if r.URL.Path != "/admin/realms/test-realm/roles" {
			t.Errorf("expected path /admin/realms/test-realm/roles, got %s", r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedRole)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	rolesClient := NewRolesClient(client)
	req := CreateRoleRequest{
		Name:        "test-role",
		Description: "Test Role",
	}

	role, err := rolesClient.CreateRealmRole(context.Background(), "test-realm", req)
	if err != nil {
		t.Fatalf("failed to create realm role: %v", err)
	}

	if role.ID != expectedRole.ID {
		t.Errorf("expected role ID %s, got %s", expectedRole.ID, role.ID)
	}
	if role.Name != expectedRole.Name {
		t.Errorf("expected role name %s, got %s", expectedRole.Name, role.Name)
	}
}

func TestRolesClient_ListRealmRoles(t *testing.T) {
	expectedRoles := []Role{
		{ID: "role-1", Name: "admin"},
		{ID: "role-2", Name: "user"},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET method, got %s", r.Method)
		}
		if r.URL.Path != "/admin/realms/test-realm/roles" {
			t.Errorf("expected path /admin/realms/test-realm/roles, got %s", r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedRoles)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	rolesClient := NewRolesClient(client)
	roles, err := rolesClient.ListRealmRoles(context.Background(), "test-realm")
	if err != nil {
		t.Fatalf("failed to list realm roles: %v", err)
	}

	if len(roles) != len(expectedRoles) {
		t.Errorf("expected %d roles, got %d", len(expectedRoles), len(roles))
	}
}

func TestRolesClient_GetRealmRole(t *testing.T) {
	roleName := "test-role"
	expectedRole := Role{
		ID:   "role-123",
		Name: roleName,
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/roles/" + roleName
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedRole)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	rolesClient := NewRolesClient(client)
	role, err := rolesClient.GetRealmRole(context.Background(), "test-realm", roleName)
	if err != nil {
		t.Fatalf("failed to get realm role: %v", err)
	}

	if role.ID != expectedRole.ID {
		t.Errorf("expected role ID %s, got %s", expectedRole.ID, role.ID)
	}
}

func TestRolesClient_UpdateRealmRole(t *testing.T) {
	roleName := "test-role"
	expectedRole := Role{
		ID:          "role-123",
		Name:        roleName,
		Description: "Updated Description",
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			t.Errorf("expected PUT method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/roles/" + roleName
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedRole)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	rolesClient := NewRolesClient(client)
	req := UpdateRoleRequest{
		Description: "Updated Description",
	}

	role, err := rolesClient.UpdateRealmRole(context.Background(), "test-realm", roleName, req)
	if err != nil {
		t.Fatalf("failed to update realm role: %v", err)
	}

	if role.Description != expectedRole.Description {
		t.Errorf("expected description %s, got %s", expectedRole.Description, role.Description)
	}
}

func TestRolesClient_DeleteRealmRole(t *testing.T) {
	roleName := "test-role"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			t.Errorf("expected DELETE method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/roles/" + roleName
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

	rolesClient := NewRolesClient(client)
	err = rolesClient.DeleteRealmRole(context.Background(), "test-realm", roleName)
	if err != nil {
		t.Fatalf("failed to delete realm role: %v", err)
	}
}

func TestRolesClient_CreateClientRole(t *testing.T) {
	clientID := "test-client"
	expectedRole := Role{
		ID:          "role-123",
		Name:        "client-role",
		Description: "Client Role",
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/clients/" + clientID + "/roles"
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedRole)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	rolesClient := NewRolesClient(client)
	req := CreateRoleRequest{
		Name:        "client-role",
		Description: "Client Role",
	}

	role, err := rolesClient.CreateClientRole(context.Background(), "test-realm", clientID, req)
	if err != nil {
		t.Fatalf("failed to create client role: %v", err)
	}

	if role.ID != expectedRole.ID {
		t.Errorf("expected role ID %s, got %s", expectedRole.ID, role.ID)
	}
}

func TestRolesClient_ListClientRoles(t *testing.T) {
	clientID := "test-client"
	expectedRoles := []Role{
		{ID: "role-1", Name: "read"},
		{ID: "role-2", Name: "write"},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/clients/" + clientID + "/roles"
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

	rolesClient := NewRolesClient(client)
	roles, err := rolesClient.ListClientRoles(context.Background(), "test-realm", clientID)
	if err != nil {
		t.Fatalf("failed to list client roles: %v", err)
	}

	if len(roles) != len(expectedRoles) {
		t.Errorf("expected %d roles, got %d", len(expectedRoles), len(roles))
	}
}

func TestRolesClient_GetUserRealmRoles(t *testing.T) {
	userID := "user-123"
	expectedRoles := []Role{
		{ID: "role-1", Name: "admin"},
		{ID: "role-2", Name: "user"},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/users/" + userID + "/role-mappings/realm"
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

	rolesClient := NewRolesClient(client)
	roles, err := rolesClient.GetUserRealmRoles(context.Background(), "test-realm", userID)
	if err != nil {
		t.Fatalf("failed to get user realm roles: %v", err)
	}

	if len(roles) != len(expectedRoles) {
		t.Errorf("expected %d roles, got %d", len(expectedRoles), len(roles))
	}
}

func TestRolesClient_AssignRealmRoles(t *testing.T) {
	userID := "user-123"
	expectedResp := AssignRolesResponse{
		Assigned: []string{"admin", "user"},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/users/" + userID + "/role-mappings/realm"
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

	rolesClient := NewRolesClient(client)
	roles := []Role{
		{Name: "admin"},
		{Name: "user"},
	}

	resp, err := rolesClient.AssignRealmRoles(context.Background(), "test-realm", userID, roles)
	if err != nil {
		t.Fatalf("failed to assign realm roles: %v", err)
	}

	if len(resp.Assigned) != len(expectedResp.Assigned) {
		t.Errorf("expected %d assigned roles, got %d", len(expectedResp.Assigned), len(resp.Assigned))
	}
}

func TestRolesClient_RemoveUserRealmRoles(t *testing.T) {
	userID := "user-123"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			t.Errorf("expected DELETE method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/users/" + userID + "/role-mappings/realm"
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

	rolesClient := NewRolesClient(client)
	roles := []Role{
		{Name: "admin"},
	}

	err = rolesClient.RemoveUserRealmRoles(context.Background(), "test-realm", userID, roles)
	if err != nil {
		t.Fatalf("failed to remove realm roles: %v", err)
	}
}

func TestRolesClient_GetUserClientRoles(t *testing.T) {
	userID := "user-123"
	clientID := "test-client"
	expectedRoles := []Role{
		{ID: "role-1", Name: "read"},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/users/" + userID + "/role-mappings/clients/" + clientID
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

	rolesClient := NewRolesClient(client)
	roles, err := rolesClient.GetUserClientRoles(context.Background(), "test-realm", userID, clientID)
	if err != nil {
		t.Fatalf("failed to get user client roles: %v", err)
	}

	if len(roles) != len(expectedRoles) {
		t.Errorf("expected %d roles, got %d", len(expectedRoles), len(roles))
	}
}

func TestRolesClient_AssignClientRoles(t *testing.T) {
	userID := "user-123"
	clientID := "test-client"
	expectedResp := AssignRolesResponse{
		Assigned: []string{"read"},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/users/" + userID + "/role-mappings/clients/" + clientID
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

	rolesClient := NewRolesClient(client)
	roles := []Role{
		{Name: "read"},
	}

	resp, err := rolesClient.AssignClientRoles(context.Background(), "test-realm", userID, clientID, roles)
	if err != nil {
		t.Fatalf("failed to assign client roles: %v", err)
	}

	if len(resp.Assigned) != len(expectedResp.Assigned) {
		t.Errorf("expected %d assigned roles, got %d", len(expectedResp.Assigned), len(resp.Assigned))
	}
}

func TestRolesClient_RemoveUserClientRoles(t *testing.T) {
	userID := "user-123"
	clientID := "test-client"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			t.Errorf("expected DELETE method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/users/" + userID + "/role-mappings/clients/" + clientID
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

	rolesClient := NewRolesClient(client)
	roles := []Role{
		{Name: "read"},
	}

	err = rolesClient.RemoveUserClientRoles(context.Background(), "test-realm", userID, clientID, roles)
	if err != nil {
		t.Fatalf("failed to remove client roles: %v", err)
	}
}