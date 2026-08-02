package idenplane

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

// mockGroupsServer creates a mock groups API server for testing.
func mockGroupsServer(handlers map[string]func(w http.ResponseWriter, r *http.Request)) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.Method + " " + r.URL.Path
		if handler, ok := handlers[key]; ok {
			handler(w, r)
			return
		}
		http.NotFound(w, r)
	}))
}

// TestGroupServiceCreate tests creating a new realm group.
func TestGroupServiceCreate(t *testing.T) {
	server := mockGroupsServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"POST /admin/realms/test-realm/groups": func(w http.ResponseWriter, r *http.Request) {
			var req CreateGroupRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Invalid JSON", http.StatusBadRequest)
				return
			}
			if req.Name == "" {
				http.Error(w, "Name required", http.StatusBadRequest)
				return
			}
			if req.Path != "/engineering" {
				t.Errorf("Expected path '/engineering' in request, got '%s'", req.Path)
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(map[string]any{
				"id":          "group-123",
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

	group, err := client.Groups.Create(context.Background(), CreateGroupRequest{
		Name:        "engineering",
		Description: "Engineering team",
		Path:        "/engineering",
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	if group == nil {
		t.Fatal("Expected group to be returned")
	}
	if group.Name != "engineering" {
		t.Errorf("Expected name 'engineering', got '%s'", group.Name)
	}
	if group.ID != "group-123" {
		t.Errorf("Expected ID 'group-123', got '%s'", group.ID)
	}
}

// TestGroupServiceCreateSendsPath tests that Path is included in the create
// request body. The live backend currently accepts but does not persist or
// echo back Path (no path column on the Group model), so this test only
// asserts what the SDK sends, not what comes back.
func TestGroupServiceCreateSendsPath(t *testing.T) {
	server := mockGroupsServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"POST /admin/realms/test-realm/groups": func(w http.ResponseWriter, r *http.Request) {
			var req CreateGroupRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Invalid JSON", http.StatusBadRequest)
				return
			}
			if req.Path != "/engineering" {
				t.Errorf("Expected path '/engineering', got '%s'", req.Path)
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(map[string]any{
				"id":      "group-789",
				"realmId": "realm-1",
				"name":    req.Name,
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

	_, err := client.Groups.Create(context.Background(), CreateGroupRequest{
		Name: "engineering",
		Path: "/engineering",
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
}

// TestGroupServiceCreateWithParent tests creating a nested group with a parentId.
func TestGroupServiceCreateWithParent(t *testing.T) {
	server := mockGroupsServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"POST /admin/realms/test-realm/groups": func(w http.ResponseWriter, r *http.Request) {
			var req CreateGroupRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Invalid JSON", http.StatusBadRequest)
				return
			}
			if req.ParentID != "group-parent" {
				t.Errorf("Expected parentId 'group-parent', got '%s'", req.ParentID)
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(map[string]any{
				"id":       "group-456",
				"realmId":  "realm-1",
				"name":     req.Name,
				"parentId": req.ParentID,
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

	group, err := client.Groups.Create(context.Background(), CreateGroupRequest{
		Name:     "subteam",
		ParentID: "group-parent",
	})
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	if group.ParentID != "group-parent" {
		t.Errorf("Expected parentId 'group-parent', got '%s'", group.ParentID)
	}
}

// TestGroupServiceCreateValidation tests client-side validation of an empty name.
func TestGroupServiceCreateValidation(t *testing.T) {
	client := NewClient(Config{
		ServerURL:    "https://example.com",
		Realm:        "test-realm",
		ClientID:     "test-client",
		ClientSecret: "test-secret",
	})

	_, err := client.Groups.Create(context.Background(), CreateGroupRequest{})
	if err == nil {
		t.Error("Expected error for empty group name")
	}
}

// TestGroupServiceCreateError tests error handling during group creation.
func TestGroupServiceCreateError(t *testing.T) {
	server := mockGroupsServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"POST /admin/realms/test-realm/groups": func(w http.ResponseWriter, r *http.Request) {
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

	_, err := client.Groups.Create(context.Background(), CreateGroupRequest{Name: "engineering"})
	if err == nil {
		t.Error("Expected error for bad request")
	}
}

// TestGroupServiceGet tests retrieving a group by ID.
func TestGroupServiceGet(t *testing.T) {
	server := mockGroupsServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"GET /admin/realms/test-realm/groups/group-123": func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"id":          "group-123",
				"realmId":     "realm-1",
				"name":        "engineering",
				"description": "Engineering team",
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

	group, err := client.Groups.Get(context.Background(), "group-123")
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if group == nil {
		t.Fatal("Expected group to be returned")
	}
	if group.Name != "engineering" {
		t.Errorf("Expected name 'engineering', got '%s'", group.Name)
	}
}

// TestGroupServiceGetNotFound tests handling of a non-existent group.
func TestGroupServiceGetNotFound(t *testing.T) {
	server := mockGroupsServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"GET /admin/realms/test-realm/groups/nonexistent": func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "Group not found", http.StatusNotFound)
		},
	})
	defer server.Close()

	client := NewClient(Config{
		ServerURL:    server.URL,
		Realm:        "test-realm",
		ClientID:     "test-client",
		ClientSecret: "test-secret",
	})

	_, err := client.Groups.Get(context.Background(), "nonexistent")
	if err == nil {
		t.Error("Expected error for non-existent group")
	}
	var idenplaneErr *Error
	if !errors.As(err, &idenplaneErr) {
		t.Fatalf("Expected *Error, got %T", err)
	}
	if idenplaneErr.Code != ErrCodeGroupNotFound {
		t.Errorf("Expected code %q, got %q", ErrCodeGroupNotFound, idenplaneErr.Code)
	}
}

// TestGroupServiceList tests listing realm groups.
func TestGroupServiceList(t *testing.T) {
	server := mockGroupsServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"GET /admin/realms/test-realm/groups": func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode([]map[string]any{
				{"id": "group-1", "realmId": "realm-1", "name": "engineering"},
				{"id": "group-2", "realmId": "realm-1", "name": "sales"},
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

	groups, err := client.Groups.List(context.Background())
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}
	if len(groups) != 2 {
		t.Errorf("Expected 2 groups, got %d", len(groups))
	}
}

// TestGroupServiceListServerError tests handling of server errors during list.
func TestGroupServiceListServerError(t *testing.T) {
	server := mockGroupsServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"GET /admin/realms/test-realm/groups": func(w http.ResponseWriter, r *http.Request) {
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

	_, err := client.Groups.List(context.Background())
	if err == nil {
		t.Error("Expected error for server error")
	}
}

// TestGroupServiceUpdate tests updating a group.
func TestGroupServiceUpdate(t *testing.T) {
	server := mockGroupsServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"PUT /admin/realms/test-realm/groups/group-123": func(w http.ResponseWriter, r *http.Request) {
			var req UpdateGroupRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Invalid JSON", http.StatusBadRequest)
				return
			}
			if req.Description == nil || *req.Description != "Updated description" {
				t.Errorf("Expected description 'Updated description', got %v", req.Description)
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"id":          "group-123",
				"realmId":     "realm-1",
				"name":        "engineering",
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
	group, err := client.Groups.Update(context.Background(), "group-123", UpdateGroupRequest{Description: &desc})
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	if group.Description != "Updated description" {
		t.Errorf("Expected description 'Updated description', got '%s'", group.Description)
	}
}

// TestGroupServiceUpdateNotFound tests handling of a non-existent group during update.
func TestGroupServiceUpdateNotFound(t *testing.T) {
	server := mockGroupsServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"PUT /admin/realms/test-realm/groups/nonexistent": func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "Group not found", http.StatusNotFound)
		},
	})
	defer server.Close()

	client := NewClient(Config{
		ServerURL:    server.URL,
		Realm:        "test-realm",
		ClientID:     "test-client",
		ClientSecret: "test-secret",
	})

	_, err := client.Groups.Update(context.Background(), "nonexistent", UpdateGroupRequest{})
	if err == nil {
		t.Error("Expected error for non-existent group")
	}
}

// TestGroupServiceDelete tests deleting a group.
func TestGroupServiceDelete(t *testing.T) {
	deleteCalled := false
	server := mockGroupsServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"DELETE /admin/realms/test-realm/groups/group-123": func(w http.ResponseWriter, r *http.Request) {
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

	err := client.Groups.Delete(context.Background(), "group-123")
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}
	if !deleteCalled {
		t.Error("Delete was not called")
	}
}

// TestGroupServiceDeleteNotFound tests handling of a non-existent group during delete.
func TestGroupServiceDeleteNotFound(t *testing.T) {
	server := mockGroupsServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"DELETE /admin/realms/test-realm/groups/nonexistent": func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "Group not found", http.StatusNotFound)
		},
	})
	defer server.Close()

	client := NewClient(Config{
		ServerURL:    server.URL,
		Realm:        "test-realm",
		ClientID:     "test-client",
		ClientSecret: "test-secret",
	})

	err := client.Groups.Delete(context.Background(), "nonexistent")
	if err == nil {
		t.Error("Expected error for non-existent group")
	}
}
