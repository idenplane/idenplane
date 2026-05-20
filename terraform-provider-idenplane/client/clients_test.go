// Package client provides HTTP client functionality for AuthMe API communication
package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientsClient_CreateClient(t *testing.T) {
	enabled := true
	expectedClient := Client{
		ID:        "client-123",
		RealmID:   "realm-123",
		ClientID:  "test-client",
		Name:      "Test Client",
		Enabled:   true,
		GrantTypes: []string{"authorization_code"},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST method, got %s", r.Method)
		}
		if r.URL.Path != "/admin/realms/test-realm/clients" {
			t.Errorf("expected path /admin/realms/test-realm/clients, got %s", r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedClient)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	clientsClient := NewClientsClient(client)
	req := CreateClientRequest{
		ClientID: "test-client",
		Name:     "Test Client",
		Enabled:  &enabled,
	}

	created, err := clientsClient.CreateClient(context.Background(), "test-realm", req)
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	if created.ID != expectedClient.ID {
		t.Errorf("expected client ID %s, got %s", expectedClient.ID, created.ID)
	}
	if created.ClientID != expectedClient.ClientID {
		t.Errorf("expected client ID %s, got %s", expectedClient.ClientID, created.ClientID)
	}
}

func TestClientsClient_ListClients(t *testing.T) {
	expectedClients := []Client{
		{ID: "client-1", ClientID: "client-one"},
		{ID: "client-2", ClientID: "client-two"},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET method, got %s", r.Method)
		}
		if r.URL.Path != "/admin/realms/test-realm/clients" {
			t.Errorf("expected path /admin/realms/test-realm/clients, got %s", r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedClients)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	clientsClient := NewClientsClient(client)
	clients, err := clientsClient.ListClients(context.Background(), "test-realm")
	if err != nil {
		t.Fatalf("failed to list clients: %v", err)
	}

	if len(clients) != len(expectedClients) {
		t.Errorf("expected %d clients, got %d", len(expectedClients), len(clients))
	}
}

func TestClientsClient_GetClient(t *testing.T) {
	clientID := "test-client"
	expectedClient := Client{
		ID:       "client-123",
		ClientID: clientID,
		Name:     "Test Client",
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/clients/" + clientID
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedClient)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	clientsClient := NewClientsClient(client)
	result, err := clientsClient.GetClient(context.Background(), "test-realm", clientID)
	if err != nil {
		t.Fatalf("failed to get client: %v", err)
	}

	if result.ID != expectedClient.ID {
		t.Errorf("expected client ID %s, got %s", expectedClient.ID, result.ID)
	}
}

func TestClientsClient_UpdateClient(t *testing.T) {
	clientID := "test-client"
	expectedClient := Client{
		ID:   "client-123",
		Name: "Updated Client",
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			t.Errorf("expected PUT method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/clients/" + clientID
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedClient)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	clientsClient := NewClientsClient(client)
	req := UpdateClientRequest{
		Name: "Updated Client",
	}

	result, err := clientsClient.UpdateClient(context.Background(), "test-realm", clientID, req)
	if err != nil {
		t.Fatalf("failed to update client: %v", err)
	}

	if result.Name != expectedClient.Name {
		t.Errorf("expected name %s, got %s", expectedClient.Name, result.Name)
	}
}

func TestClientsClient_DeleteClient(t *testing.T) {
	clientID := "test-client"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			t.Errorf("expected DELETE method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/clients/" + clientID
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

	clientsClient := NewClientsClient(client)
	err = clientsClient.DeleteClient(context.Background(), "test-realm", clientID)
	if err != nil {
		t.Fatalf("failed to delete client: %v", err)
	}
}

func TestClientsClient_GetServiceAccount(t *testing.T) {
	clientID := "test-client"
	expectedUser := ServiceAccountUser{
		ID:       "user-123",
		Username: "service-account-test-client",
		Enabled:  true,
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/clients/" + clientID + "/service-account"
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedUser)
	}))
	defer server.Close()

	httpClient, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	clientsClient := NewClientsClient(httpClient)
	user, err := clientsClient.GetServiceAccount(context.Background(), "test-realm", clientID)
	if err != nil {
		t.Fatalf("failed to get service account: %v", err)
	}

	if user.ID != expectedUser.ID {
		t.Errorf("expected user ID %s, got %s", expectedUser.ID, user.ID)
	}
}

func TestClientsClient_RegenerateSecret(t *testing.T) {
	clientID := "test-client"
	expectedResp := RegenerateSecretResponse{
		ClientID:     clientID,
		ClientSecret: "new-secret-123",
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/clients/" + clientID + "/client-secret/regenerate"
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedResp)
	}))
	defer server.Close()

	httpClient, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	clientsClient := NewClientsClient(httpClient)
	resp, err := clientsClient.RegenerateSecret(context.Background(), "test-realm", clientID)
	if err != nil {
		t.Fatalf("failed to regenerate secret: %v", err)
	}

	if resp.ClientSecret != expectedResp.ClientSecret {
		t.Errorf("expected secret %s, got %s", expectedResp.ClientSecret, resp.ClientSecret)
	}
}