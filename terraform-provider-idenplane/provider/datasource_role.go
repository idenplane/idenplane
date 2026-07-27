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
	_ datasource.DataSource = &RoleDataSource{}
)

// RoleDataSource implements the role data source
type RoleDataSource struct {
	// httpClient is the internal HTTP client
	httpClient *client.HTTPClient
}

// RoleDataSourceModel represents the Terraform model for role data source
type RoleDataSourceModel struct {
	ID          types.String `tfsdk:"id"`
	RealmID     types.String `tfsdk:"realm_id"`
	ClientID    types.String `tfsdk:"client_id"`
	Name        types.String `tfsdk:"name"`
	Description types.String `tfsdk:"description"`
	Composite   types.Bool   `tfsdk:"composite"`
	ClientRole  types.Bool   `tfsdk:"client_role"`
	CreatedAt   types.String `tfsdk:"created_at"`
	UpdatedAt   types.String `tfsdk:"updated_at"`
}

// NewRoleDataSource creates a new role data source
func NewRoleDataSource() datasource.DataSource {
	return &RoleDataSource{}
}

// Metadata returns the data source metadata (name)
func (d *RoleDataSource) Metadata(ctx context.Context, req datasource.MetadataRequest, resp *datasource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_role"
}

// Schema returns the data source schema
func (d *RoleDataSource) Schema(ctx context.Context, req datasource.SchemaRequest, resp *datasource.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "Provides information about an Idenplane role. This data source allows you to " +
			"read existing realm or client roles without managing them as Terraform resources.",

		Attributes: map[string]schema.Attribute{
			"id": schema.StringAttribute{
				MarkdownDescription: "Unique identifier for the role",
				Computed:             true,
			},
			"realm_id": schema.StringAttribute{
				MarkdownDescription: "The realm ID this role belongs to",
				Required:             true,
			},
			"client_id": schema.StringAttribute{
				MarkdownDescription: "The client ID (only for client-specific roles)",
				Optional:             true,
			},
			"name": schema.StringAttribute{
				MarkdownDescription: "The role name",
				Required:             true,
			},
			"description": schema.StringAttribute{
				MarkdownDescription: "Description of the role",
				Computed:             true,
			},
			"composite": schema.BoolAttribute{
				MarkdownDescription: "Whether this is a composite role",
				Computed:             true,
			},
			"client_role": schema.BoolAttribute{
				MarkdownDescription: "Whether this is a client-specific role",
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
func (d *RoleDataSource) Configure(ctx context.Context, req datasource.ConfigureRequest, resp *datasource.ConfigureResponse) {
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

// Read reads the role data from the Idenplane API
func (d *RoleDataSource) Read(ctx context.Context, req datasource.ReadRequest, resp *datasource.ReadResponse) {
	tflog.Debug(ctx, "Reading role data source")

	// Get the role name and realm from the config
	var config RoleDataSourceModel
	resp.Diagnostics.Append(req.Config.Get(ctx, &config)...)
	if resp.Diagnostics.HasError() {
		return
	}

	roleName := config.Name.ValueString()
	if roleName == "" {
		resp.Diagnostics.AddError(
			"Invalid Configuration",
			"Role name is required",
		)
		return
	}

	realmName := config.RealmID.ValueString()
	if realmName == "" {
		resp.Diagnostics.AddError(
			"Invalid Configuration",
			"Realm ID is required to look up a role",
		)
		return
	}

	clientID := config.ClientID.ValueString()

	// Create the roles client
	rolesClient := client.NewRolesClient(d.httpClient)

	// Fetch the role from the API (either realm or client role)
	var role *client.Role
	var err error

	if clientID != "" {
		// Client role
		role, err = rolesClient.GetClientRole(ctx, realmName, clientID, roleName)
		if err != nil {
			resp.Diagnostics.AddError(
				"Error Reading Client Role",
				fmt.Sprintf("Unable to read client role %s for client %s: %v", roleName, clientID, err),
			)
			return
		}
	} else {
		// Realm role
		role, err = rolesClient.GetRealmRole(ctx, realmName, roleName)
		if err != nil {
			resp.Diagnostics.AddError(
				"Error Reading Realm Role",
				fmt.Sprintf("Unable to read realm role %s: %v", roleName, err),
			)
			return
		}
	}

	// Map the role response to the Terraform model
	var state RoleDataSourceModel
	state.ID = types.StringValue(role.ID)
	state.RealmID = types.StringValue(realmName)
	state.ClientID = types.StringValue(clientID)
	state.Name = types.StringValue(role.Name)
	state.Description = types.StringValue(role.Description)
	state.Composite = types.BoolValue(role.Composite)
	state.ClientRole = types.BoolValue(role.ClientRole)
	state.CreatedAt = types.StringValue(role.CreatedAt)
	state.UpdatedAt = types.StringValue(role.UpdatedAt)

	// Set the state
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	tflog.Debug(ctx, "Role data source read successfully")
}
