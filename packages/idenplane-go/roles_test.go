package idenplane

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

// mockRolesServer creates a mock roles API server for testing.
func mockRolesServer(handlers map[string]func(w http.ResponseWriter, r *http.Request)) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.Method + " " + r.URL.Path
		if handler, ok := handlers[key]; ok {
			handler(w, r)
			return
		}
		http.NotFound(w, r)
	}))
}

// TestRoleServiceCreate tests creating a new realm role.
func TestRoleServiceCreate(t *testing.T) {
	server := mockRolesServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"POST /admin/realms/test-realm/roles": func(w http.ResponseWriter, r *http.Request) {
			var req CreateRoleRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Invalid JSON", http.StatusBadRequest)
				return
			}
			if req.Name == "" {
				http.Error(w, "Name required", http.StatusBadRequest)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(map[string]any{
				"id":          "role-123",
				"realmId":     "realm-1",
				"name":        req.Name,
				"description": req.Description,
				"createdAt":   "2026-05-22T08:30:00.000Z",
				"updatedAt":   "2026-05-22T08:30:00.000Z",
			})
		},
	})
	defer server.Close()

	client := NewClient(Config{
		ServerURL:    server.URL,
		Realm:        "test-realm",
		ClientID:     "test-client",
		ClientSecret: "test-secret",
	})

	role, err := client.Roles.Create(context.Background(), CreateRoleRequest{
		Name:        "admin",
		Description: "Administrator role",
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	if role == nil {
		t.Fatal("Expected role to be returned")
	}
	if role.Name != "admin" {
		t.Errorf("Expected name 'admin', got '%s'", role.Name)
	}
	if role.Description != "Administrator role" {
		t.Errorf("Expected description 'Administrator role', got '%s'", role.Description)
	}
	if role.ID != "role-123" {
		t.Errorf("Expected ID 'role-123', got '%s'", role.ID)
	}
}

// TestRoleServiceCreateValidation tests client-side validation of an empty name.
func TestRoleServiceCreateValidation(t *testing.T) {
	client := NewClient(Config{
		ServerURL:    "https://example.com",
		Realm:        "test-realm",
		ClientID:     "test-client",
		ClientSecret: "test-secret",
	})

	_, err := client.Roles.Create(context.Background(), CreateRoleRequest{})
	if err == nil {
		t.Error("Expected error for empty role name")
	}
}

// TestRoleServiceCreateError tests error handling during role creation.
func TestRoleServiceCreateError(t *testing.T) {
	server := mockRolesServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"POST /admin/realms/test-realm/roles": func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "Invalid request", http.StatusBadRequest)
		},
	})
	defer server.Close()

	client := NewClient(Config{
		ServerURL:    server.URL,
		Realm:        "test-realm",
		ClientID:     "test-client",
		ClientSecret: "test-secret",
	})

	_, err := client.Roles.Create(context.Background(), CreateRoleRequest{Name: "admin"})
	if err == nil {
		t.Error("Expected error for bad request")
	}
}

// TestRoleServiceGet tests retrieving a role by name.
func TestRoleServiceGet(t *testing.T) {
	server := mockRolesServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"GET /admin/realms/test-realm/roles/admin": func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"id":          "role-123",
				"realmId":     "realm-1",
				"name":        "admin",
				"description": "Administrator role",
				"createdAt":   "2026-05-22T08:30:00.000Z",
				"updatedAt":   "2026-05-22T08:30:00.000Z",
			})
		},
	})
	defer server.Close()

	client := NewClient(Config{
		ServerURL:    server.URL,
		Realm:        "test-realm",
		ClientID:     "test-client",
		ClientSecret: "test-secret",
	})

	role, err := client.Roles.Get(context.Background(), "admin")
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if role == nil {
		t.Fatal("Expected role to be returned")
	}
	if role.Name != "admin" {
		t.Errorf("Expected name 'admin', got '%s'", role.Name)
	}
	if role.CreatedAt != "2026-05-22T08:30:00.000Z" {
		t.Errorf("Expected CreatedAt '2026-05-22T08:30:00.000Z', got '%s'", role.CreatedAt)
	}
}

// TestRoleServiceGetNotFound tests handling of a non-existent role.
func TestRoleServiceGetNotFound(t *testing.T) {
	server := mockRolesServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"GET /admin/realms/test-realm/roles/nonexistent": func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "Role not found", http.StatusNotFound)
		},
	})
	defer server.Close()

	client := NewClient(Config{
		ServerURL:    server.URL,
		Realm:        "test-realm",
		ClientID:     "test-client",
		ClientSecret: "test-secret",
	})

	_, err := client.Roles.Get(context.Background(), "nonexistent")
	if err == nil {
		t.Error("Expected error for non-existent role")
	}
	var idenplaneErr *Error
	if !errors.As(err, &idenplaneErr) {
		t.Fatalf("Expected *Error, got %T", err)
	}
	if idenplaneErr.Code != ErrCodeRoleNotFound {
		t.Errorf("Expected code %q, got %q", ErrCodeRoleNotFound, idenplaneErr.Code)
	}
}

// TestRoleServiceList tests listing realm roles.
func TestRoleServiceList(t *testing.T) {
	server := mockRolesServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"GET /admin/realms/test-realm/roles": func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode([]map[string]any{
				{"id": "role-1", "realmId": "realm-1", "name": "admin"},
				{"id": "role-2", "realmId": "realm-1", "name": "member"},
			})
		},
	})
	defer server.Close()

	client := NewClient(Config{
		ServerURL:    server.URL,
		Realm:        "test-realm",
		ClientID:     "test-client",
		ClientSecret: "test-secret",
	})

	roles, err := client.Roles.List(context.Background())
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}
	if len(roles) != 2 {
		t.Errorf("Expected 2 roles, got %d", len(roles))
	}
}

// TestRoleServiceListServerError tests handling of server errors during list.
func TestRoleServiceListServerError(t *testing.T) {
	server := mockRolesServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"GET /admin/realms/test-realm/roles": func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "Internal server error", http.StatusInternalServerError)
		},
	})
	defer server.Close()

	client := NewClient(Config{
		ServerURL:    server.URL,
		Realm:        "test-realm",
		ClientID:     "test-client",
		ClientSecret: "test-secret",
	})

	_, err := client.Roles.List(context.Background())
	if err == nil {
		t.Error("Expected error for server error")
	}
}

// TestRoleServiceUpdate tests updating a role.
func TestRoleServiceUpdate(t *testing.T) {
	server := mockRolesServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"PUT /admin/realms/test-realm/roles/admin": func(w http.ResponseWriter, r *http.Request) {
			var req UpdateRoleRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Invalid JSON", http.StatusBadRequest)
				return
			}
			if req.Description == nil || *req.Description != "Updated description" {
				t.Errorf("Expected description 'Updated description', got %v", req.Description)
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"id":          "role-123",
				"realmId":     "realm-1",
				"name":        "admin",
				"description": "Updated description",
				"createdAt":   "2026-05-22T08:30:00.000Z",
				"updatedAt":   "2026-05-22T09:00:00.000Z",
			})
		},
	})
	defer server.Close()

	client := NewClient(Config{
		ServerURL:    server.URL,
		Realm:        "test-realm",
		ClientID:     "test-client",
		ClientSecret: "test-secret",
	})

	desc := "Updated description"
	role, err := client.Roles.Update(context.Background(), "admin", UpdateRoleRequest{Description: &desc})
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	if role.Description != "Updated description" {
		t.Errorf("Expected description 'Updated description', got '%s'", role.Description)
	}
}

// TestRoleServiceUpdateNotFound tests handling of a non-existent role during update.
func TestRoleServiceUpdateNotFound(t *testing.T) {
	server := mockRolesServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"PUT /admin/realms/test-realm/roles/nonexistent": func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "Role not found", http.StatusNotFound)
		},
	})
	defer server.Close()

	client := NewClient(Config{
		ServerURL:    server.URL,
		Realm:        "test-realm",
		ClientID:     "test-client",
		ClientSecret: "test-secret",
	})

	_, err := client.Roles.Update(context.Background(), "nonexistent", UpdateRoleRequest{})
	if err == nil {
		t.Error("Expected error for non-existent role")
	}
}

// TestRoleServiceDelete tests deleting a role.
func TestRoleServiceDelete(t *testing.T) {
	deleteCalled := false
	server := mockRolesServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"DELETE /admin/realms/test-realm/roles/admin": func(w http.ResponseWriter, r *http.Request) {
			deleteCalled = true
			w.WriteHeader(http.StatusNoContent)
		},
	})
	defer server.Close()

	client := NewClient(Config{
		ServerURL:    server.URL,
		Realm:        "test-realm",
		ClientID:     "test-client",
		ClientSecret: "test-secret",
	})

	err := client.Roles.Delete(context.Background(), "admin")
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}
	if !deleteCalled {
		t.Error("Delete was not called")
	}
}

// TestRoleServiceDeleteNotFound tests handling of a non-existent role during delete.
func TestRoleServiceDeleteNotFound(t *testing.T) {
	server := mockRolesServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"DELETE /admin/realms/test-realm/roles/nonexistent": func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "Role not found", http.StatusNotFound)
		},
	})
	defer server.Close()

	client := NewClient(Config{
		ServerURL:    server.URL,
		Realm:        "test-realm",
		ClientID:     "test-client",
		ClientSecret: "test-secret",
	})

	err := client.Roles.Delete(context.Background(), "nonexistent")
	if err == nil {
		t.Error("Expected error for non-existent role")
	}
}
