// Package client provides HTTP client functionality for AuthMe API communication
package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestIdentityProvidersClient_CreateIdentityProvider(t *testing.T) {
	enabled := true
	expectedIDP := IdentityProvider{
		ID:          "idp-123",
		RealmID:     "realm-123",
		Alias:       "google",
		DisplayName: "Google",
		ProviderID:  "google",
		Enabled:     true,
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST method, got %s", r.Method)
		}
		if r.URL.Path != "/admin/realms/test-realm/identity-provider/instances" {
			t.Errorf("expected path /admin/realms/test-realm/identity-provider/instances, got %s", r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedIDP)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	idpClient := NewIdentityProvidersClient(client)
	req := CreateIdentityProviderRequest{
		Alias:    "google",
		ProviderID: "google",
		Enabled:  &enabled,
	}

	idp, err := idpClient.CreateIdentityProvider(context.Background(), "test-realm", req)
	if err != nil {
		t.Fatalf("failed to create identity provider: %v", err)
	}

	if idp.ID != expectedIDP.ID {
		t.Errorf("expected IDP ID %s, got %s", expectedIDP.ID, idp.ID)
	}
	if idp.Alias != expectedIDP.Alias {
		t.Errorf("expected alias %s, got %s", expectedIDP.Alias, idp.Alias)
	}
}

func TestIdentityProvidersClient_ListIdentityProviders(t *testing.T) {
	expectedIDPs := []IdentityProvider{
		{ID: "idp-1", Alias: "google"},
		{ID: "idp-2", Alias: "github"},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET method, got %s", r.Method)
		}
		if r.URL.Path != "/admin/realms/test-realm/identity-provider/instances" {
			t.Errorf("expected path /admin/realms/test-realm/identity-provider/instances, got %s", r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedIDPs)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	idpClient := NewIdentityProvidersClient(client)
	idps, err := idpClient.ListIdentityProviders(context.Background(), "test-realm")
	if err != nil {
		t.Fatalf("failed to list identity providers: %v", err)
	}

	if len(idps) != len(expectedIDPs) {
		t.Errorf("expected %d identity providers, got %d", len(expectedIDPs), len(idps))
	}
}

func TestIdentityProvidersClient_GetIdentityProvider(t *testing.T) {
	alias := "google"
	expectedIDP := IdentityProvider{
		ID:       "idp-123",
		Alias:    alias,
		ProviderID: "google",
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/identity-provider/instances/" + alias
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedIDP)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	idpClient := NewIdentityProvidersClient(client)
	idp, err := idpClient.GetIdentityProvider(context.Background(), "test-realm", alias)
	if err != nil {
		t.Fatalf("failed to get identity provider: %v", err)
	}

	if idp.ID != expectedIDP.ID {
		t.Errorf("expected IDP ID %s, got %s", expectedIDP.ID, idp.ID)
	}
}

func TestIdentityProvidersClient_UpdateIdentityProvider(t *testing.T) {
	alias := "google"
	expectedIDP := IdentityProvider{
		ID:          "idp-123",
		Alias:       alias,
		DisplayName: "Google OAuth",
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			t.Errorf("expected PUT method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/identity-provider/instances/" + alias
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedIDP)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	idpClient := NewIdentityProvidersClient(client)
	req := UpdateIdentityProviderRequest{
		DisplayName: "Google OAuth",
	}

	idp, err := idpClient.UpdateIdentityProvider(context.Background(), "test-realm", alias, req)
	if err != nil {
		t.Fatalf("failed to update identity provider: %v", err)
	}

	if idp.DisplayName != expectedIDP.DisplayName {
		t.Errorf("expected display name %s, got %s", expectedIDP.DisplayName, idp.DisplayName)
	}
}

func TestIdentityProvidersClient_DeleteIdentityProvider(t *testing.T) {
	alias := "google"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			t.Errorf("expected DELETE method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/identity-provider/instances/" + alias
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

	idpClient := NewIdentityProvidersClient(client)
	err = idpClient.DeleteIdentityProvider(context.Background(), "test-realm", alias)
	if err != nil {
		t.Fatalf("failed to delete identity provider: %v", err)
	}
}

func TestIdentityProvidersClient_CreateMapper(t *testing.T) {
	alias := "google"
	expectedMapper := IdentityProviderMapper{
		ID:                "mapper-123",
		Name:              "email-mapper",
		IdentityProviderAlias: alias,
		IdentityProviderMapperType: "oidc-hardcoded-claim-mapper",
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/identity-provider/instances/" + alias + "/mappers"
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

	idpClient := NewIdentityProvidersClient(client)
	req := CreateIdentityProviderMapperRequest{
		Name:                      "email-mapper",
		IdentityProviderAlias:     alias,
		IdentityProviderMapperType: "oidc-hardcoded-claim-mapper",
	}

	mapper, err := idpClient.CreateMapper(context.Background(), "test-realm", alias, req)
	if err != nil {
		t.Fatalf("failed to create mapper: %v", err)
	}

	if mapper.ID != expectedMapper.ID {
		t.Errorf("expected mapper ID %s, got %s", expectedMapper.ID, mapper.ID)
	}
}

func TestIdentityProvidersClient_ListMappers(t *testing.T) {
	alias := "google"
	expectedMappers := []IdentityProviderMapper{
		{ID: "mapper-1", Name: "email-mapper"},
		{ID: "mapper-2", Name: "name-mapper"},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/identity-provider/instances/" + alias + "/mappers"
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

	idpClient := NewIdentityProvidersClient(client)
	mappers, err := idpClient.ListMappers(context.Background(), "test-realm", alias)
	if err != nil {
		t.Fatalf("failed to list mappers: %v", err)
	}

	if len(mappers) != len(expectedMappers) {
		t.Errorf("expected %d mappers, got %d", len(expectedMappers), len(mappers))
	}
}

func TestIdentityProvidersClient_DeleteMapper(t *testing.T) {
	alias := "google"
	mapperID := "mapper-123"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			t.Errorf("expected DELETE method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/identity-provider/instances/" + alias + "/mappers/" + mapperID
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

	idpClient := NewIdentityProvidersClient(client)
	err = idpClient.DeleteMapper(context.Background(), "test-realm", alias, mapperID)
	if err != nil {
		t.Fatalf("failed to delete mapper: %v", err)
	}
}