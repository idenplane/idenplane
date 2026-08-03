//go:build integration

// Integration tests against a real Idenplane instance — every other test in
// this package mocks HTTP via httptest.Server, so nothing has ever verified
// that UserService's requests actually match what the real admin API
// expects. Run with: go test -tags=integration ./...
//
// Environment variables:
//
//	IDENPLANE_URL             (default: http://localhost:3000)
//	IDENPLANE_ADMIN_USER      (default: admin)
//	IDENPLANE_ADMIN_PASSWORD  (default: e2e-test-admin-password)
package idenplane

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"testing"
	"time"
)

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// adminLogin exchanges the bootstrapped admin's username/password (see
// AdminSeedService on the server) for a bearer token, the same way the admin
// console itself authenticates — this is what AdminToken above is for.
func adminLogin(t *testing.T, baseURL, username, password string) string {
	t.Helper()

	body, _ := json.Marshal(map[string]string{"username": username, "password": password})
	resp, err := http.Post(baseURL+"/admin/auth/login", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("admin login request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("admin login returned %d", resp.StatusCode)
	}

	var parsed struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		t.Fatalf("decode admin login response: %v", err)
	}
	if parsed.AccessToken == "" {
		t.Fatal("admin login response had no access_token")
	}
	return parsed.AccessToken
}

// createRealm creates a realm directly over the admin REST API — realm
// management isn't part of this SDK yet, so this is plain net/http.
func createRealm(t *testing.T, baseURL, adminToken, name string) {
	t.Helper()

	body, _ := json.Marshal(map[string]string{"name": name})
	req, _ := http.NewRequest(http.MethodPost, baseURL+"/admin/realms", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+adminToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("create realm request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		t.Fatalf("create realm returned %d", resp.StatusCode)
	}
}

func requireLiveServer(t *testing.T, baseURL string) {
	t.Helper()
	client := http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(baseURL + "/health")
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Skipf("no Idenplane instance reachable at %s — start one and set IDENPLANE_URL (%v)", baseURL, err)
	}
	resp.Body.Close()
}

func TestUserServiceAgainstLiveServer(t *testing.T) {
	baseURL := envOr("IDENPLANE_URL", "http://localhost:3000")
	requireLiveServer(t, baseURL)

	adminToken := adminLogin(t,
		baseURL,
		envOr("IDENPLANE_ADMIN_USER", "admin"),
		envOr("IDENPLANE_ADMIN_PASSWORD", "e2e-test-admin-password"),
	)

	realmName := fmt.Sprintf("go-sdk-it-%d", time.Now().UnixNano())
	createRealm(t, baseURL, adminToken, realmName)

	client := NewClient(Config{
		ServerURL:    baseURL,
		Realm:        realmName,
		ClientID:     "go-sdk-it",
		AdminToken:   adminToken,
		DiscoveryTTL: DefaultDiscoveryTTL,
		HTTPTimeout:  DefaultHTTPTimeout,
	})

	ctx := context.Background()

	created, err := client.Users.Create(ctx, CreateUserRequest{
		Username: "go-sdk-it-user",
		Email:    "go-sdk-it@example.com",
		Enabled:  true,
	})
	if err != nil {
		t.Fatalf("Users.Create: %v", err)
	}
	if created.ID == "" {
		t.Fatal("Users.Create returned a user with no ID")
	}
	if created.Username != "go-sdk-it-user" {
		t.Fatalf("expected username go-sdk-it-user, got %q", created.Username)
	}

	fetched, err := client.Users.Get(ctx, created.ID)
	if err != nil {
		t.Fatalf("Users.Get: %v", err)
	}
	if fetched.Email != "go-sdk-it@example.com" {
		t.Fatalf("expected email go-sdk-it@example.com, got %q", fetched.Email)
	}

	users, total, err := client.Users.List(ctx, ListUsersParams{Username: "go-sdk-it-user"})
	if err != nil {
		t.Fatalf("Users.List: %v", err)
	}
	if total < 1 || len(users) < 1 {
		t.Fatalf("expected at least 1 user in list, got total=%d len=%d", total, len(users))
	}

	if err := client.Users.Delete(ctx, created.ID); err != nil {
		t.Fatalf("Users.Delete: %v", err)
	}

	if _, err := client.Users.Get(ctx, created.ID); err == nil {
		t.Fatal("expected Users.Get to fail after deletion, got no error")
	}
}
