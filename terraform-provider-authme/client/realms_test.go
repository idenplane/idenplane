// Package client provides HTTP client functionality for AuthMe API communication
package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRealmsClient_CreateRealm(t *testing.T) {
	expectedRealm := Realm{
		ID:          "realm-123",
		Name:        "test-realm",
		DisplayName: "Test Realm",
		Enabled:     true,
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify request method and path
		if r.Method != http.MethodPost {
			t.Errorf("expected POST method, got %s", r.Method)
		}
		if r.URL.Path != "/admin/realms" {
			t.Errorf("expected path /admin/realms, got %s", r.URL.Path)
		}

		// Verify authentication header
		if r.Header.Get("x-admin-api-key") != "test-api-key" {
			t.Errorf("expected x-admin-api-key header, got %s", r.Header.Get("x-admin-api-key"))
		}

		// Return response
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedRealm)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	realmsClient := NewRealmsClient(client)
	req := CreateRealmRequest{
		Name:        "test-realm",
		DisplayName: "Test Realm",
	}

	realm, err := realmsClient.CreateRealm(context.Background(), req)
	if err != nil {
		t.Fatalf("failed to create realm: %v", err)
	}

	if realm.ID != expectedRealm.ID {
		t.Errorf("expected realm ID %s, got %s", expectedRealm.ID, realm.ID)
	}
	if realm.Name != expectedRealm.Name {
		t.Errorf("expected realm name %s, got %s", expectedRealm.Name, realm.Name)
	}
}

func TestRealmsClient_ListRealms(t *testing.T) {
	expectedRealms := []Realm{
		{ID: "realm-1", Name: "realm-one"},
		{ID: "realm-2", Name: "realm-two"},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET method, got %s", r.Method)
		}
		if r.URL.Path != "/admin/realms" {
			t.Errorf("expected path /admin/realms, got %s", r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedRealms)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	realmsClient := NewRealmsClient(client)
	realms, err := realmsClient.ListRealms(context.Background())
	if err != nil {
		t.Fatalf("failed to list realms: %v", err)
	}

	if len(realms) != len(expectedRealms) {
		t.Errorf("expected %d realms, got %d", len(expectedRealms), len(realms))
	}
}

func TestRealmsClient_GetRealm(t *testing.T) {
	realmName := "test-realm"
	expectedRealm := Realm{
		ID:   "realm-123",
		Name: realmName,
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/" + realmName
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedRealm)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	realmsClient := NewRealmsClient(client)
	realm, err := realmsClient.GetRealm(context.Background(), realmName)
	if err != nil {
		t.Fatalf("failed to get realm: %v", err)
	}

	if realm.ID != expectedRealm.ID {
		t.Errorf("expected realm ID %s, got %s", expectedRealm.ID, realm.ID)
	}
}

func TestRealmsClient_UpdateRealm(t *testing.T) {
	realmName := "test-realm"
	expectedRealm := Realm{
		ID:          "realm-123",
		Name:        realmName,
		DisplayName: "Updated Realm",
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			t.Errorf("expected PUT method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/" + realmName
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedRealm)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	realmsClient := NewRealmsClient(client)
	req := UpdateRealmRequest{
		DisplayName: "Updated Realm",
	}

	realm, err := realmsClient.UpdateRealm(context.Background(), realmName, req)
	if err != nil {
		t.Fatalf("failed to update realm: %v", err)
	}

	if realm.DisplayName != expectedRealm.DisplayName {
		t.Errorf("expected display name %s, got %s", expectedRealm.DisplayName, realm.DisplayName)
	}
}

func TestRealmsClient_DeleteRealm(t *testing.T) {
	realmName := "test-realm"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			t.Errorf("expected DELETE method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/" + realmName
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

	realmsClient := NewRealmsClient(client)
	err = realmsClient.DeleteRealm(context.Background(), realmName)
	if err != nil {
		t.Fatalf("failed to delete realm: %v", err)
	}
}

func TestRealmsClient_GetThemes(t *testing.T) {
	expectedThemes := []Theme{
		{Name: "authme", DisplayName: "AuthMe Theme"},
		{Name: "dark", DisplayName: "Dark Theme"},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET method, got %s", r.Method)
		}
		if r.URL.Path != "/admin/realms/themes" {
			t.Errorf("expected path /admin/realms/themes, got %s", r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedThemes)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	realmsClient := NewRealmsClient(client)
	themes, err := realmsClient.GetThemes(context.Background())
	if err != nil {
		t.Fatalf("failed to get themes: %v", err)
	}

	if len(themes) != len(expectedThemes) {
		t.Errorf("expected %d themes, got %d", len(expectedThemes), len(themes))
	}
}

func TestRealmsClient_ExportRealm(t *testing.T) {
	realmName := "test-realm"
	expectedData := map[string]interface{}{
		"name":    realmName,
		"version": "1.0",
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/" + realmName + "/export"
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		// Verify query parameters
		includeUsers := r.URL.Query().Get("includeUsers")
		if includeUsers != "true" {
			t.Errorf("expected includeUsers=true, got %s", includeUsers)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedData)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	realmsClient := NewRealmsClient(client)
	data, err := realmsClient.ExportRealm(context.Background(), realmName, ExportRealmOptions{IncludeUsers: true})
	if err != nil {
		t.Fatalf("failed to export realm: %v", err)
	}

	if data["name"] != realmName {
		t.Errorf("expected realm name %s, got %v", realmName, data["name"])
	}
}

func TestRealmsClient_ImportRealm(t *testing.T) {
	expectedRealm := Realm{
		ID:   "realm-imported",
		Name: "imported-realm",
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST method, got %s", r.Method)
		}
		if r.URL.Path != "/admin/realms/import" {
			t.Errorf("expected path /admin/realms/import, got %s", r.URL.Path)
		}

		// Verify query parameters
		overwrite := r.URL.Query().Get("overwrite")
		if overwrite != "true" {
			t.Errorf("expected overwrite=true, got %s", overwrite)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedRealm)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	realmsClient := NewRealmsClient(client)
	data := map[string]interface{}{
		"name": "imported-realm",
	}

	realm, err := realmsClient.ImportRealm(context.Background(), data, ImportRealmOptions{Overwrite: true})
	if err != nil {
		t.Fatalf("failed to import realm: %v", err)
	}

	if realm.ID != expectedRealm.ID {
		t.Errorf("expected realm ID %s, got %s", expectedRealm.ID, realm.ID)
	}
}

func TestRealmsClient_SendTestEmail(t *testing.T) {
	realmName := "test-realm"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/" + realmName + "/email/test"
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	realmsClient := NewRealmsClient(client)
	err = realmsClient.SendTestEmail(context.Background(), realmName, SendTestEmailRequest{To: "test@example.com"})
	if err != nil {
		t.Fatalf("failed to send test email: %v", err)
	}
}
