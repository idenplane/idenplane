// Package provider implements the Terraform provider for Idenplane
package provider

import (
	"context"
	"fmt"

	"github.com/idenplane/terraform-provider-idenplane/client"
	"github.com/hashicorp/terraform-plugin-framework/attr"
	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/datasource/schema"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/hashicorp/terraform-plugin-log/tflog"
)

// Ensure the implementation satisfies the expected interfaces
var (
	_ datasource.DataSource = &GroupDataSource{}
)

// GroupDataSource implements the group data source
type GroupDataSource struct {
	// httpClient is the internal HTTP client
	httpClient *client.HTTPClient
}

// GroupDataSourceModel represents the Terraform model for group data source
type GroupDataSourceModel struct {
	ID          types.String `tfsdk:"id"`
	RealmID     types.String `tfsdk:"realm_id"`
	Name        types.String `tfsdk:"name"`
	Path        types.String `tfsdk:"path"`
	Description types.String `tfsdk:"description"`
	ParentID    types.String `tfsdk:"parent_id"`
	MemberCount types.Int64  `tfsdk:"member_count"`
	RoleCount   types.Int64  `tfsdk:"role_count"`
	CreatedAt   types.String `tfsdk:"created_at"`
	UpdatedAt   types.String `tfsdk:"updated_at"`
	Members     types.List   `tfsdk:"members"`
	Children    types.List   `tfsdk:"children"`
}

// GroupMemberModel represents a simplified user model for group members
type GroupMemberModel struct {
	ID       types.String `tfsdk:"id"`
	Username types.String `tfsdk:"username"`
	Email    types.String `tfsdk:"email"`
	FirstName types.String `tfsdk:"first_name"`
	LastName  types.String `tfsdk:"last_name"`
}

// GroupChildModel represents a simplified group model for sub-groups
type GroupChildModel struct {
	ID   types.String `tfsdk:"id"`
	Name types.String `tfsdk:"name"`
	Path types.String `tfsdk:"path"`
}

// NewGroupDataSource creates a new group data source
func NewGroupDataSource() datasource.DataSource {
	return &GroupDataSource{}
}

// Metadata returns the data source metadata (name)
func (d *GroupDataSource) Metadata(ctx context.Context, req datasource.MetadataRequest, resp *datasource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_group"
}

// Schema returns the data source schema
func (d *GroupDataSource) Schema(ctx context.Context, req datasource.SchemaRequest, resp *datasource.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "Provides information about an Idenplane group. This data source allows you to " +
			"read existing groups without managing them as Terraform resources.",

		Attributes: map[string]schema.Attribute{
			"id": schema.StringAttribute{
				MarkdownDescription: "Unique identifier for the group",
				Computed:             true,
			},
			"realm_id": schema.StringAttribute{
				MarkdownDescription: "The realm ID this group belongs to",
				Required:             true,
			},
			"name": schema.StringAttribute{
				MarkdownDescription: "The group name",
				Required:             true,
			},
			"path": schema.StringAttribute{
				MarkdownDescription: "The group path (e.g., /parent/child)",
				Computed:             true,
			},
			"description": schema.StringAttribute{
				MarkdownDescription: "Description of the group",
				Computed:             true,
			},
			"parent_id": schema.StringAttribute{
				MarkdownDescription: "The parent group ID (if this is a sub-group)",
				Computed:             true,
				Optional:             true,
			},
			"member_count": schema.Int64Attribute{
				MarkdownDescription: "Number of members in the group",
				Computed:             true,
			},
			"role_count": schema.Int64Attribute{
				MarkdownDescription: "Number of roles assigned to the group",
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
			"members": schema.ListNestedAttribute{
				MarkdownDescription: "List of group members",
				Computed:             true,
				NestedObject: schema.NestedAttributeObject{
					Attributes: map[string]schema.Attribute{
						"id": schema.StringAttribute{
							MarkdownDescription: "User ID",
							Computed:             true,
						},
						"username": schema.StringAttribute{
							MarkdownDescription: "Username",
							Computed:             true,
						},
						"email": schema.StringAttribute{
							MarkdownDescription: "Email address",
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
					},
				},
			},
			"children": schema.ListNestedAttribute{
				MarkdownDescription: "List of sub-groups",
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
		},
	}
}

// Configure configures the data source
func (d *GroupDataSource) Configure(ctx context.Context, req datasource.ConfigureRequest, resp *datasource.ConfigureResponse) {
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

// Read reads the group data from the Idenplane API
func (d *GroupDataSource) Read(ctx context.Context, req datasource.ReadRequest, resp *datasource.ReadResponse) {
	tflog.Debug(ctx, "Reading group data source")

	// Get the group name and realm from the config
	var config GroupDataSourceModel
	resp.Diagnostics.Append(req.Config.Get(ctx, &config)...)
	if resp.Diagnostics.HasError() {
		return
	}

	groupName := config.Name.ValueString()
	if groupName == "" {
		resp.Diagnostics.AddError(
			"Invalid Configuration",
			"Group name is required",
		)
		return
	}

	realmName := config.RealmID.ValueString()
	if realmName == "" {
		resp.Diagnostics.AddError(
			"Invalid Configuration",
			"Realm ID is required to look up a group",
		)
		return
	}

	// Create the groups client
	groupsClient := client.NewGroupsClient(d.httpClient)

	// List all groups and find the one with matching name
	groups, err := groupsClient.ListGroups(ctx, realmName)
	if err != nil {
		resp.Diagnostics.AddError(
			"Error Reading Groups",
			fmt.Sprintf("Unable to list groups in realm %s: %v", realmName, err),
		)
		return
	}

	// Find the group with matching name
	var foundGroup *client.Group
	for i := range groups {
		if groups[i].Name == groupName {
			foundGroup = &groups[i]
			break
		}
	}

	if foundGroup == nil {
		resp.Diagnostics.AddError(
			"Group Not Found",
			fmt.Sprintf("Group with name %q not found in realm %q", groupName, realmName),
		)
		return
	}

	// Fetch full group details by ID to get counts and sub-groups
	group, err := groupsClient.GetGroup(ctx, realmName, foundGroup.ID)
	if err != nil {
		resp.Diagnostics.AddError(
			"Error Reading Group",
			fmt.Sprintf("Unable to read group %s: %v", foundGroup.ID, err),
		)
		return
	}

	// Map the group response to the Terraform model
	var state GroupDataSourceModel
	state.ID = types.StringValue(group.ID)
	state.RealmID = types.StringValue(realmName)
	state.Name = types.StringValue(group.Name)
	state.Path = types.StringValue(group.Path)
	state.Description = types.StringValue(group.Description)
	state.MemberCount = types.Int64Value(int64(group.MemberCount))
	state.RoleCount = types.Int64Value(int64(group.RoleCount))
	state.CreatedAt = types.StringValue(group.CreatedAt)
	state.UpdatedAt = types.StringValue(group.UpdatedAt)

	// Handle parent ID
	if group.ParentID != nil && *group.ParentID != "" {
		state.ParentID = types.StringValue(*group.ParentID)
	} else {
		state.ParentID = types.StringValue("")
	}

	// Map members
	members := make([]GroupMemberModel, 0, len(group.Members))
	for _, member := range group.Members {
		members = append(members, GroupMemberModel{
			ID:        types.StringValue(member.ID),
			Username:  types.StringValue(member.Username),
			Email:     types.StringValue(member.Email),
			FirstName: types.StringValue(member.FirstName),
			LastName:  types.StringValue(member.LastName),
		})
	}
	state.Members = types.ListValueMust(types.ObjectType{AttrTypes: map[string]attr.Type{
		"id":         types.StringType,
		"username":   types.StringType,
		"email":      types.StringType,
		"first_name": types.StringType,
		"last_name":  types.StringType,
	}}, convertMembersToNestedAttr(members))

	// Map children
	children := make([]GroupChildModel, 0, len(group.Children))
	for _, child := range group.Children {
		children = append(children, GroupChildModel{
			ID:   types.StringValue(child.ID),
			Name: types.StringValue(child.Name),
			Path: types.StringValue(child.Path),
		})
	}
	state.Children = types.ListValueMust(types.ObjectType{AttrTypes: map[string]attr.Type{
		"id":   types.StringType,
		"name": types.StringType,
		"path": types.StringType,
	}}, convertChildrenToNestedAttr(children))

	// Set the state
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	tflog.Debug(ctx, "Group data source read successfully")
}

// Helper function to convert members to list of nested attributes
func convertMembersToNestedAttr(members []GroupMemberModel) []attr.Value {
	result := make([]attr.Value, 0, len(members))
	for _, m := range members {
		obj, _ := types.ObjectValue(map[string]attr.Type{
			"id":         types.StringType,
			"username":   types.StringType,
			"email":      types.StringType,
			"first_name": types.StringType,
			"last_name":  types.StringType,
		}, map[string]attr.Value{
			"id":         m.ID,
			"username":   m.Username,
			"email":      m.Email,
			"first_name": m.FirstName,
			"last_name":  m.LastName,
		})
		result = append(result, obj)
	}
	return result
}

// Helper function to convert children to list of nested attributes
func convertChildrenToNestedAttr(children []GroupChildModel) []attr.Value {
	result := make([]attr.Value, 0, len(children))
	for _, c := range children {
		obj, _ := types.ObjectValue(map[string]attr.Type{
			"id":   types.StringType,
			"name": types.StringType,
			"path": types.StringType,
		}, map[string]attr.Value{
			"id":   c.ID,
			"name": c.Name,
			"path": c.Path,
		})
		result = append(result, obj)
	}
	return result
}