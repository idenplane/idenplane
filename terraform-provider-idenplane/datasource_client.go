// Package provider implements the Terraform provider for Idenplane
package provider

import (
	"context"
	"fmt"

	"github.com/idenplane/terraform-provider-idenplane/client"
	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/datasource/schema"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/hashicorp/terraform-plugin-log/tflog"
)

// Ensure the implementation satisfies the expected interfaces
var (
	_ datasource.DataSource = &ClientDataSource{}
)

// ClientDataSource implements the client data source
type ClientDataSource struct {
	// httpClient is the internal HTTP client
	httpClient *client.HTTPClient
}

// ClientDataSourceModel represents the Terraform model for client data source
type ClientDataSourceModel struct {
	ID                            types.String   `tfsdk:"id"`
	RealmID                       types.String   `tfsdk:"realm_id"`
	ClientID                      types.String   `tfsdk:"client_id"`
	ClientType                    types.String   `tfsdk:"client_type"`
	Name                          types.String   `tfsdk:"name"`
	Description                   types.String   `tfsdk:"description"`
	Enabled                       types.Bool     `tfsdk:"enabled"`
	RedirectUris                  types.List     `tfsdk:"redirect_uris"`
	WebOrigins                    types.List     `tfsdk:"web_origins"`
	GrantTypes                    types.List     `tfsdk:"grant_types"`
	RequireConsent                types.Bool     `tfsdk:"require_consent"`
	BackchannelLogoutUri          types.String   `tfsdk:"backchannel_logout_uri"`
	BackchannelLogoutSessionRequired types.Bool `tfsdk:"backchannel_logout_session_required"`
	ServiceAccountUserID          types.String   `tfsdk:"service_account_user_id"`
	CreatedAt                     types.String   `tfsdk:"created_at"`
	UpdatedAt                     types.String   `tfsdk:"updated_at"`
}

// NewClientDataSource creates a new client data source
func NewClientDataSource() datasource.DataSource {
	return &ClientDataSource{}
}

// Metadata returns the data source metadata (name)
func (d *ClientDataSource) Metadata(ctx context.Context, req datasource.MetadataRequest, resp *datasource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_client"
}

// Schema returns the data source schema
func (d *ClientDataSource) Schema(ctx context.Context, req datasource.SchemaRequest, resp *datasource.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "Provides information about an Idenplane OAuth client. This data source allows you to " +
			"read existing clients without managing them as Terraform resources.",

		Attributes: map[string]schema.Attribute{
			"id": schema.StringAttribute{
				MarkdownDescription: "Unique identifier for the client (UUID)",
				Computed:             true,
			},
			"realm_id": schema.StringAttribute{
				MarkdownDescription: "The realm ID this client belongs to",
				Computed:             true,
			},
			"client_id": schema.StringAttribute{
				MarkdownDescription: "The OAuth client identifier (client_id)",
				Required:             true,
			},
			"client_type": schema.StringAttribute{
				MarkdownDescription: "Client type (CONFIDENTIAL or PUBLIC)",
				Computed:             true,
			},
			"name": schema.StringAttribute{
				MarkdownDescription: "Display name of the client",
				Computed:             true,
			},
			"description": schema.StringAttribute{
				MarkdownDescription: "Description of the client",
				Computed:             true,
			},
			"enabled": schema.BoolAttribute{
				MarkdownDescription: "Whether the client is enabled",
				Computed:             true,
			},
			"redirect_uris": schema.ListAttribute{
				MarkdownDescription: "List of valid redirect URIs",
				Computed:             true,
				ElementType:          types.StringType,
			},
			"web_origins": schema.ListAttribute{
				MarkdownDescription: "List of allowed web origins for CORS",
				Computed:             true,
				ElementType:          types.StringType,
			},
			"grant_types": schema.ListAttribute{
				MarkdownDescription: "List of allowed grant types",
				Computed:             true,
				ElementType:          types.StringType,
			},
			"require_consent": schema.BoolAttribute{
				MarkdownDescription: "Whether consent is required from users",
				Computed:             true,
			},
			"backchannel_logout_uri": schema.StringAttribute{
				MarkdownDescription: "Backchannel logout URI",
				Computed:             true,
			},
			"backchannel_logout_session_required": schema.BoolAttribute{
				MarkdownDescription: "Whether backchannel logout session is required",
				Computed:             true,
			},
			"service_account_user_id": schema.StringAttribute{
				MarkdownDescription: "Service account user ID (if client is a service account)",
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
func (d *ClientDataSource) Configure(ctx context.Context, req datasource.ConfigureRequest, resp *datasource.ConfigureResponse) {
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

// Read reads the client data from the Idenplane API
func (d *ClientDataSource) Read(ctx context.Context, req datasource.ReadRequest, resp *datasource.ReadResponse) {
	tflog.Debug(ctx, "Reading client data source")

	// Get the client ID and realm from the config
	var config ClientDataSourceModel
	resp.Diagnostics.Append(req.Config.Get(ctx, &config)...)
	if resp.Diagnostics.HasError() {
		return
	}

	clientID := config.ClientID.ValueString()
	if clientID == "" {
		resp.Diagnostics.AddError(
			"Invalid Configuration",
			"Client ID is required",
		)
		return
	}

	// Get the realm from the provider context or config
	// For this data source, we require realm to be specified in config or provider
	realmName := config.RealmID.ValueString()
	if realmName == "" {
		// Check if realm is configured at provider level
		resp.Diagnostics.AddError(
			"Invalid Configuration",
			"Realm ID is required to look up a client",
		)
		return
	}

	// Create the clients client
	clientsClient := client.NewClientsClient(d.httpClient)

	// Fetch the client from the API
	clientData, err := clientsClient.GetClient(ctx, realmName, clientID)
	if err != nil {
		resp.Diagnostics.AddError(
			"Error Reading Client",
			fmt.Sprintf("Unable to read client %s: %v", clientID, err),
		)
		return
	}

	// Map the client response to the Terraform model
	var state ClientDataSourceModel
	state.ID = types.StringValue(clientData.ID)
	state.RealmID = types.StringValue(clientData.RealmID)
	state.ClientID = types.StringValue(clientData.ClientID)
	state.ClientType = types.StringValue(clientData.ClientType)
	state.Name = types.StringValue(clientData.Name)
	state.Description = types.StringValue(clientData.Description)
	state.Enabled = types.BoolValue(clientData.Enabled)
	state.RequireConsent = types.BoolValue(clientData.RequireConsent)
	state.BackchannelLogoutUri = types.StringValue(clientData.BackchannelLogoutUri)
	state.BackchannelLogoutSessionRequired = types.BoolValue(clientData.BackchannelLogoutSessionRequired)
	state.ServiceAccountUserID = types.StringValue(clientData.ServiceAccountUserID)
	state.CreatedAt = types.StringValue(clientData.CreatedAt)
	state.UpdatedAt = types.StringValue(clientData.UpdatedAt)

	// Handle list types
	if len(clientData.RedirectUris) > 0 {
		redirectUris, diag := types.ListValueFrom(ctx, types.StringType, clientData.RedirectUris)
		if !diag.HasError() {
			state.RedirectUris = redirectUris
		}
	}

	if len(clientData.WebOrigins) > 0 {
		webOrigins, diag := types.ListValueFrom(ctx, types.StringType, clientData.WebOrigins)
		if !diag.HasError() {
			state.WebOrigins = webOrigins
		}
	}

	if len(clientData.GrantTypes) > 0 {
		grantTypes, diag := types.ListValueFrom(ctx, types.StringType, clientData.GrantTypes)
		if !diag.HasError() {
			state.GrantTypes = grantTypes
		}
	}

	// Set the state
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	tflog.Debug(ctx, "Client data source read successfully")
}