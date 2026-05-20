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
	_ datasource.DataSource = &UserDataSource{}
)

// UserDataSource implements the user data source
type UserDataSource struct {
	// httpClient is the internal HTTP client
	httpClient *client.HTTPClient
}

// UserDataSourceModel represents the Terraform model for user data source
type UserDataSourceModel struct {
	ID            types.String `tfsdk:"id"`
	RealmID       types.String `tfsdk:"realm_id"`
	Username      types.String `tfsdk:"username"`
	Email         types.String `tfsdk:"email"`
	EmailVerified types.Bool   `tfsdk:"email_verified"`
	FirstName     types.String `tfsdk:"first_name"`
	LastName      types.String `tfsdk:"last_name"`
	Enabled       types.Bool   `tfsdk:"enabled"`
	CreatedAt     types.String `tfsdk:"created_at"`
	UpdatedAt     types.String `tfsdk:"updated_at"`
	Groups        types.List   `tfsdk:"groups"`
	Roles         types.List   `tfsdk:"roles"`
}

// UserGroupModel represents a simplified group model for user groups
type UserGroupModel struct {
	ID   types.String `tfsdk:"id"`
	Name types.String `tfsdk:"name"`
	Path types.String `tfsdk:"path"`
}

// UserRoleModel represents a simplified role model for user roles
type UserRoleModel struct {
	ID          types.String `tfsdk:"id"`
	Name        types.String `tfsdk:"name"`
	Description types.String `tfsdk:"description"`
	Composite   types.Bool   `tfsdk:"composite"`
	ClientRole  types.Bool   `tfsdk:"client_role"`
}

// NewUserDataSource creates a new user data source
func NewUserDataSource() datasource.DataSource {
	return &UserDataSource{}
}

// Metadata returns the data source metadata (name)
func (d *UserDataSource) Metadata(ctx context.Context, req datasource.MetadataRequest, resp *datasource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_user"
}

// Schema returns the data source schema
func (d *UserDataSource) Schema(ctx context.Context, req datasource.SchemaRequest, resp *datasource.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "Provides information about an AuthMe user. This data source allows you to " +
			"read existing users without managing them as Terraform resources.",

		Attributes: map[string]schema.Attribute{
			"id": schema.StringAttribute{
				MarkdownDescription: "Unique identifier for the user (UUID)",
				Computed:             true,
			},
			"realm_id": schema.StringAttribute{
				MarkdownDescription: "The realm ID this user belongs to",
				Required:             true,
			},
			"username": schema.StringAttribute{
				MarkdownDescription: "The username",
				Required:             true,
			},
			"email": schema.StringAttribute{
				MarkdownDescription: "Email address",
				Computed:             true,
			},
			"email_verified": schema.BoolAttribute{
				MarkdownDescription: "Whether the email has been verified",
				Computed:             true,
			},
			"first_name": schema.StringAttribute{
				MarkdownDescription: "First name",
				Computed:             true,
			},
			"last_name": schema.StringAttribute{
				MarkdownDescription: "Last name",
				Computed:             true,
			},
			"enabled": schema.BoolAttribute{
				MarkdownDescription: "Whether the user is enabled",
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
			"groups": schema.ListNestedAttribute{
				MarkdownDescription: "List of groups the user belongs to",
				Computed:             true,
				NestedObject: schema.NestedAttributeObject{
					Attributes: map[string]schema.Attribute{
						"id": schema.StringAttribute{
							MarkdownDescription: "Group ID",
							Computed:             true,
						},
						"name": schema.StringAttribute{
							MarkdownDescription: "Group name",
							Computed:             true,
						},
						"path": schema.StringAttribute{
							MarkdownDescription: "Group path",
							Computed:             true,
						},
					},
				},
			},
			"roles": schema.ListNestedAttribute{
				MarkdownDescription: "List of roles assigned to the user",
				Computed:             true,
				NestedObject: schema.NestedAttributeObject{
					Attributes: map[string]schema.Attribute{
						"id": schema.StringAttribute{
							MarkdownDescription: "Role ID",
							Computed:             true,
						},
						"name": schema.StringAttribute{
							MarkdownDescription: "Role name",
							Computed:             true,
						},
						"description": schema.StringAttribute{
							MarkdownDescription: "Role description",
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
					},
				},
			},
		},
	}
}

// Configure configures the data source
func (d *UserDataSource) Configure(ctx context.Context, req datasource.ConfigureRequest, resp *datasource.ConfigureResponse) {
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

// Read reads the user data from the AuthMe API
func (d *UserDataSource) Read(ctx context.Context, req datasource.ReadRequest, resp *datasource.ReadResponse) {
	tflog.Debug(ctx, "Reading user data source")

	// Get the username and realm from the config
	var config UserDataSourceModel
	resp.Diagnostics.Append(req.Config.Get(ctx, &config)...)
	if resp.Diagnostics.HasError() {
		return
	}

	username := config.Username.ValueString()
	if username == "" {
		resp.Diagnostics.AddError(
			"Invalid Configuration",
			"Username is required",
		)
		return
	}

	realmName := config.RealmID.ValueString()
	if realmName == "" {
		resp.Diagnostics.AddError(
			"Invalid Configuration",
			"Realm ID is required to look up a user",
		)
		return
	}

	// Create the users client
	usersClient := client.NewUsersClient(d.httpClient)

	// List all users and find the one with matching username
	users, err := usersClient.ListUsers(ctx, realmName)
	if err != nil {
		resp.Diagnostics.AddError(
			"Error Reading Users",
			fmt.Sprintf("Unable to list users in realm %s: %v", realmName, err),
		)
		return
	}

	// Find the user with matching username
	var foundUser *client.User
	for i := range users {
		if users[i].Username == username {
			foundUser = &users[i]
			break
		}
	}

	if foundUser == nil {
		resp.Diagnostics.AddError(
			"User Not Found",
			fmt.Sprintf("User with username %q not found in realm %q", username, realmName),
		)
		return
	}

	// Fetch full user details by ID to get groups and roles
	user, err := usersClient.GetUser(ctx, realmName, foundUser.ID)
	if err != nil {
		resp.Diagnostics.AddError(
			"Error Reading User",
			fmt.Sprintf("Unable to read user %s: %v", foundUser.ID, err),
		)
		return
	}

	// Map the user response to the Terraform model
	var state UserDataSourceModel
	state.ID = types.StringValue(user.ID)
	state.RealmID = types.StringValue(realmName)
	state.Username = types.StringValue(user.Username)
	state.Email = types.StringValue(user.Email)
	state.EmailVerified = types.BoolValue(user.EmailVerified)
	state.FirstName = types.StringValue(user.FirstName)
	state.LastName = types.StringValue(user.LastName)
	state.Enabled = types.BoolValue(user.Enabled)
	state.CreatedAt = types.StringValue(user.CreatedAt)
	state.UpdatedAt = types.StringValue(user.UpdatedAt)

	// Map groups
	groups := make([]UserGroupModel, 0, len(user.Groups))
	for _, group := range user.Groups {
		groups = append(groups, UserGroupModel{
			ID:   types.StringValue(group.ID),
			Name: types.StringValue(group.Name),
			Path: types.StringValue(group.Path),
		})
	}
	state.Groups = types.ListValueMust(types.ObjectType{AttrTypes: map[string]attr.Type{
		"id":   types.StringType,
		"name": types.StringType,
		"path": types.StringType,
	}}, convertUserGroupsToNestedAttr(groups))

	// Map roles
	roles := make([]UserRoleModel, 0, len(user.Roles))
	for _, role := range user.Roles {
		roles = append(roles, UserRoleModel{
			ID:          types.StringValue(role.ID),
			Name:        types.StringValue(role.Name),
			Description: types.StringValue(role.Description),
			Composite:   types.BoolValue(role.Composite),
			ClientRole:  types.BoolValue(role.ClientRole),
		})
	}
	state.Roles = types.ListValueMust(types.ObjectType{AttrTypes: map[string]attr.Type{
		"id":          types.StringType,
		"name":        types.StringType,
		"description": types.StringType,
		"composite":   types.BoolType,
		"client_role": types.BoolType,
	}}, convertUserRolesToNestedAttr(roles))

	// Set the state
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	tflog.Debug(ctx, "User data source read successfully")
}

// Helper function to convert user groups to list of nested attributes
func convertUserGroupsToNestedAttr(groups []UserGroupModel) []attr.Value {
	result := make([]attr.Value, 0, len(groups))
	for _, g := range groups {
		obj, _ := types.ObjectValue(map[string]attr.Type{
			"id":   types.StringType,
			"name": types.StringType,
			"path": types.StringType,
		}, map[string]attr.Value{
			"id":   g.ID,
			"name": g.Name,
			"path": g.Path,
		})
		result = append(result, obj)
	}
	return result
}

// Helper function to convert user roles to list of nested attributes
func convertUserRolesToNestedAttr(roles []UserRoleModel) []attr.Value {
	result := make([]attr.Value, 0, len(roles))
	for _, r := range roles {
		obj, _ := types.ObjectValue(map[string]attr.Type{
			"id":          types.StringType,
			"name":        types.StringType,
			"description": types.StringType,
			"composite":   types.BoolType,
			"client_role": types.BoolType,
		}, map[string]attr.Value{
			"id":          r.ID,
			"name":        r.Name,
			"description": r.Description,
			"composite":   r.Composite,
			"client_role": r.ClientRole,
		})
		result = append(result, obj)
	}
	return result
}