// Pulumi provider for Idenplane - Provider package
// pkg/provider.go - Provider definition and resource mappings
package provider

import (
	"github.com/idenplane/terraform-provider-idenplane/provider"
	tfbridge "github.com/pulumi/pulumi-terraform-bridge/v3/pkg/tfbridge"
	"github.com/pulumi/pulumi/sdk/v3/go/common/tokens"
)

// ProviderName is the name of this provider.
const ProviderName = "idenplane"

// ProviderInfo returns the Pulumi provider info for Idenplane.
func ProviderInfo() tfbridge.ProviderInfo {
	return tfbridge.ProviderInfo{
		P:           provider.Provider(),
		Name:        tokens.Package(ProviderName),
		Description: "A Pulumi provider for Idenplane identity and access management",
		Keywords:    []string{"pulumi", "idenplane", "iam", "identity", "access-management"},
		Homepage:    "https://idenplane.io",
		Repository:  "https://github.com/idenplane/pulumi-provider-idenplane",
		Version:     "0.1.0",
		Publisher:   "Idenplane",
		// Resources maps Terraform resources to Pulumi resources.
		Resources: map[string]tfbridge.ResourceInfo{
			// Realm resource
			"idenplane_realm": {
				Tok: makeResource("index", "Realm"),
			},
			// Client resource
			"idenplane_client": {
				Tok: makeResource("index", "Client"),
			},
			// Role resource
			"idenplane_role": {
				Tok: makeResource("index", "Role"),
			},
			// Group resource
			"idenplane_group": {
				Tok: makeResource("index", "Group"),
			},
			// Organization resource
			"idenplane_organization": {
				Tok: makeResource("index", "Organization"),
			},
			// IdentityProvider resource
			"idenplane_identity_provider": {
				Tok: makeResource("index", "IdentityProvider"),
			},
		},
		// DataSources maps Terraform data sources to Pulumi data sources.
		DataSources: map[string]tfbridge.DataSourceInfo{
			// Realm data source
			"idenplane_realm": {
				Tok: makeDataSource("index", "getRealm"),
			},
			// Client data source
			"idenplane_client": {
				Tok: makeDataSource("index", "getClient"),
			},
			// Role data source
			"idenplane_role": {
				Tok: makeDataSource("index", "getRole"),
			},
			// Group data source
			"idenplane_group": {
				Tok: makeDataSource("index", "getGroup"),
			},
			// Organization data source
			"idenplane_organization": {
				Tok: makeDataSource("index", "getOrganization"),
			},
			// IdentityProvider data source
			"idenplane_identity_provider": {
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
