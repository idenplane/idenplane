// Pulumi provider for Idenplane - Bridge package
// internal/bridge.go - Terraform bridge implementation
package bridge

import (
	"github.com/pulumi/pulumi-terraform-bridge/v3/pkg/tfbridge"
	"github.com/pulumi/pulumi/sdk/v3/go/common/tokens"
)

// ProviderName is the name of this provider.
const ProviderName = "idenplane"

// Version is the current version of the provider.
const Version = "0.1.0"

// MakeResource creates a fully-qualified resource token.
func MakeResource(module, name string) tokens.Resource {
	return tokens.NewResource(ProviderName, module, name)
}

// MakeDataSource creates a fully-qualified data source token.
func MakeDataSource(module, name string) tokens.DataSource {
	return tokens.NewDataSource(ProviderName, module, name)
}

// Info returns bridge metadata for the provider.
func Info() tfbridge.ProviderInfo {
	return tfbridge.ProviderInfo{
		Name:        tokens.Package(ProviderName),
		Description: "A Pulumi provider for Idenplane identity and access management",
		Keywords:    []string{"pulumi", "idenplane", "iam", "identity", "access-management"},
		Homepage:    "https://idenplane.io",
		Repository:  "https://github.com/idenplane/pulumi-provider-idenplane",
		Version:     Version,
		Publisher:   "Idenplane",
	}
}