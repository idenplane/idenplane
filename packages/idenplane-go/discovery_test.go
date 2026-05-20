package idenplane

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

// TestDiscoveryCacheTTL tests TTL-based caching behavior
func TestDiscoveryCacheTTL(t *testing.T) {
	// Create a cache with short TTL for testing
	cache := &DiscoveryCache{
		ttl: 100 * time.Millisecond,
	}

	// Initially cache should be empty
	if cached := cache.Get(); cached != nil {
		t.Error("Expected nil cache initially")
	}

	// Set some config
	config := &OpenIDConfiguration{
		Issuer:                "https://auth.example.com",
		AuthorizationEndpoint: "https://auth.example.com/authorize",
		TokenEndpoint:         "https://auth.example.com/token",
	}
	cache.Set(config)

	// Should be valid immediately after set
	if cached := cache.Get(); cached == nil {
		t.Error("Expected config to be cached")
	}

	// Wait for TTL to expire
	time.Sleep(150 * time.Millisecond)

	// Should be expired now
	if cached := cache.Get(); cached != nil {
		t.Error("Expected nil cache after TTL expiration")
	}
}

// TestDiscoveryCacheConcurrency tests thread safety
func TestDiscoveryCacheConcurrency(t *testing.T) {
	cache := &DiscoveryCache{
		ttl: time.Hour,
	}

	config := &OpenIDConfiguration{
		Issuer:                "https://auth.example.com",
		AuthorizationEndpoint: "https://auth.example.com/authorize",
		TokenEndpoint:         "https://auth.example.com/token",
	}

	var wg sync.WaitGroup
	numGoroutines := 100

	// Concurrent reads
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			cache.Get()
		}()
	}

	// Concurrent writes
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			cfg := &OpenIDConfiguration{
				Issuer: "https://auth.example.com",
			}
			cache.Set(cfg)
		}(i)
	}

	wg.Wait()
}

// TestDiscoveryCacheInvalidate tests cache invalidation
func TestDiscoveryCacheInvalidate(t *testing.T) {
	cache := &DiscoveryCache{
		ttl: time.Hour,
	}

	config := &OpenIDConfiguration{
		Issuer:                "https://auth.example.com",
		AuthorizationEndpoint: "https://auth.example.com/authorize",
		TokenEndpoint:         "https://auth.example.com/token",
	}
	cache.Set(config)

	// Should be valid
	if cached := cache.Get(); cached == nil {
		t.Error("Expected config to be cached")
	}

	// Invalidate
	cache.Invalidate()

	// Should be nil
	if cached := cache.Get(); cached != nil {
		t.Error("Expected nil after invalidation")
	}

	// IsValid should return false
	if cache.IsValid() {
		t.Error("Expected IsValid to return false after invalidation")
	}
}

// TestDiscoveryCacheIsValid tests IsValid method
func TestDiscoveryCacheIsValid(t *testing.T) {
	cache := &DiscoveryCache{
		ttl: time.Hour,
	}

	// Should be invalid when empty
	if cache.IsValid() {
		t.Error("Expected IsValid to return false for empty cache")
	}

	config := &OpenIDConfiguration{
		Issuer:                "https://auth.example.com",
		AuthorizationEndpoint: "https://auth.example.com/authorize",
		TokenEndpoint:         "https://auth.example.com/token",
	}
	cache.Set(config)

	// Should be valid
	if !cache.IsValid() {
		t.Error("Expected IsValid to return true after Set")
	}

	// Create cache with very short TTL
	shortCache := &DiscoveryCache{
		ttl: 1 * time.Millisecond,
	}
	shortCache.Set(config)

	// Wait for expiration
	time.Sleep(10 * time.Millisecond)

	// Should be invalid
	if shortCache.IsValid() {
		t.Error("Expected IsValid to return false after TTL expiration")
	}
}

// mockDiscoveryServer creates a mock OIDC discovery server
func mockDiscoveryServer(handler func(w http.ResponseWriter, r *http.Request)) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(handler))
}

// TestDiscoveryClientGet tests fetching discovery document
func TestDiscoveryClientGet(t *testing.T) {
	server := mockDiscoveryServer(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/.well-known/openid-configuration" {
			t.Errorf("Expected path /.well-known/openid-configuration, got %s", r.URL.Path)
		}
		if r.Header.Get("Accept") != "application/json" {
			t.Errorf("Expected Accept: application/json header")
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"issuer":                 "https://auth.example.com",
			"authorization_endpoint": "https://auth.example.com/authorize",
			"token_endpoint":         "https://auth.example.com/token",
			"jwks_uri":               "https://auth.example.com/jwks",
		})
	})
	defer server.Close()

	config := Config{
		ServerURL: server.URL,
		Realm:     "test-realm",
		ClientID:  "test-client",
	}

	client := NewDiscoveryClient(config)

	// First fetch
	oidc, err := client.Get(context.Background())
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}

	if oidc.Issuer != "https://auth.example.com" {
		t.Errorf("Expected issuer https://auth.example.com, got %s", oidc.Issuer)
	}

	if oidc.AuthorizationEndpoint != "https://auth.example.com/authorize" {
		t.Errorf("Expected authorization_endpoint, got %s", oidc.AuthorizationEndpoint)
	}

	// Second call should use cache (no additional server request needed)
	cached, err := client.Get(context.Background())
	if err != nil {
		t.Fatalf("Cached Get failed: %v", err)
	}

	if cached.Issuer != oidc.Issuer {
		t.Error("Cached result differs from original")
	}
}

// TestDiscoveryClientCacheExpiry tests cache expiry behavior
func TestDiscoveryClientCacheExpiry(t *testing.T) {
	requestCount := 0
	server := mockDiscoveryServer(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"issuer":                 "https://auth.example.com",
			"authorization_endpoint": "https://auth.example.com/authorize",
			"token_endpoint":         "https://auth.example.com/token",
			"jwks_uri":               "https://auth.example.com/jwks",
		})
	})
	defer server.Close()

	config := Config{
		ServerURL:    server.URL,
		Realm:        "test-realm",
		ClientID:     "test-client",
		DiscoveryTTL: 50 * time.Millisecond, // Short TTL for testing
	}

	client := NewDiscoveryClient(config)

	// First request
	_, err := client.Get(context.Background())
	if err != nil {
		t.Fatalf("First Get failed: %v", err)
	}

	if requestCount != 1 {
		t.Errorf("Expected 1 request, got %d", requestCount)
	}

	// Cache should be used
	_, err = client.Get(context.Background())
	if err != nil {
		t.Fatalf("Second Get failed: %v", err)
	}

	// Still cached, no new request
	if requestCount != 1 {
		t.Errorf("Expected 1 request (from cache), got %d", requestCount)
	}

	// Wait for TTL to expire
	time.Sleep(100 * time.Millisecond)

	// Should trigger new request
	_, err = client.Get(context.Background())
	if err != nil {
		t.Fatalf("Third Get after expiry failed: %v", err)
	}

	if requestCount != 2 {
		t.Errorf("Expected 2 requests after TTL expiry, got %d", requestCount)
	}
}

// TestDiscoveryClientRefresh tests manual cache refresh
func TestDiscoveryClientRefresh(t *testing.T) {
	requestCount := 0
	server := mockDiscoveryServer(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"issuer":                 "https://auth.example.com",
			"authorization_endpoint": "https://auth.example.com/authorize",
			"token_endpoint":         "https://auth.example.com/token",
			"jwks_uri":               "https://auth.example.com/jwks",
		})
	})
	defer server.Close()

	config := Config{
		ServerURL:    server.URL,
		Realm:        "test-realm",
		ClientID:     "test-client",
		DiscoveryTTL: time.Hour,
	}

	client := NewDiscoveryClient(config)

	// Initial fetch
	_, err := client.Get(context.Background())
	if err != nil {
		t.Fatalf("First Get failed: %v", err)
	}

	if requestCount != 1 {
		t.Errorf("Expected 1 request, got %d", requestCount)
	}

	// Refresh should trigger new request
	_, err = client.Refresh(context.Background())
	if err != nil {
		t.Fatalf("Refresh failed: %v", err)
	}

	if requestCount != 2 {
		t.Errorf("Expected 2 requests after refresh, got %d", requestCount)
	}

	// GetCached should return config
	cached := client.GetCached()
	if cached == nil {
		t.Error("Expected GetCached to return config")
	}
	if cached.Issuer != "https://auth.example.com" {
		t.Errorf("Expected issuer, got %s", cached.Issuer)
	}
}

// TestDiscoveryClientDiscoveryURL tests DiscoveryURL method
func TestDiscoveryClientDiscoveryURL(t *testing.T) {
	config := Config{
		ServerURL: "https://auth.example.com",
		Realm:     "test-realm",
		ClientID:  "test-client",
	}

	client := NewDiscoveryClient(config)

	expectedURL := "https://auth.example.com/realms/test-realm/.well-known/openid-configuration"
	if url := client.DiscoveryURL(); url != expectedURL {
		t.Errorf("Expected %s, got %s", expectedURL, url)
	}
}

// TestDiscoveryClientNetworkError tests handling of network errors
func TestDiscoveryClientNetworkError(t *testing.T) {
	server := mockDiscoveryServer(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	})
	server.Close()

	config := Config{
		ServerURL: server.URL,
		Realm:     "test-realm",
		ClientID:  "test-client",
	}

	client := NewDiscoveryClient(config)

	_, err := client.Get(context.Background())
	if err == nil {
		t.Error("Expected error for server error response")
	}
}

// TestDiscoveryClientInvalidResponse tests handling of invalid JSON
func TestDiscoveryClientInvalidResponse(t *testing.T) {
	server := mockDiscoveryServer(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("invalid json"))
	})
	defer server.Close()

	config := Config{
		ServerURL: server.URL,
		Realm:     "test-realm",
		ClientID:  "test-client",
	}

	client := NewDiscoveryClient(config)

	_, err := client.Get(context.Background())
	if err == nil {
		t.Error("Expected error for invalid JSON")
	}
}