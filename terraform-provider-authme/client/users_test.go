// Package client provides HTTP client functionality for AuthMe API communication
package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestUsersClient_CreateUser(t *testing.T) {
	enabled := true
	expectedUser := User{
		ID:       "user-123",
		RealmID:  "realm-123",
		Username: "testuser",
		Email:    "test@example.com",
		Enabled:  true,
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST method, got %s", r.Method)
		}
		if r.URL.Path != "/admin/realms/test-realm/users" {
			t.Errorf("expected path /admin/realms/test-realm/users, got %s", r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedUser)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	usersClient := NewUsersClient(client)
	req := CreateUserRequest{
		Username: "testuser",
		Email:    "test@example.com",
		Enabled:  &enabled,
	}

	user, err := usersClient.CreateUser(context.Background(), "test-realm", req)
	if err != nil {
		t.Fatalf("failed to create user: %v", err)
	}

	if user.ID != expectedUser.ID {
		t.Errorf("expected user ID %s, got %s", expectedUser.ID, user.ID)
	}
	if user.Username != expectedUser.Username {
		t.Errorf("expected username %s, got %s", expectedUser.Username, user.Username)
	}
}

func TestUsersClient_ListUsers(t *testing.T) {
	expectedUsers := []User{
		{ID: "user-1", Username: "user1"},
		{ID: "user-2", Username: "user2"},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET method, got %s", r.Method)
		}
		if r.URL.Path != "/admin/realms/test-realm/users" {
			t.Errorf("expected path /admin/realms/test-realm/users, got %s", r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedUsers)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	usersClient := NewUsersClient(client)
	users, err := usersClient.ListUsers(context.Background(), "test-realm")
	if err != nil {
		t.Fatalf("failed to list users: %v", err)
	}

	if len(users) != len(expectedUsers) {
		t.Errorf("expected %d users, got %d", len(expectedUsers), len(users))
	}
}

func TestUsersClient_GetUser(t *testing.T) {
	userID := "user-123"
	expectedUser := User{
		ID:       userID,
		Username: "testuser",
		Email:    "test@example.com",
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("expected GET method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/users/" + userID
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedUser)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	usersClient := NewUsersClient(client)
	user, err := usersClient.GetUser(context.Background(), "test-realm", userID)
	if err != nil {
		t.Fatalf("failed to get user: %v", err)
	}

	if user.ID != expectedUser.ID {
		t.Errorf("expected user ID %s, got %s", expectedUser.ID, user.ID)
	}
}

func TestUsersClient_UpdateUser(t *testing.T) {
	userID := "user-123"
	expectedUser := User{
		ID:    userID,
		Email: "updated@example.com",
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			t.Errorf("expected PUT method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/users/" + userID
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(expectedUser)
	}))
	defer server.Close()

	client, err := DefaultClient(server.URL, "test-api-key")
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	usersClient := NewUsersClient(client)
	email := "updated@example.com"
	req := UpdateUserRequest{
		Email: &email,
	}

	user, err := usersClient.UpdateUser(context.Background(), "test-realm", userID, req)
	if err != nil {
		t.Fatalf("failed to update user: %v", err)
	}

	if user.Email != expectedUser.Email {
		t.Errorf("expected email %s, got %s", expectedUser.Email, user.Email)
	}
}

func TestUsersClient_DeleteUser(t *testing.T) {
	userID := "user-123"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			t.Errorf("expected DELETE method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/users/" + userID
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

	usersClient := NewUsersClient(client)
	err = usersClient.DeleteUser(context.Background(), "test-realm", userID)
	if err != nil {
		t.Fatalf("failed to delete user: %v", err)
	}
}

func TestUsersClient_ResetUserPassword(t *testing.T) {
	userID := "user-123"
	temporary := false

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			t.Errorf("expected PUT method, got %s", r.Method)
		}
		expectedPath := "/admin/realms/test-realm/users/" + userID + "/reset-password"
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

	usersClient := NewUsersClient(client)
	req := ResetPasswordRequest{
		Type:      "password",
		Temporary: &temporary,
		Value:     "newpassword123",
	}

	err = usersClient.ResetUserPassword(context.Background(), "test-realm", userID, req)
	if err != nil {
		t.Fatalf("failed to reset user password: %v", err)
	}
}