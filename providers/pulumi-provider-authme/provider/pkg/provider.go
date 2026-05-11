// Pulumi provider for AuthMe - Provider package
// pkg/provider.go - Provider definition and resource mappings
package provider

import (
	"github.com/authme/terraform-provider-authme/provider"
	tfbridge "github.com/pulumi/pulumi-terraform-bridge/v3/pkg/tfbridge"
	"github.com/pulumi/pulumi/sdk/v3/go/common/tokens"
)

// ProviderName is the name of this provider.
const ProviderName = "authme"

// ProviderInfo returns the Pulumi provider info for AuthMe.
func ProviderInfo() tfbridge.ProviderInfo {
	return tfbridge.ProviderInfo{
		P:           provider.Provider(),
		Name:        tokens.Package(ProviderName),
		Description: "A Pulumi provider for AuthMe identity and access management",
		Keywords:    []string{"pulumi", "authme", "iam", "identity", "access-management"},
		Homepage:    "https://authme.io",
		Repository:  "https://github.com/authme/pulumi-provider-authme",
		Version:     "0.1.0",
		Publisher:   "AuthMe",
		// Resources maps Terraform resources to Pulumi resources.
		Resources: map[string]tfbridge.ResourceInfo{
			// Realm resource
			"authme_realm": {
				Tok: makeResource("index", "Realm"),
			},
			// Client resource
			"authme_client": {
				Tok: makeResource("index", "Client"),
			},
			// Role resource
			"authme_role": {
				Tok: makeResource("index", "Role"),
			},
			// Group resource
			"authme_group": {
				Tok: makeResource("index", "Group"),
			},
			// Organization resource
			"authme_organization": {
				Tok: makeResource("index", "Organization"),
			},
			// IdentityProvider resource
			"authme_identity_provider": {
				Tok: makeResource("index", "IdentityProvider"),
			},
		},
		// DataSources maps Terraform data sources to Pulumi data sources.
		DataSources: map[string]tfbridge.DataSourceInfo{
			// Realm data source
			"authme_realm": {
				Tok: makeDataSource("index", "getRealm"),
			},
			// Client data source
			"authme_client": {
				Tok: makeDataSource("index", "getClient"),
			},
			// Role data source
			"authme_role": {
				Tok: makeDataSource("index", "getRole"),
			},
			// Group data source
			"authme_group": {
				Tok: makeDataSource("index", "getGroup"),
			},
			// Organization data source
			"authme_organization": {
				Tok: makeDataSource("index", "getOrganization"),
			},
			// IdentityProvider data source
			"authme_identity_provider": {
				Tok: makeDataSource("index", "getIdentityProvider"),
			},
		},
	}
}

// makeResource creates a fully-qualified resource token.
func makeResource(module, name string) tokens.Resource {
	return tokens.NewResource(ProviderName, module, name)
}

// makeDataSource creates a fully-qualified data source token.
func makeDataSource(module, name string) tokens.DataSource {
	return tokens.NewDataSource(ProviderName, module, name)
}
