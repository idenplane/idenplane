// Package provider implements the Terraform provider for AuthMe
package provider

import (
	"context"
	"os"
	"time"

	"github.com/authme/terraform-provider-authme/client"
	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/function"
	"github.com/hashicorp/terraform-plugin-framework/provider"
	"github.com/hashicorp/terraform-plugin-framework/provider/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/hashicorp/terraform-plugin-log/tflog"
)

// Ensure the implementation satisfies the expected interfaces
var (
	_ provider.Provider = &AuthmeProvider{}
)

// AuthmeProvider satisfies the terraform-plugin-framework provider interface
type AuthmeProvider struct {
	// version is set during build via ldflags
	version string

	// httpClient is the AuthMe API HTTP client (nil until Configure is called)
	httpClient *client.HTTPClient
}

// ProviderConfigModel represents the provider configuration model
// This is used to parse the provider configuration from Terraform
type ProviderConfigModel struct {
	URL    types.String `tfsdk:"url" doc:"AuthMe Admin API URL"`
	APIKey types.String `tfsdk:"api_key" doc:"AuthMe Admin API key"`
}

// New creates a new provider instance
func New() provider.Provider {
	return &AuthmeProvider{
		version: os.Getenv("AUTHME_PROVIDER_VERSION"),
	}
}

// Metadata returns the provider metadata (name and version)
func (p *AuthmeProvider) Metadata(ctx context.Context, req provider.MetadataRequest, resp *provider.MetadataResponse) {
	resp.TypeName = "authme"
	resp.Version = p.version
}

// Schema returns the provider schema (configuration options)
func (p *AuthmeProvider) Schema(ctx context.Context, req provider.SchemaRequest, resp *provider.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "Terraform provider for AuthMe Identity and Access Management. " +
			"Manages realms, clients, roles, groups, users, identity providers, authentication flows, and organizations.",

		Attributes: map[string]schema.Attribute{
			"url": schema.StringAttribute{
				MarkdownDescription: "AuthMe Admin API URL (e.g., https://authme.example.com)",
				Required:            true,
			},
			"api_key": schema.StringAttribute{
				MarkdownDescription: "AuthMe Admin API key",
				Required:            true,
				Sensitive:           true,
			},
		},
	}
}

// Configure is called by Terraform to configure the provider
func (p *AuthmeProvider) Configure(ctx context.Context, req provider.ConfigureRequest) (interface{}, any) {
	tflog.Debug(ctx, "Configuring AuthMe provider")

	// Retrieve provider config from terraform configuration
	var config ProviderConfigModel
	respDiag := req.ProviderConfig.As(ctx, &config)
	if respDiag.HasError() {
		return nil, nil
	}

	// Create the AuthMe HTTP client
	httpClient := client.NewHTTPClient(client.HTTPClientConfig{
		ServerURL: config.URL.ValueString(),
		APIKey:    config.APIKey.ValueString(),
		Timeout:   30 * time.Second,
	})

	p.httpClient = httpClient
	tflog.Debug(ctx, "AuthMe provider configured successfully")

	return httpClient, nil
}

// Resources returns a slice of resource implementations
func (p *AuthmeProvider) Resources(ctx context.Context) []resource.Resource {
	return []resource.Resource{
		NewRealmResource(),
		NewClientResource(),
		NewRoleResource(),
		NewGroupResource(),
		NewUserResource(),
		NewIdentityProviderResource(),
		NewAuthFlowResource(),
	}
}

// DataSources returns a slice of data source implementations
func (p *AuthmeProvider) DataSources(ctx context.Context) []datasource.DataSource {
	return []datasource.DataSource{
		NewRealmDataSource(),
		NewClientDataSource(),
		NewRoleDataSource(),
		NewGroupDataSource(),
		NewUserDataSource(),
		NewIdentityProviderDataSource(),
		NewAuthFlowDataSource(),
		NewOrganizationDataSource(),
	}
}

// Functions returns a slice of function implementations
func (p *AuthmeProvider) Functions(ctx context.Context) []function.Function {
	return []function.Function{
		// Functions will be added in future phases
	}
}