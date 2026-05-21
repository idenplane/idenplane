package idenplane

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"
)

// OpenIDConfiguration is the OIDC discovery document.
// Fetched from {ServerURL}/realms/{Realm}/.well-known/openid-configuration.
type OpenIDConfiguration struct {
	Issuer                string `json:"issuer"`
	AuthorizationEndpoint string `json:"authorization_endpoint"`
	TokenEndpoint         string `json:"token_endpoint"`
	UserinfoEndpoint      string `json:"userinfo_endpoint,omitempty"`
	JwksURI               string `json:"jwks_uri"`
	EndSessionEndpoint    string `json:"end_session_endpoint,omitempty"`
	RevocationEndpoint    string `json:"revocation_endpoint,omitempty"`
	IntrospectionEndpoint string `json:"introspection_endpoint,omitempty"`
}

// DiscoveryCache caches the OIDC discovery document with a TTL.
// Safe for concurrent use.
type DiscoveryCache struct {
	mu        sync.RWMutex
	config    *OpenIDConfiguration
	expiresAt time.Time
	ttl       time.Duration
}

// Get returns the cached configuration if it has not expired, otherwise nil.
func (c *DiscoveryCache) Get() *OpenIDConfiguration {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.config == nil || time.Now().After(c.expiresAt) {
		return nil
	}
	return c.config
}

// Set stores the configuration and resets the TTL window.
func (c *DiscoveryCache) Set(config *OpenIDConfiguration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.config = config
	c.expiresAt = time.Now().Add(c.ttl)
}

// Invalidate clears the cache.
func (c *DiscoveryCache) Invalidate() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.config = nil
	c.expiresAt = time.Time{}
}

// IsValid reports whether a non-expired entry is present.
func (c *DiscoveryCache) IsValid() bool {
	return c.Get() != nil
}

// DiscoveryClient fetches and caches the OIDC discovery document.
type DiscoveryClient struct {
	config Config
	cache  *DiscoveryCache
}

// NewDiscoveryClient builds a DiscoveryClient for the given Idenplane config.
func NewDiscoveryClient(config Config) *DiscoveryClient {
	ttl := config.DiscoveryTTL
	if ttl <= 0 {
		ttl = DefaultDiscoveryTTL
	}
	return &DiscoveryClient{
		config: config,
		cache:  &DiscoveryCache{ttl: ttl},
	}
}

// DiscoveryURL returns the discovery document URL for the configured realm.
func (d *DiscoveryClient) DiscoveryURL() string {
	return d.config.discoveryURL()
}

// Get returns the cached configuration or fetches it if the cache is empty or expired.
func (d *DiscoveryClient) Get(ctx context.Context) (*OpenIDConfiguration, error) {
	if cached := d.cache.Get(); cached != nil {
		return cached, nil
	}
	return d.fetch(ctx)
}

// Refresh forces a network fetch and updates the cache.
func (d *DiscoveryClient) Refresh(ctx context.Context) (*OpenIDConfiguration, error) {
	return d.fetch(ctx)
}

// GetCached returns the currently cached configuration without forcing a fetch.
func (d *DiscoveryClient) GetCached() *OpenIDConfiguration {
	return d.cache.Get()
}

func (d *DiscoveryClient) fetch(ctx context.Context) (*OpenIDConfiguration, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, d.DiscoveryURL(), nil)
	if err != nil {
		return nil, ErrDiscoveryFailed(err.Error())
	}
	req.Header.Set("Accept", "application/json")

	resp, err := d.config.httpClient().Do(req)
	if err != nil {
		return nil, ErrNetworkError("discovery fetch failed", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, ErrDiscoveryFailed(fmt.Sprintf("server returned status %d", resp.StatusCode))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, ErrNetworkError("read discovery body", err)
	}

	var cfg OpenIDConfiguration
	if err := json.Unmarshal(body, &cfg); err != nil {
		return nil, ErrDiscoveryFailed("invalid JSON: " + err.Error())
	}
	d.cache.Set(&cfg)
	return &cfg, nil
}
