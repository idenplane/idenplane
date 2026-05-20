// Package client provides HTTP client functionality for AuthMe API communication
package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestUserFederationsClient_CreateUserFederation(t *testing.T) {
	expectedFed := UserFederation{
		ID:           "fed-123",
		Name:         "test-ldap",
		ProviderType:  "ldap",
		Enabled:      true,
		Priority:     0,
		ConnectionURL: "ldap://localhost:389",
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST method, got %s", r.Method)
		}
		if r.URL.Path != "/admin/realms/test-realm/user-federations" {
			t.Errorf("expected path /admin/realms/test-realm/user-federations, got %s", r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedFed)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	fedsClient := NewUserFederationsClient(client)
	req := CreateUserFederationRequest{
		Name:          "test-ldap",
		ProviderType:  "ldap",
		ConnectionURL: "ldap://localhost:389",
	}

	fed, err := fedsClient.CreateUserFederation(context.Background(), "test-realm", req)
	if err != nil {
		t.Fatalf("failed to create user federation: %v", err)
	}

	if fed.ID != expectedFed.ID {
		t.Errorf("expected federation ID %s, got %s", expectedFed.ID, fed.ID)
	}
	if fed.Name != expectedFed.Name {
		t.Errorf("expected federation name %s, got %s", expectedFed.Name, fed.Name)
	}
}

func TestUserFederationsClient_ListUserFederations(t *testing.T) {
	expectedFeds := []UserFederation{
		{ID: "fed-1", Name: "ldap-1"},
		{ID: "fed-2", Name: "ldap-2"},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET method, got %s", r.Method)
		}
		if r.URL.Path != "/admin/realms/test-realm/user-federations" {
			t.Errorf("expected path /admin/realms/test-realm/user-federations, got %s", r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedFeds)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	fedsClient := NewUserFederationsClient(client)
	feds, err := fedsClient.ListUserFederations(context.Background(), "test-realm")
	if err != nil {
		t.Fatalf("failed to list user federations: %v", err)
	}

	if len(feds) != len(expectedFeds) {
		t.Errorf("expected %d federations, got %d", len(expectedFeds), len(feds))
	}
}

func TestUserFederationsClient_GetUserFederation(t *testing.T) {
	federationID := "fed-123"
	expectedFed := UserFederation{
		ID:   federationID,
		Name: "test-ldap",
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/user-federations/" + federationID
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedFed)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	fedsClient := NewUserFederationsClient(client)
	fed, err := fedsClient.GetUserFederation(context.Background(), "test-realm", federationID)
	if err != nil {
		t.Fatalf("failed to get user federation: %v", err)
	}

	if fed.ID != expectedFed.ID {
		t.Errorf("expected federation ID %s, got %s", expectedFed.ID, fed.ID)
	}
}

func TestUserFederationsClient_UpdateUserFederation(t *testing.T) {
	federationID := "fed-123"
	expectedFed := UserFederation{
		ID:   federationID,
		Name: "Updated LDAP",
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			t.Errorf("expected PUT method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/user-federations/" + federationID
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedFed)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	fedsClient := NewUserFederationsClient(client)
	req := UpdateUserFederationRequest{
		Name: "Updated LDAP",
	}

	fed, err := fedsClient.UpdateUserFederation(context.Background(), "test-realm", federationID, req)
	if err != nil {
		t.Fatalf("failed to update user federation: %v", err)
	}

	if fed.Name != expectedFed.Name {
		t.Errorf("expected name %s, got %s", expectedFed.Name, fed.Name)
	}
}

func TestUserFederationsClient_DeleteUserFederation(t *testing.T) {
	federationID := "fed-123"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			t.Errorf("expected DELETE method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/user-federations/" + federationID
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

	fedsClient := NewUserFederationsClient(client)
	err = fedsClient.DeleteUserFederation(context.Background(), "test-realm", federationID)
	if err != nil {
		t.Fatalf("failed to delete user federation: %v", err)
	}
}

func TestUserFederationsClient_TestConnection(t *testing.T) {
	federationID := "fed-123"
	expectedResult := TestConnectionResponse{
		Success: true,
		Message: "Connection successful",
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/user-federations/" + federationID + "/test"
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedResult)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	fedsClient := NewUserFederationsClient(client)
	result, err := fedsClient.TestConnection(context.Background(), "test-realm", federationID)
	if err != nil {
		t.Fatalf("failed to test connection: %v", err)
	}

	if !result.Success {
		t.Errorf("expected success to be true")
	}
}

func TestUserFederationsClient_SyncUsers(t *testing.T) {
	federationID := "fed-123"
	expectedResult := SyncUsersResponse{
		Synced:  10,
		Total:   100,
		Message: "Sync complete",
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/user-federations/" + federationID + "/sync"
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedResult)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	fedsClient := NewUserFederationsClient(client)
	result, err := fedsClient.SyncUsers(context.Background(), "test-realm", federationID)
	if err != nil {
		t.Fatalf("failed to sync users: %v", err)
	}

	if result.Synced != expectedResult.Synced {
		t.Errorf("expected synced %d, got %d", expectedResult.Synced, result.Synced)
	}
}

func TestUserFederationsClient_CreateMapper(t *testing.T) {
	federationID := "fed-123"
	expectedMapper := UserFederationMapper{
		ID:                 "mapper-123",
		FederationID:       federationID,
		Name:               "email-mapping",
		MapperType:         "email-attribute-mapping",
		LdapProperty:       "mail",
		UserModelAttribute: "email",
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/user-federations/" + federationID + "/mappers"
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedMapper)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	fedsClient := NewUserFederationsClient(client)
	req := map[string]interface{}{
		"name":               "email-mapping",
		"mapperType":         "email-attribute-mapping",
		"ldapProperty":        "mail",
		"userModelAttribute":  "email",
	}

	mapper, err := fedsClient.CreateMapper(context.Background(), "test-realm", federationID, req)
	if err != nil {
		t.Fatalf("failed to create mapper: %v", err)
	}

	if mapper.ID != expectedMapper.ID {
		t.Errorf("expected mapper ID %s, got %s", expectedMapper.ID, mapper.ID)
	}
}

func TestUserFederationsClient_ListMappers(t *testing.T) {
	federationID := "fed-123"
	expectedMappers := []UserFederationMapper{
		{ID: "mapper-1", Name: "email-mapping"},
		{ID: "mapper-2", Name: "username-mapping"},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/user-federations/" + federationID + "/mappers"
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedMappers)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	fedsClient := NewUserFederationsClient(client)
	mappers, err := fedsClient.ListMappers(context.Background(), "test-realm", federationID)
	if err != nil {
		t.Fatalf("failed to list mappers: %v", err)
	}

	if len(mappers) != len(expectedMappers) {
		t.Errorf("expected %d mappers, got %d", len(expectedMappers), len(mappers))
	}
}

func TestUserFederationsClient_DeleteMapper(t *testing.T) {
	federationID := "fed-123"
	mapperID := "mapper-123"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			t.Errorf("expected DELETE method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/user-federations/" + federationID + "/mappers/" + mapperID
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

	fedsClient := NewUserFederationsClient(client)
	err = fedsClient.DeleteMapper(context.Background(), "test-realm", federationID, mapperID)
	if err != nil {
		t.Fatalf("failed to delete mapper: %v", err)
	}
}