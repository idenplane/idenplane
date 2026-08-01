package idenplane

import "testing"

func TestConfigValidateURLScheme(t *testing.T) {
	base := Config{Realm: "test", ClientID: "test-client"}

	t.Run("accepts https", func(t *testing.T) {
		c := base
		c.ServerURL = "https://auth.example.com"
		if err := c.Validate(); err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
	})

	t.Run("allows http for localhost", func(t *testing.T) {
		c := base
		c.ServerURL = "http://localhost:3000"
		if err := c.Validate(); err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
	})

	t.Run("allows http for loopback IP", func(t *testing.T) {
		c := base
		c.ServerURL = "http://127.0.0.1:3000"
		if err := c.Validate(); err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
	})

	t.Run("rejects http for a non-loopback host", func(t *testing.T) {
		c := base
		c.ServerURL = "http://auth.example.com"
		if err := c.Validate(); err == nil {
			t.Fatal("expected an error for insecure http://, got nil")
		}
	})

	t.Run("allows http for a non-loopback host with AllowInsecureHTTP", func(t *testing.T) {
		c := base
		c.ServerURL = "http://auth.example.com"
		c.AllowInsecureHTTP = true
		if err := c.Validate(); err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
	})

	t.Run("rejects a non-http(s) scheme", func(t *testing.T) {
		c := base
		c.ServerURL = "ftp://auth.example.com"
		if err := c.Validate(); err == nil {
			t.Fatal("expected an error for a non-http(s) scheme, got nil")
		}
	})
}
