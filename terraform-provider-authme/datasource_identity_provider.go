// Package provider implements the Terraform provider for AuthMe
package provider

import (
	"context"
	"fmt"

	"github.com/authme/terraform-provider-authme/client"
	"github.com/hashicorp/terraform-plugin-framework/attr"
	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/datasource/schema"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/hashicorp/terraform-plugin-log/tflog"
)

// Ensure the implementation satisfies the expected interfaces
var (
	_ datasource.DataSource = &IdentityProviderDataSource{}
)

// IdentityProviderDataSource implements the identity provider data source
type IdentityProviderDataSource struct {
	// httpClient is the internal HTTP client
	httpClient *client.HTTPClient
}

// IdentityProviderDataSourceModel represents the Terraform model for identity provider data source
type IdentityProviderDataSourceModel struct {
	ID                          types.String `tfsdk:"id"`
	RealmID                     types.String `tfsdk:"realm_id"`
	Alias                       types.String `tfsdk:"alias"`
	DisplayName                 types.String `tfsdk:"display_name"`
	Enabled                     types.Bool   `tfsdk:"enabled"`
	ProviderID                  types.String `tfsdk:"provider_id"`
	FirstBrokerLoginFlowAlias   types.String `tfsdk:"first_broker_login_flow_alias"`
	PostBrokerLoginFlowAlias    types.String `tfsdk:"post_broker_login_flow_alias"`
	InternalID                  types.String `tfsdk:"internal_id"`
	TrustEmail                  types.Bool   `tfsdk:"trust_email"`
	StoreToken                  types.Bool   `tfsdk:"store_token"`
	ReadOnly                    types.Bool   `tfsdk:"read_only"`
	AddReadTokenRoleOnCreate    types.Bool   `tfsdk:"add_read_token_role_on_create"`
	SyncMode                    types.String `tfsdk:"sync_mode"`
	Discoverable               types.Bool   `tfsdk:"discoverable"`
	SamlMetadataURL             types.String `tfsdk:"saml_metadata_url"`
	SamlMetadata                types.String `tfsdk:"saml_metadata"`
	WantAssertionsSigned        types.Bool   `tfsdk:"want_assertions_signed"`
	OidcMetadataURL             types.String `tfsdk:"oidc_metadata_url"`
	ClientID                    types.String `tfsdk:"client_id"`
	HideOnLoginPage             types.Bool   `tfsdk:"hide_on_login_page"`
	CreatedAt                   types.String `tfsdk:"created_at"`
	UpdatedAt                   types.String `tfsdk:"updated_at"`
}

// MapperModel represents a simplified mapper model for identity provider mappers
type MapperModel struct {
	ID                          types.String `tfsdk:"id"`
	Name                        types.String `tfsdk:"name"`
	IdentityProviderAlias       types.String `tfsdk:"identity_provider_alias"`
	IdentityProviderMapperType  types.String `tfsdk:"identity_provider_mapper_type"`
}

// NewIdentityProviderDataSource creates a new identity provider data source
func NewIdentityProviderDataSource() datasource.DataSource {
	return &IdentityProviderDataSource{}
}

// Metadata returns the data source metadata (name)
func (d *IdentityProviderDataSource) Metadata(ctx context.Context, req datasource.MetadataRequest, resp *datasource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_identity_provider"
}

// Schema returns the data source schema
func (d *IdentityProviderDataSource) Schema(ctx context.Context, req datasource.SchemaRequest, resp *datasource.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "Provides information about an AuthMe identity provider. This data source allows you to " +
			"read existing identity providers without managing them as Terraform resources.",

		Attributes: map[string]schema.Attribute{
			"id": schema.StringAttribute{
				MarkdownDescription: "Unique identifier for the identity provider",
				Computed:             true,
			},
			"realm_id": schema.StringAttribute{
				MarkdownDescription: "The realm ID this identity provider belongs to",
				Required:             true,
			},
			"alias": schema.StringAttribute{
				MarkdownDescription: "The identity provider alias (unique identifier)",
				Required:             true,
			},
			"display_name": schema.StringAttribute{
				MarkdownDescription: "Display name of the identity provider",
				Computed:             true,
			},
			"enabled": schema.BoolAttribute{
				MarkdownDescription: "Whether the identity provider is enabled",
				Computed:             true,
			},
			"provider_id": schema.StringAttribute{
				MarkdownDescription: "The identity provider type (e.g., oidc, saml)",
				Computed:             true,
			},
			"first_broker_login_flow_alias": schema.StringAttribute{
				MarkdownDescription: "First broker login flow alias",
				Computed:             true,
			},
			"post_broker_login_flow_alias": schema.StringAttribute{
				MarkdownDescription: "Post broker login flow alias",
				Computed:             true,
			},
			"internal_id": schema.StringAttribute{
				MarkdownDescription: "Internal ID of the identity provider",
				Computed:             true,
			},
			"trust_email": schema.BoolAttribute{
				MarkdownDescription: "Whether to trust email addresses from this provider",
				Computed:             true,
			},
			"store_token": schema.BoolAttribute{
				MarkdownDescription: "Whether to store tokens from this provider",
				Computed:             true,
			},
			"read_only": schema.BoolAttribute{
				MarkdownDescription: "Whether the identity provider is read-only",
				Computed:             true,
			},
			"add_read_token_role_on_create": schema.BoolAttribute{
				MarkdownDescription: "Whether to add read token role on create",
				Computed:             true,
			},
			"sync_mode": schema.StringAttribute{
				MarkdownDescription: "Sync mode (IMPORT, LEGACY, FORCED)",
				Computed:             true,
			},
			"discoverable": schema.BoolAttribute{
				MarkdownDescription: "Whether the identity provider is discoverable",
				Computed:             true,
			},
			"saml_metadata_url": schema.StringAttribute{
				MarkdownDescription: "SAML metadata URL",
				Computed:             true,
			},
			"saml_metadata": schema.StringAttribute{
				MarkdownDescription: "SAML metadata XML",
				Computed:             true,
			},
			"want_assertions_signed": schema.BoolAttribute{
				MarkdownDescription: "Whether assertions should be signed",
				Computed:             true,
			},
			"oidc_metadata_url": schema.StringAttribute{
				MarkdownDescription: "OIDC metadata URL",
				Computed:             true,
			},
			"client_id": schema.StringAttribute{
				MarkdownDescription: "Client ID for OIDC provider",
				Computed:             true,
			},
			"hide_on_login_page": schema.BoolAttribute{
				MarkdownDescription: "Whether to hide this provider on login page",
				Computed:             true,
			},
			"created_at": schema.StringAttribute{
				MarkdownDescription: "Creation timestamp",
				Computed:             true,
			},
			"updated_at": schema.StringAttribute{
				MarkdownDescription: "Last update timestamp",
				Computed:             true,
			},
		},
	}
}

// Configure configures the data source
func (d *IdentityProviderDataSource) Configure(ctx context.Context, req datasource.ConfigureRequest, resp *datasource.ConfigureResponse) {
	// Retrieve provider config from terraform configuration
	if req.ProviderData == nil {
		return
	}

	// Type assert to get the HTTP client
	httpClient, ok := req.ProviderData.(*client.HTTPClient)
	if !ok {
		resp.Diagnostics.AddError(
			"Unexpected Data Source Configure Type",
			fmt.Sprintf("Expected *client.HTTPClient, got: %T", req.ProviderData),
		)
		return
	}

	d.httpClient = httpClient
}

// Read reads the identity provider data from the AuthMe API
func (d *IdentityProviderDataSource) Read(ctx context.Context, req datasource.ReadRequest, resp *datasource.ReadResponse) {
	tflog.Debug(ctx, "Reading identity provider data source")

	// Get the alias and realm from the config
	var config IdentityProviderDataSourceModel
	resp.Diagnostics.Append(req.Config.Get(ctx, &config)...)
	if resp.Diagnostics.HasError() {
		return
	}

	alias := config.Alias.ValueString()
	if alias == "" {
		resp.Diagnostics.AddError(
			"Invalid Configuration",
			"Identity provider alias is required",
		)
		return
	}

	realmName := config.RealmID.ValueString()
	if realmName == "" {
		resp.Diagnostics.AddError(
			"Invalid Configuration",
			"Realm ID is required to look up an identity provider",
		)
		return
	}

	// Create the identity providers client
	idpClient := client.NewIdentityProvidersClient(d.httpClient)

	// Fetch the identity provider from the API
	idp, err := idpClient.GetIdentityProvider(ctx, realmName, alias)
	if err != nil {
		resp.Diagnostics.AddError(
			"Error Reading Identity Provider",
			fmt.Sprintf("Unable to read identity provider %s: %v", alias, err),
		)
		return
	}

	// Map the identity provider response to the Terraform model
	var state IdentityProviderDataSourceModel
	state.ID = types.StringValue(idp.ID)
	state.RealmID = types.StringValue(realmName)
	state.Alias = types.StringValue(idp.Alias)
	state.DisplayName = types.StringValue(idp.DisplayName)
	state.Enabled = types.BoolValue(idp.Enabled)
	state.ProviderID = types.StringValue(idp.ProviderID)
	state.FirstBrokerLoginFlowAlias = types.StringValue(idp.FirstBrokerLoginFlowAlias)
	state.PostBrokerLoginFlowAlias = types.StringValue(idp.PostBrokerLoginFlowAlias)
	state.InternalID = types.StringValue(idp.InternalID)
	state.TrustEmail = types.BoolValue(idp.TrustEmail)
	state.StoreToken = types.BoolValue(idp.StoreToken)
	state.ReadOnly = types.BoolValue(idp.ReadOnly)
	state.AddReadTokenRoleOnCreate = types.BoolValue(idp.AddReadTokenRoleOnCreate)
	state.SyncMode = types.StringValue(idp.SyncMode)
	state.Discoverable = types.BoolValue(idp.Discoverable)
	state.SamlMetadataURL = types.StringValue(idp.SamlMetadataURL)
	state.SamlMetadata = types.StringValue(idp.SamlMetadata)
	state.WantAssertionsSigned = types.BoolValue(idp.WantAssertionsSigned)
	state.OidcMetadataURL = types.StringValue(idp.OidcMetadataURL)
	state.ClientID = types.StringValue(idp.ClientID)
	state.HideOnLoginPage = types.BoolValue(idp.HideOnLoginPage)
	state.CreatedAt = types.StringValue(idp.CreatedAt)
	state.UpdatedAt = types.StringValue(idp.UpdatedAt)

	// Set the state
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	tflog.Debug(ctx, "Identity provider data source read successfully")
}
