package idenplane

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

// mockUsersServer creates a mock users API server for testing
func mockUsersServer(handlers map[string]func(w http.ResponseWriter, r *http.Request)) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.Method + " " + r.URL.Path
		if handler, ok := handlers[key]; ok {
			handler(w, r)
			return
		}
		http.NotFound(w, r)
	}))
}

// TestUserServiceCreate tests creating a new user
func TestUserServiceCreate(t *testing.T) {
	createdUserID := ""
	server := mockUsersServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"POST /admin/realms/test-realm/users": func(w http.ResponseWriter, r *http.Request) {
			var req CreateUserRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Invalid JSON", http.StatusBadRequest)
				return
			}

			if req.Username == "" {
				http.Error(w, "Username required", http.StatusBadRequest)
				return
			}

			createdUserID = "user-123"
			w.Header().Set("Location", "http://localhost/admin/realms/test-realm/users/"+createdUserID)
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(map[string]any{
				"id":      createdUserID,
				"username": req.Username,
				"enabled": true,
			})
		},
		"GET /admin/realms/test-realm/users/user-123": func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"id":      createdUserID,
				"username": "testuser",
				"enabled": true,
				"email":   "testuser@example.com",
				"firstName": "Test",
				"lastName": "User",
			})
		},
	})
	defer server.Close()

	client := NewClient(Config{
		ServerURL: server.URL,
		Realm:     "test-realm",
		ClientID:  "test-client",
		ClientSecret: "test-secret",
	})

	req := CreateUserRequest{
		Username: "testuser",
		Email:    "testuser@example.com",
		FirstName: "Test",
		LastName: "User",
		Enabled: true,
	}

	user, err := client.Users.Create(context.Background(), req)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	if user == nil {
		t.Fatal("Expected user to be returned")
	}

	if user.Username != "testuser" {
		t.Errorf("Expected username 'testuser', got '%s'", user.Username)
	}

	if user.Email != "testuser@example.com" {
		t.Errorf("Expected email 'testuser@example.com', got '%s'", user.Email)
	}
}

// TestUserServiceCreateWithoutLocationHeader tests create when Location header is not returned
func TestUserServiceCreateWithoutLocationHeader(t *testing.T) {
	server := mockUsersServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"POST /admin/realms/test-realm/users": func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(map[string]any{
				"id":      "user-456",
				"username": "newuser",
				"enabled": true,
			})
		},
	})
	defer server.Close()

	client := NewClient(Config{
		ServerURL: server.URL,
		Realm:     "test-realm",
		ClientID:  "test-client",
		ClientSecret: "test-secret",
	})

	req := CreateUserRequest{
		Username: "newuser",
		Enabled:  true,
	}

	user, err := client.Users.Create(context.Background(), req)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	if user == nil {
		t.Fatal("Expected user to be returned")
	}

	if user.ID != "user-456" {
		t.Errorf("Expected user ID 'user-456', got '%s'", user.ID)
	}
}

// TestUserServiceCreateError tests error handling during user creation
func TestUserServiceCreateError(t *testing.T) {
	server := mockUsersServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"POST /admin/realms/test-realm/users": func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "Invalid request", http.StatusBadRequest)
		},
	})
	defer server.Close()

	client := NewClient(Config{
		ServerURL: server.URL,
		Realm:     "test-realm",
		ClientID:  "test-client",
		ClientSecret: "test-secret",
	})

	req := CreateUserRequest{
		Username: "testuser",
		Enabled:  true,
	}

	_, err := client.Users.Create(context.Background(), req)
	if err == nil {
		t.Error("Expected error for bad request")
	}
}

// TestUserServiceGet tests retrieving a user by ID
func TestUserServiceGet(t *testing.T) {
	server := mockUsersServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"GET /admin/realms/test-realm/users/user-123": func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"id":        "user-123",
				"username":  "testuser",
				"enabled":   true,
				"email":     "test@example.com",
				"firstName": "Test",
				"lastName":  "User",
				"createdAt": "2026-05-22T08:30:00.000Z",
				"updatedAt": "2026-05-22T08:30:00.000Z",
			})
		},
	})
	defer server.Close()

	client := NewClient(Config{
		ServerURL: server.URL,
		Realm:     "test-realm",
		ClientID:  "test-client",
		ClientSecret: "test-secret",
	})

	user, err := client.Users.Get(context.Background(), "user-123")
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}

	if user == nil {
		t.Fatal("Expected user to be returned")
	}

	if user.ID != "user-123" {
		t.Errorf("Expected ID 'user-123', got '%s'", user.ID)
	}

	if user.Username != "testuser" {
		t.Errorf("Expected username 'testuser', got '%s'", user.Username)
	}

	if !user.Enabled {
		t.Error("Expected user to be enabled")
	}
}

// TestUserServiceGetNotFound tests handling of non-existent user
func TestUserServiceGetNotFound(t *testing.T) {
	server := mockUsersServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"GET /admin/realms/test-realm/users/nonexistent": func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "User not found", http.StatusNotFound)
		},
	})
	defer server.Close()

	client := NewClient(Config{
		ServerURL: server.URL,
		Realm:     "test-realm",
		ClientID:  "test-client",
		ClientSecret: "test-secret",
	})

	_, err := client.Users.Get(context.Background(), "nonexistent")
	if err == nil {
		t.Error("Expected error for non-existent user")
	}
}

// TestUserServiceGetServerError tests handling of server errors
func TestUserServiceGetServerError(t *testing.T) {
	server := mockUsersServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"GET /admin/realms/test-realm/users/user-123": func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "Internal server error", http.StatusInternalServerError)
		},
	})
	defer server.Close()

	client := NewClient(Config{
		ServerURL: server.URL,
		Realm:     "test-realm",
		ClientID:  "test-client",
		ClientSecret: "test-secret",
	})

	_, err := client.Users.Get(context.Background(), "user-123")
	if err == nil {
		t.Error("Expected error for server error")
	}
}

// TestUserServiceList tests listing users with pagination. The SDK must send
// page/limit (not first/max), since the backend's ListUsersQueryDto only
// understands those.
func TestUserServiceList(t *testing.T) {
	server := mockUsersServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"GET /admin/realms/test-realm/users": func(w http.ResponseWriter, r *http.Request) {
			query := r.URL.Query()

			// Verify query parameters are passed
			if username := query.Get("username"); username != "testuser" {
				t.Errorf("Expected username filter 'testuser', got '%s'", username)
			}
			if page := query.Get("page"); page != "1" {
				t.Errorf("Expected page='1', got '%s'", page)
			}
			if limit := query.Get("limit"); limit != "10" {
				t.Errorf("Expected limit='10', got '%s'", limit)
			}
			// The legacy first/max names must NOT be sent — backend ignores them
			// (silent-failure pagination bug fixed in this commit).
			if got := query.Get("first"); got != "" {
				t.Errorf("Unexpected 'first' param: %q", got)
			}
			if got := query.Get("max"); got != "" {
				t.Errorf("Unexpected 'max' param: %q", got)
			}

			w.Header().Set("Content-Type", "application/json")
			users := []map[string]any{
				{"id": "user-1", "username": "user1", "enabled": true},
				{"id": "user-2", "username": "user2", "enabled": true},
				{"id": "user-3", "username": "user3", "enabled": false},
			}
			json.NewEncoder(w).Encode(users)
		},
	})
	defer server.Close()

	client := NewClient(Config{
		ServerURL: server.URL,
		Realm:     "test-realm",
		ClientID:  "test-client",
		ClientSecret: "test-secret",
	})

	params := ListUsersParams{
		Username: "testuser",
		Page:     1,
		Limit:    10,
	}

	users, count, err := client.Users.List(context.Background(), params)
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}

	if len(users) != 3 {
		t.Errorf("Expected 3 users, got %d", len(users))
	}

	if count != 3 {
		t.Errorf("Expected count 3, got %d", count)
	}
}

// TestUserServiceListDefaultPagination asserts that an empty ListUsersParams
// falls back to the backend defaults (page=1, limit=20 — matching
// ListUsersQueryDto in users.controller.ts).
func TestUserServiceListDefaultPagination(t *testing.T) {
	server := mockUsersServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"GET /admin/realms/test-realm/users": func(w http.ResponseWriter, r *http.Request) {
			query := r.URL.Query()
			if page := query.Get("page"); page != "1" {
				t.Errorf("Expected default page='1', got '%s'", page)
			}
			if limit := query.Get("limit"); limit != "20" {
				t.Errorf("Expected default limit='20', got '%s'", limit)
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode([]map[string]any{})
		},
	})
	defer server.Close()

	client := NewClient(Config{
		ServerURL: server.URL,
		Realm:     "test-realm",
		ClientID:  "test-client",
		ClientSecret: "test-secret",
	})

	_, _, err := client.Users.List(context.Background(), ListUsersParams{})
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}
}

// TestUserServiceListISOTimestamps locks the wire contract: createdAt/updatedAt
// are ISO 8601 strings (Prisma DateTime serialization), not Unix epoch ints.
func TestUserServiceListISOTimestamps(t *testing.T) {
	server := mockUsersServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"GET /admin/realms/test-realm/users": func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode([]map[string]any{
				{
					"id":            "u-1",
					"username":      "alice",
					"email":         "a@example.com",
					"firstName":     "Alice",
					"enabled":       true,
					"emailVerified": true,
					"createdAt":     "2026-05-22T08:30:00.000Z",
					"updatedAt":     "2026-05-22T09:00:00.000Z",
				},
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

	users, _, err := client.Users.List(context.Background(), ListUsersParams{})
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}
	if len(users) != 1 {
		t.Fatalf("Expected 1 user, got %d", len(users))
	}
	if users[0].CreatedAt != "2026-05-22T08:30:00.000Z" {
		t.Errorf("Expected CreatedAt '2026-05-22T08:30:00.000Z', got '%s'", users[0].CreatedAt)
	}
	if users[0].UpdatedAt != "2026-05-22T09:00:00.000Z" {
		t.Errorf("Expected UpdatedAt '2026-05-22T09:00:00.000Z', got '%s'", users[0].UpdatedAt)
	}
}

// TestUserServiceListWithFilters tests listing users with multiple filters
func TestUserServiceListWithFilters(t *testing.T) {
	server := mockUsersServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"GET /admin/realms/test-realm/users": func(w http.ResponseWriter, r *http.Request) {
			query := r.URL.Query()

			if email := query.Get("email"); email != "test@example.com" {
				t.Errorf("Expected email filter 'test@example.com', got '%s'", email)
			}

			if firstName := query.Get("firstName"); firstName != "John" {
				t.Errorf("Expected firstName filter 'John', got '%s'", firstName)
			}

			if lastName := query.Get("lastName"); lastName != "Doe" {
				t.Errorf("Expected lastName filter 'Doe', got '%s'", lastName)
			}

			if search := query.Get("search"); search != "john" {
				t.Errorf("Expected search filter 'john', got '%s'", search)
			}

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode([]map[string]any{
				{"id": "user-1", "username": "johndoe", "enabled": true},
			})
		},
	})
	defer server.Close()

	client := NewClient(Config{
		ServerURL: server.URL,
		Realm:     "test-realm",
		ClientID:  "test-client",
		ClientSecret: "test-secret",
	})

	enabled := true
	params := ListUsersParams{
		Email:     "test@example.com",
		FirstName: "John",
		LastName:  "Doe",
		Search:    "john",
		Enabled:   &enabled,
		Page:      1,
		Limit:     20,
	}

	users, _, err := client.Users.List(context.Background(), params)
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}

	if len(users) != 1 {
		t.Errorf("Expected 1 user, got %d", len(users))
	}
}

// TestUserServiceListEmpty tests listing when no users exist
func TestUserServiceListEmpty(t *testing.T) {
	server := mockUsersServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"GET /admin/realms/test-realm/users": func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode([]map[string]any{})
		},
	})
	defer server.Close()

	client := NewClient(Config{
		ServerURL: server.URL,
		Realm:     "test-realm",
		ClientID:  "test-client",
		ClientSecret: "test-secret",
	})

	users, count, err := client.Users.List(context.Background(), ListUsersParams{})
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}

	if len(users) != 0 {
		t.Errorf("Expected 0 users, got %d", len(users))
	}

	if count != 0 {
		t.Errorf("Expected count 0, got %d", count)
	}
}

// TestUserServiceListServerError tests handling of server errors during list
func TestUserServiceListServerError(t *testing.T) {
	server := mockUsersServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"GET /admin/realms/test-realm/users": func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "Internal server error", http.StatusInternalServerError)
		},
	})
	defer server.Close()

	client := NewClient(Config{
		ServerURL: server.URL,
		Realm:     "test-realm",
		ClientID:  "test-client",
		ClientSecret: "test-secret",
	})

	_, _, err := client.Users.List(context.Background(), ListUsersParams{})
	if err == nil {
		t.Error("Expected error for server error")
	}
}

// TestUserServiceUpdate tests updating a user
func TestUserServiceUpdate(t *testing.T) {
	server := mockUsersServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"PUT /admin/realms/test-realm/users/user-123": func(w http.ResponseWriter, r *http.Request) {
			var req UpdateUserRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Invalid JSON", http.StatusBadRequest)
				return
			}

			if req.Email != nil && *req.Email != "updated@example.com" {
				t.Errorf("Expected email 'updated@example.com', got '%s'", *req.Email)
			}

			w.WriteHeader(http.StatusNoContent)
		},
	})
	defer server.Close()

	client := NewClient(Config{
		ServerURL: server.URL,
		Realm:     "test-realm",
		ClientID:  "test-client",
		ClientSecret: "test-secret",
	})

	email := "updated@example.com"
	req := UpdateUserRequest{
		Email: &email,
	}

	err := client.Users.Update(context.Background(), "user-123", req)
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}
}

// TestUserServiceUpdateNotFound tests handling of non-existent user during update
func TestUserServiceUpdateNotFound(t *testing.T) {
	server := mockUsersServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"PUT /admin/realms/test-realm/users/nonexistent": func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "User not found", http.StatusNotFound)
		},
	})
	defer server.Close()

	client := NewClient(Config{
		ServerURL: server.URL,
		Realm:     "test-realm",
		ClientID:  "test-client",
		ClientSecret: "test-secret",
	})

	err := client.Users.Update(context.Background(), "nonexistent", UpdateUserRequest{})
	if err == nil {
		t.Error("Expected error for non-existent user")
	}
}

// TestUserServiceUpdateServerError tests handling of server errors during update
func TestUserServiceUpdateServerError(t *testing.T) {
	server := mockUsersServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"PUT /admin/realms/test-realm/users/user-123": func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "Internal server error", http.StatusInternalServerError)
		},
	})
	defer server.Close()

	client := NewClient(Config{
		ServerURL: server.URL,
		Realm:     "test-realm",
		ClientID:  "test-client",
		ClientSecret: "test-secret",
	})

	err := client.Users.Update(context.Background(), "user-123", UpdateUserRequest{})
	if err == nil {
		t.Error("Expected error for server error")
	}
}

// TestUserServiceDelete tests deleting a user
func TestUserServiceDelete(t *testing.T) {
	deleteCalled := false
	server := mockUsersServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"DELETE /admin/realms/test-realm/users/user-123": func(w http.ResponseWriter, r *http.Request) {
			deleteCalled = true
			w.WriteHeader(http.StatusNoContent)
		},
	})
	defer server.Close()

	client := NewClient(Config{
		ServerURL: server.URL,
		Realm:     "test-realm",
		ClientID:  "test-client",
		ClientSecret: "test-secret",
	})

	err := client.Users.Delete(context.Background(), "user-123")
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	if !deleteCalled {
		t.Error("Delete was not called")
	}
}

// TestUserServiceDeleteNotFound tests handling of non-existent user during delete
func TestUserServiceDeleteNotFound(t *testing.T) {
	server := mockUsersServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"DELETE /admin/realms/test-realm/users/nonexistent": func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "User not found", http.StatusNotFound)
		},
	})
	defer server.Close()

	client := NewClient(Config{
		ServerURL: server.URL,
		Realm:     "test-realm",
		ClientID:  "test-client",
		ClientSecret: "test-secret",
	})

	err := client.Users.Delete(context.Background(), "nonexistent")
	if err == nil {
		t.Error("Expected error for non-existent user")
	}
}

// TestUserServiceDeleteServerError tests handling of server errors during delete
func TestUserServiceDeleteServerError(t *testing.T) {
	server := mockUsersServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"DELETE /admin/realms/test-realm/users/user-123": func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "Internal server error", http.StatusInternalServerError)
		},
	})
	defer server.Close()

	client := NewClient(Config{
		ServerURL: server.URL,
		Realm:     "test-realm",
		ClientID:  "test-client",
		ClientSecret: "test-secret",
	})

	err := client.Users.Delete(context.Background(), "user-123")
	if err == nil {
		t.Error("Expected error for server error")
	}
}

// TestUserServiceResetPassword tests resetting a user's password
func TestUserServiceResetPassword(t *testing.T) {
	server := mockUsersServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"PUT /admin/realms/test-realm/users/user-123/reset-password": func(w http.ResponseWriter, r *http.Request) {
			var reqBody map[string]any
			if err := json.NewDecoder(r.Body).Decode(&reqBody); err != nil {
				http.Error(w, "Invalid JSON", http.StatusBadRequest)
				return
			}

			if reqBody["value"] != "newPassword123" {
				t.Errorf("Expected password 'newPassword123', got '%v'", reqBody["value"])
			}

			if reqBody["type"] != "password" {
				t.Errorf("Expected type 'password', got '%v'", reqBody["type"])
			}

			w.WriteHeader(http.StatusNoContent)
		},
	})
	defer server.Close()

	client := NewClient(Config{
		ServerURL: server.URL,
		Realm:     "test-realm",
		ClientID:  "test-client",
		ClientSecret: "test-secret",
	})

	err := client.Users.ResetPassword(context.Background(), "user-123", "newPassword123", false)
	if err != nil {
		t.Fatalf("ResetPassword failed: %v", err)
	}
}

// TestUserServiceResetPasswordNotFound tests handling of non-existent user during password reset
func TestUserServiceResetPasswordNotFound(t *testing.T) {
	server := mockUsersServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"PUT /admin/realms/test-realm/users/nonexistent/reset-password": func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "User not found", http.StatusNotFound)
		},
	})
	defer server.Close()

	client := NewClient(Config{
		ServerURL: server.URL,
		Realm:     "test-realm",
		ClientID:  "test-client",
		ClientSecret: "test-secret",
	})

	err := client.Users.ResetPassword(context.Background(), "nonexistent", "newPassword123", false)
	if err == nil {
		t.Error("Expected error for non-existent user")
	}
}

// TestUserServiceResetPasswordTemporary tests setting temporary password
func TestUserServiceResetPasswordTemporary(t *testing.T) {
	temporary := true
	server := mockUsersServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"PUT /admin/realms/test-realm/users/user-123/reset-password": func(w http.ResponseWriter, r *http.Request) {
			var reqBody map[string]any
			if err := json.NewDecoder(r.Body).Decode(&reqBody); err != nil {
				http.Error(w, "Invalid JSON", http.StatusBadRequest)
				return
			}

			if reqBody["temporary"] != temporary {
				t.Errorf("Expected temporary=true, got %v", reqBody["temporary"])
			}

			w.WriteHeader(http.StatusNoContent)
		},
	})
	defer server.Close()

	client := NewClient(Config{
		ServerURL: server.URL,
		Realm:     "test-realm",
		ClientID:  "test-client",
		ClientSecret: "test-secret",
	})

	err := client.Users.ResetPassword(context.Background(), "user-123", "tempPassword123", true)
	if err != nil {
		t.Fatalf("ResetPassword failed: %v", err)
	}
}

// TestUserServiceConcurrency tests thread safety of user service operations
func TestUserServiceConcurrency(t *testing.T) {
	var wg sync.WaitGroup
	requestCount := 0
	var mu sync.Mutex

	server := mockUsersServer(map[string]func(w http.ResponseWriter, r *http.Request){
		"GET /admin/realms/test-realm/users": func(w http.ResponseWriter, r *http.Request) {
			mu.Lock()
			requestCount++
			mu.Unlock()

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode([]map[string]any{
				{"id": "user-1", "username": "user1", "enabled": true},
			})
		},
	})
	defer server.Close()

	client := NewClient(Config{
		ServerURL: server.URL,
		Realm:     "test-realm",
		ClientID:  "test-client",
		ClientSecret: "test-secret",
	})

	numGoroutines := 50
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _, err := client.Users.List(context.Background(), ListUsersParams{})
			if err != nil {
				t.Errorf("List failed: %v", err)
			}
		}()
	}

	wg.Wait()

	mu.Lock()
	if requestCount != numGoroutines {
		t.Logf("Note: %d requests made (may include cache hits)", requestCount)
	}
	mu.Unlock()
}

// TestUserRepresentationToUser tests conversion from UserRepresentation to User.
// The createdAt/updatedAt wire fields are ISO 8601 strings because Prisma
// serializes DateTime columns to ISO strings, not Unix-epoch integers.
func TestUserRepresentationToUser(t *testing.T) {
	rep := &UserRepresentation{
		ID:            "user-123",
		CreatedAt:     "2026-05-22T08:30:00.000Z",
		UpdatedAt:     "2026-05-22T09:00:00.000Z",
		Username:      "testuser",
		Enabled:       true,
		EmailVerified: true,
		Email:         "test@example.com",
		FirstName:     "Test",
		LastName:      "User",
		Groups:        []string{"admin", "users"},
		Attributes: map[string][]string{
			"custom_attr": {"value1", "value2"},
		},
	}

	user := rep.toUser()

	if user.ID != "user-123" {
		t.Errorf("Expected ID 'user-123', got '%s'", user.ID)
	}

	if user.Username != "testuser" {
		t.Errorf("Expected username 'testuser', got '%s'", user.Username)
	}

	if !user.Enabled {
		t.Error("Expected enabled=true")
	}

	if !user.EmailVerified {
		t.Error("Expected emailVerified=true")
	}

	if user.Email != "test@example.com" {
		t.Errorf("Expected email 'test@example.com', got '%s'", user.Email)
	}

	if user.FirstName != "Test" {
		t.Errorf("Expected firstName 'Test', got '%s'", user.FirstName)
	}

	if user.LastName != "User" {
		t.Errorf("Expected lastName 'User', got '%s'", user.LastName)
	}

	if len(user.Groups) != 2 {
		t.Errorf("Expected 2 groups, got %d", len(user.Groups))
	}

	if user.CreatedAt != "2026-05-22T08:30:00.000Z" {
		t.Errorf("Expected CreatedAt '2026-05-22T08:30:00.000Z', got '%s'", user.CreatedAt)
	}

	if user.UpdatedAt != "2026-05-22T09:00:00.000Z" {
		t.Errorf("Expected UpdatedAt '2026-05-22T09:00:00.000Z', got '%s'", user.UpdatedAt)
	}
}

// TestExtractUserID tests the extractUserID helper function
func TestExtractUserID(t *testing.T) {
	tests := []struct {
		name     string
		location string
		expected string
	}{
		{
			name:     "standard URL",
			location: "http://localhost/admin/realms/test-realm/users/user-123",
			expected: "user-123",
		},
		{
			name:     "URL with trailing slash",
			location: "http://localhost/admin/realms/test-realm/users/user-123/",
			expected: "user-123",
		},
		{
			name:     "just user ID",
			location: "user-456",
			expected: "user-456",
		},
		{
			name:     "empty string",
			location: "",
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := extractUserID(tt.location)
			if result != tt.expected {
				t.Errorf("extractUserID(%q) = %q, want %q", tt.location, result, tt.expected)
			}
		})
	}
}

// TestUserAttributes tests UserAttributes struct
func TestUserAttributes(t *testing.T) {
	// UserAttributes is currently a placeholder, test that it can be instantiated
	attrs := UserAttributes{}
	if attrs != (UserAttributes{}) {
		t.Error("Expected empty UserAttributes")
	}
}