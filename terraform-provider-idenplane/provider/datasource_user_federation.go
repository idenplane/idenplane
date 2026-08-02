// Package provider implements the Terraform provider for Idenplane
package provider

import (
	"context"
	"fmt"

	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/datasource/schema"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/hashicorp/terraform-plugin-log/tflog"
	"github.com/idenplane/terraform-provider-idenplane/client"
)

// Ensure the implementation satisfies the expected interfaces
var (
	_ datasource.DataSource = &UserFederationDataSource{}
)

// UserFederationDataSource implements the user federation data source
type UserFederationDataSource struct {
	// httpClient is the internal HTTP client
	httpClient *client.HTTPClient
}

// UserFederationDataSourceModel represents the Terraform model for user federation data source.
// Unlike the client data source (which looks up a client by its human client_id), a user
// federation has no human-readable identifier distinct from its opaque ID, so federation_id
// is both the lookup key and Required. bind_credential is intentionally omitted: it is a
// write-only secret that the API never echoes back on read.
type UserFederationDataSourceModel struct {
	RealmID           types.String `tfsdk:"realm_id"`
	FederationID      types.String `tfsdk:"federation_id"`
	Name              types.String `tfsdk:"name"`
	ProviderType      types.String `tfsdk:"provider_type"`
	Enabled           types.Bool   `tfsdk:"enabled"`
	Priority          types.Int64  `tfsdk:"priority"`
	ConnectionURL     types.String `tfsdk:"connection_url"`
	BindDn            types.String `tfsdk:"bind_dn"`
	StartTLS          types.Bool   `tfsdk:"start_tls"`
	ConnectionTimeout types.Int64  `tfsdk:"connection_timeout"`
	UsersDn           types.String `tfsdk:"users_dn"`
	UserObjectClass   types.String `tfsdk:"user_object_class"`
	UsernameLdapAttr  types.String `tfsdk:"username_ldap_attr"`
	RdnLdapAttr       types.String `tfsdk:"rdn_ldap_attr"`
	UuidLdapAttr      types.String `tfsdk:"uuid_ldap_attr"`
	SearchFilter      types.String `tfsdk:"search_filter"`
	SyncMode          types.String `tfsdk:"sync_mode"`
	SyncPeriod        types.Int64  `tfsdk:"sync_period"`
	ImportEnabled     types.Bool   `tfsdk:"import_enabled"`
	EditMode          types.String `tfsdk:"edit_mode"`
	LastSyncAt        types.String `tfsdk:"last_sync_at"`
	LastSyncStatus    types.String `tfsdk:"last_sync_status"`
	CreatedAt         types.String `tfsdk:"created_at"`
	UpdatedAt         types.String `tfsdk:"updated_at"`
}

// NewUserFederationDataSource creates a new user federation data source
func NewUserFederationDataSource() datasource.DataSource {
	return &UserFederationDataSource{}
}

// Metadata returns the data source metadata (name)
func (d *UserFederationDataSource) Metadata(ctx context.Context, req datasource.MetadataRequest, resp *datasource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_user_federation"
}

// Schema returns the data source schema
func (d *UserFederationDataSource) Schema(ctx context.Context, req datasource.SchemaRequest, resp *datasource.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "Provides information about an Idenplane user federation (LDAP/external user store). " +
			"This data source allows you to read existing user federations without managing them as Terraform resources.",

		Attributes: map[string]schema.Attribute{
			"realm_id": schema.StringAttribute{
				MarkdownDescription: "The realm ID this user federation belongs to",
				Required:            true,
			},
			"federation_id": schema.StringAttribute{
				MarkdownDescription: "Unique identifier of the user federation (UUID)",
				Required:            true,
			},
			"name": schema.StringAttribute{
				MarkdownDescription: "Display name of the user federation",
				Computed:            true,
			},
			"provider_type": schema.StringAttribute{
				MarkdownDescription: "The user federation provider type (e.g., ldap, kerberos)",
				Computed:            true,
			},
			"enabled": schema.BoolAttribute{
				MarkdownDescription: "Whether the user federation is enabled",
				Computed:            true,
			},
			"priority": schema.Int64Attribute{
				MarkdownDescription: "Priority of the user federation among others in the realm",
				Computed:            true,
			},
			"connection_url": schema.StringAttribute{
				MarkdownDescription: "LDAP connection URL",
				Computed:            true,
			},
			"bind_dn": schema.StringAttribute{
				MarkdownDescription: "LDAP bind DN",
				Computed:            true,
			},
			"start_tls": schema.BoolAttribute{
				MarkdownDescription: "Whether to use StartTLS for the LDAP connection",
				Computed:            true,
			},
			"connection_timeout": schema.Int64Attribute{
				MarkdownDescription: "LDAP connection timeout in milliseconds",
				Computed:            true,
			},
			"users_dn": schema.StringAttribute{
				MarkdownDescription: "Base DN under which users are searched",
				Computed:            true,
			},
			"user_object_class": schema.StringAttribute{
				MarkdownDescription: "LDAP object class for user entries",
				Computed:            true,
			},
			"username_ldap_attr": schema.StringAttribute{
				MarkdownDescription: "LDAP attribute mapped to the username",
				Computed:            true,
			},
			"rdn_ldap_attr": schema.StringAttribute{
				MarkdownDescription: "LDAP attribute used as the RDN",
				Computed:            true,
			},
			"uuid_ldap_attr": schema.StringAttribute{
				MarkdownDescription: "LDAP attribute used as the unique identifier",
				Computed:            true,
			},
			"search_filter": schema.StringAttribute{
				MarkdownDescription: "Additional LDAP search filter applied to user searches",
				Computed:            true,
			},
			"sync_mode": schema.StringAttribute{
				MarkdownDescription: "Sync mode for imported users",
				Computed:            true,
			},
			"sync_period": schema.Int64Attribute{
				MarkdownDescription: "Sync period in seconds",
				Computed:            true,
			},
			"import_enabled": schema.BoolAttribute{
				MarkdownDescription: "Whether users are imported into the local store",
				Computed:            true,
			},
			"edit_mode": schema.StringAttribute{
				MarkdownDescription: "Edit mode (READ_ONLY, WRITABLE, UNSYNCED)",
				Computed:            true,
			},
			"last_sync_at": schema.StringAttribute{
				MarkdownDescription: "Timestamp of the last sync",
				Computed:            true,
			},
			"last_sync_status": schema.StringAttribute{
				MarkdownDescription: "Status of the last sync",
				Computed:            true,
			},
			"created_at": schema.StringAttribute{
				MarkdownDescription: "Creation timestamp",
				Computed:            true,
			},
			"updated_at": schema.StringAttribute{
				MarkdownDescription: "Last update timestamp",
				Computed:            true,
			},
		},
	}
}

// Configure configures the data source
func (d *UserFederationDataSource) Configure(ctx context.Context, req datasource.ConfigureRequest, resp *datasource.ConfigureResponse) {
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

// Read reads the user federation data from the Idenplane API
func (d *UserFederationDataSource) Read(ctx context.Context, req datasource.ReadRequest, resp *datasource.ReadResponse) {
	tflog.Debug(ctx, "Reading user federation data source")

	// Get the federation ID and realm from the config
	var config UserFederationDataSourceModel
	resp.Diagnostics.Append(req.Config.Get(ctx, &config)...)
	if resp.Diagnostics.HasError() {
		return
	}

	federationID := config.FederationID.ValueString()
	if federationID == "" {
		resp.Diagnostics.AddError(
			"Invalid Configuration",
			"Federation ID is required",
		)
		return
	}

	realmName := config.RealmID.ValueString()
	if realmName == "" {
		resp.Diagnostics.AddError(
			"Invalid Configuration",
			"Realm ID is required to look up a user federation",
		)
		return
	}

	// Create the user federations client
	federationsClient := client.NewUserFederationsClient(d.httpClient)

	// Fetch the user federation from the API
	federation, err := federationsClient.GetUserFederation(ctx, realmName, federationID)
	if err != nil {
		resp.Diagnostics.AddError(
			"Error Reading User Federation",
			fmt.Sprintf("Unable to read user federation %s in realm %s: %v", federationID, realmName, err),
		)
		return
	}

	// Map the user federation response to the Terraform model
	var state UserFederationDataSourceModel
	state.RealmID = types.StringValue(realmName)
	state.FederationID = types.StringValue(federation.ID)
	state.Name = types.StringValue(federation.Name)
	state.ProviderType = types.StringValue(federation.ProviderType)
	state.Enabled = types.BoolValue(federation.Enabled)
	state.Priority = types.Int64Value(int64(federation.Priority))
	state.ConnectionURL = types.StringValue(federation.ConnectionURL)
	state.BindDn = types.StringValue(federation.BindDn)
	state.StartTLS = types.BoolValue(federation.StartTLS)
	state.ConnectionTimeout = types.Int64Value(int64(federation.ConnectionTimeout))
	state.UsersDn = types.StringValue(federation.UsersDn)
	state.UserObjectClass = types.StringValue(federation.UserObjectClass)
	state.UsernameLdapAttr = types.StringValue(federation.UsernameLdapAttr)
	state.RdnLdapAttr = types.StringValue(federation.RdnLdapAttr)
	state.UuidLdapAttr = types.StringValue(federation.UuidLdapAttr)
	state.SearchFilter = types.StringValue(federation.SearchFilter)
	state.SyncMode = types.StringValue(federation.SyncMode)
	state.SyncPeriod = types.Int64Value(int64(federation.SyncPeriod))
	state.ImportEnabled = types.BoolValue(federation.ImportEnabled)
	state.EditMode = types.StringValue(federation.EditMode)
	state.LastSyncAt = types.StringValue(federation.LastSyncAt)
	state.LastSyncStatus = types.StringValue(federation.LastSyncStatus)
	state.CreatedAt = types.StringValue(federation.CreatedAt)
	state.UpdatedAt = types.StringValue(federation.UpdatedAt)

	// Set the state
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	tflog.Debug(ctx, "User federation data source read successfully")
}
