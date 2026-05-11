package provider

import (
	"testing"

	"github.com/pulumi/pulumi/sdk/v3/go/common/tokens"
)

// TestProviderInfo verifies the provider info structure is correctly configured.
func TestProviderInfo(t *testing.T) {
	info := ProviderInfo()

	// Verify provider name
	if info.Name != tokens.Package("authme") {
		t.Errorf("Expected provider name 'authme', got %v", info.Name)
	}

	// Verify description
	if info.Description == "" {
		t.Error("Provider description should not be empty")
	}

	// Verify version
	if info.Version == "" {
		t.Error("Provider version should not be empty")
	}
}

// TestProviderResources verifies all expected resources are mapped.
func TestProviderResources(t *testing.T) {
	info := ProviderInfo()

	expectedResources := []string{
		"authme_realm",
		"authme_client",
		"authme_role",
		"authme_group",
		"authme_organization",
		"authme_identity_provider",
	}

	for _, resourceName := range expectedResources {
		resourceInfo, ok := info.Resources[resourceName]
		if !ok {
			t.Errorf("Expected Resources map to have %q", resourceName)
			continue
		}

		// Verify resource has a valid token
		if resourceInfo.Tok == "" {
			t.Errorf("Resource %q should have a valid token", resourceName)
		}
	}
}

// TestProviderDataSources verifies all expected data sources are mapped.
func TestProviderDataSources(t *testing.T) {
	info := ProviderInfo()

	expectedDataSources := []string{
		"authme_realm",
		"authme_client",
		"authme_role",
		"authme_group",
		"authme_organization",
		"authme_identity_provider",
	}

	for _, dsName := range expectedDataSources {
		dsInfo, ok := info.DataSources[dsName]
		if !ok {
			t.Errorf("Expected DataSources map to have %q", dsName)
			continue
		}

		// Verify data source has a valid token
		if dsInfo.Tok == "" {
			t.Errorf("Data source %q should have a valid token", dsName)
		}
	}
}

// TestResourceTokens verifies all resource tokens are correctly formatted.
func TestResourceTokens(t *testing.T) {
	info := ProviderInfo()

	expectedTokens := map[string]tokens.Resource{
		"authme_realm":              makeResource("index", "Realm"),
		"authme_client":             makeResource("index", "Client"),
		"authme_role":               makeResource("index", "Role"),
		"authme_group":             makeResource("index", "Group"),
		"authme_organization":      makeResource("index", "Organization"),
		"authme_identity_provider": makeResource("index", "IdentityProvider"),
	}

	for resourceName, expectedTok := range expectedTokens {
		resourceInfo, ok := info.Resources[resourceName]
		if !ok {
			t.Errorf("Resource %q not found in Resources map", resourceName)
			continue
		}

		if resourceInfo.Tok != expectedTok {
			t.Errorf("Resource %q token = %v, want %v", resourceName, resourceInfo.Tok, expectedTok)
		}
	}
}

// TestDataSourceTokens verifies all data source tokens are correctly formatted.
func TestDataSourceTokens(t *testing.T) {
	info := ProviderInfo()

	expectedTokens := map[string]tokens.DataSource{
		"authme_realm":              makeDataSource("index", "getRealm"),
		"authme_client":             makeDataSource("index", "getClient"),
		"authme_role":               makeDataSource("index", "getRole"),
		"authme_group":             makeDataSource("index", "getGroup"),
		"authme_organization":       makeDataSource("index", "getOrganization"),
		"authme_identity_provider": makeDataSource("index", "getIdentityProvider"),
	}

	for dsName, expectedTok := range expectedTokens {
		dsInfo, ok := info.DataSources[dsName]
		if !ok {
			t.Errorf("Data source %q not found in DataSources map", dsName)
			continue
		}

		if dsInfo.Tok != expectedTok {
			t.Errorf("Data source %q token = %v, want %v", dsName, dsInfo.Tok, expectedTok)
		}
	}
}

// TestMakeResource verifies makeResource creates correct tokens.
func TestMakeResource(t *testing.T) {
	tok := makeResource("index", "Realm")
	expected := tokens.NewResource("authme", "index", "Realm")
	if tok != expected {
		t.Errorf("makeResource returned %v, want %v", tok, expected)
	}
}

// TestMakeDataSource verifies makeDataSource creates correct tokens.
func TestMakeDataSource(t *testing.T) {
	tok := makeDataSource("index", "getRealm")
	expected := tokens.NewDataSource("authme", "index", "getRealm")
	if tok != expected {
		t.Errorf("makeDataSource returned %v, want %v", tok, expected)
	}
}