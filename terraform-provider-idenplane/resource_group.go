// Package provider implements the Terraform provider for AuthMe
package provider

import (
	"context"
	"fmt"
	"strings"

	"github.com/authme/terraform-provider-authme/client"
	"github.com/hashicorp/terraform-plugin-framework-validators/stringvalidator"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/schema/validator"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/hashicorp/terraform-plugin-log/tflog"
)

// Ensure the implementation satisfies the expected interfaces
var (
	_ resource.Resource                = &GroupResource{}
	_ resource.ResourceWithConfigure   = &GroupResource{}
	_ resource.ResourceWithImportState = &GroupResource{}
)

// GroupResource implements the group resource
type GroupResource struct {
	// httpClient is the internal HTTP client
	httpClient *client.HTTPClient
}

// GroupResourceModel represents the Terraform model for group resource
type GroupResourceModel struct {
	ID          types.String `tfsdk:"id"`
	RealmID     types.String `tfsdk:"realm_id"`
	Name        types.String `tfsdk:"name"`
	Path        types.String `tfsdk:"path"`
	Description types.String `tfsdk:"description"`
	ParentID    types.String `tfsdk:"parent_id"`
	CreatedAt   types.String `tfsdk:"created_at"`
	UpdatedAt   types.String `tfsdk:"updated_at"`
}

// NewGroupResource creates a new group resource
func NewGroupResource() resource.Resource {
	return &GroupResource{}
}

// Metadata returns the resource metadata (name)
func (r *GroupResource) Metadata(ctx context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_group"
}

// Schema returns the resource schema
func (r *GroupResource) Schema(ctx context.Context, req resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "Manages an AuthMe group. This resource allows you to create, update, and delete groups.",

		Attributes: map[string]schema.Attribute{
			"id": schema.StringAttribute{
				MarkdownDescription: "Unique identifier for the group (UUID, computed)",
				Computed:             true,
			},
			"realm_id": schema.StringAttribute{
				MarkdownDescription: "The realm ID this group belongs to",
				Required:            true,
				PlanModifiers: []planmodifier.String{
					planmodifier.RequiresReplace(),
				},
				Validators: []validator.String{
					stringvalidator.LengthAtLeast(1),
				},
			},
			"name": schema.StringAttribute{
				MarkdownDescription: "The group name",
				Required:            true,
				PlanModifiers: []planmodifier.String{
					planmodifier.RequiresReplace(),
				},
				Validators: []validator.String{
					stringvalidator.LengthAtLeast(1),
				},
			},
			"path": schema.StringAttribute{
				MarkdownDescription: "The group path (computed)",
				Computed:             true,
			},
			"description": schema.StringAttribute{
				MarkdownDescription: "Description of the group",
				Optional:           true,
			},
			"parent_id": schema.StringAttribute{
				MarkdownDescription: "The parent group ID (for creating sub-groups)",
				Optional:           true,
				PlanModifiers: []planmodifier.String{
					planmodifier.RequiresReplace(),
				},
			},
			"created_at": schema.StringAttribute{
				MarkdownDescription: "Creation timestamp (computed)",
				Computed:             true,
			},
			"updated_at": schema.StringAttribute{
				MarkdownDescription: "Last update timestamp (computed)",
				Computed:             true,
			},
		},
	}
}

// Configure configures the resource
func (r *GroupResource) Configure(ctx context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
	// Retrieve provider config from terraform configuration
	if req.ProviderData == nil {
		return
	}

	// Type assert to get the HTTP client
	httpClient, ok := req.ProviderData.(*client.HTTPClient)
	if !ok {
		resp.Diagnostics.AddError(
			"Unexpected Resource Configure Type",
			fmt.Sprintf("Expected *client.HTTPClient, got: %T", req.ProviderData),
		)
		return
	}

	r.httpClient = httpClient
}

// Create creates the group resource
func (r *GroupResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	tflog.Debug(ctx, "Creating group resource")

	// Get the plan from the config
	var plan GroupResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	// Build the create request
	createReq := client.CreateGroupRequest{
		Name: plan.Name.ValueString(),
	}

	// Map optional fields from the plan
	mapGroupPlanToCreateRequest(ctx, plan, &createReq)

	// Create the groups client
	groupsClient := client.NewGroupsClient(r.httpClient)
	realmName := plan.RealmID.ValueString()

	group, err := groupsClient.CreateGroup(ctx, realmName, createReq)
	if err != nil {
		resp.Diagnostics.AddError(
			"Error Creating Group",
			fmt.Sprintf("Unable to create group %s in realm %s: %v", plan.Name.ValueString(), realmName, err),
		)
		return
	}

	// Map the response to the Terraform state
	var state GroupResourceModel
	mapGroupToState(ctx, group, &state)

	// Ensure realm_id is preserved
	state.RealmID = plan.RealmID

	// Set the state
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	tflog.Debug(ctx, "Group created successfully", map[string]interface{}{
		"name":     group.Name,
		"id":       group.ID,
		"realm_id": realmName,
	})
}

// Read reads the group resource
func (r *GroupResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	tflog.Debug(ctx, "Reading group resource")

	// Get the current state
	var state GroupResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	groupID := state.ID.ValueString()
	realmName := state.RealmID.ValueString()

	if groupID == "" || realmName == "" {
		resp.Diagnostics.AddError(
			"Invalid State",
			"Group ID and Realm ID are required in state",
		)
		return
	}

	// Create the groups client
	groupsClient := client.NewGroupsClient(r.httpClient)

	group, err := groupsClient.GetGroup(ctx, realmName, groupID)
	if err != nil {
		resp.Diagnostics.AddError(
			"Error Reading Group",
			fmt.Sprintf("Unable to read group %s in realm %s: %v", groupID, realmName, err),
		)
		return
	}

	// Map the response to the Terraform state
	mapGroupToState(ctx, group, &state)

	// Set the state
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	tflog.Debug(ctx, "Group read successfully", map[string]interface{}{
		"name":     group.Name,
		"id":       group.ID,
		"realm_id": realmName,
	})
}

// Update updates the group resource
func (r *GroupResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	tflog.Debug(ctx, "Updating group resource")

	// Get the plan from the config
	var plan GroupResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	// Get the current state to get the original identifiers
	var state GroupResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	groupID := state.ID.ValueString()
	realmName := plan.RealmID.ValueString()

	// Build the update request
	updateReq := client.UpdateGroupRequest{}

	// Map optional fields from the plan
	mapGroupPlanToUpdateRequest(ctx, plan, &updateReq)

	// Create the groups client
	groupsClient := client.NewGroupsClient(r.httpClient)

	group, err := groupsClient.UpdateGroup(ctx, realmName, groupID, updateReq)
	if err != nil {
		resp.Diagnostics.AddError(
			"Error Updating Group",
			fmt.Sprintf("Unable to update group %s in realm %s: %v", groupID, realmName, err),
		)
		return
	}

	// Map the response to the Terraform state
	var newState GroupResourceModel
	mapGroupToState(ctx, group, &newState)

	// Ensure realm_id is preserved from the original state
	newState.RealmID = state.RealmID

	// Set the state
	resp.Diagnostics.Append(resp.State.Set(ctx, &newState)...)
	if resp.Diagnostics.HasError() {
		return
	}

	tflog.Debug(ctx, "Group updated successfully", map[string]interface{}{
		"name":     group.Name,
		"id":       group.ID,
		"realm_id": realmName,
	})
}

// Delete deletes the group resource
func (r *GroupResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	tflog.Debug(ctx, "Deleting group resource")

	// Get the current state
	var state GroupResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	groupID := state.ID.ValueString()
	realmName := state.RealmID.ValueString()

	if groupID == "" || realmName == "" {
		resp.Diagnostics.AddError(
			"Invalid State",
			"Group ID and Realm ID are required in state",
		)
		return
	}

	// Create the groups client
	groupsClient := client.NewGroupsClient(r.httpClient)

	err := groupsClient.DeleteGroup(ctx, realmName, groupID)
	if err != nil {
		resp.Diagnostics.AddError(
			"Error Deleting Group",
			fmt.Sprintf("Unable to delete group %s in realm %s: %v", groupID, realmName, err),
		)
		return
	}

	tflog.Debug(ctx, "Group deleted successfully", map[string]interface{}{
		"id":       groupID,
		"realm_id": realmName,
	})
}

// ImportState imports the group resource state
func (r *GroupResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	// The import ID format is: realm_id/group_id
	importID := req.ID
	if importID == "" {
		resp.Diagnostics.AddError(
			"Invalid Import ID",
			"Import ID must be in format: realm_id/group_id",
		)
		return
	}

	// Parse the import ID
	parts := strings.Split(importID, "/")
	if len(parts) != 2 {
		resp.Diagnostics.AddError(
			"Invalid Import ID",
			"Import ID must be in format: realm_id/group_id",
		)
		return
	}

	realmName := parts[0]
	groupID := parts[1]

	if realmName == "" || groupID == "" {
		resp.Diagnostics.AddError(
			"Invalid Import ID",
			"Both realm_id and group_id must be provided in format: realm_id/group_id",
		)
		return
	}

	// Create the groups client
	groupsClient := client.NewGroupsClient(r.httpClient)

	group, err := groupsClient.GetGroup(ctx, realmName, groupID)
	if err != nil {
		resp.Diagnostics.AddError(
			"Error Importing Group",
			fmt.Sprintf("Unable to import group %s in realm %s: %v", groupID, realmName, err),
		)
		return
	}

	// Map the group to the state
	var state GroupResourceModel
	mapGroupToState(ctx, group, &state)

	// Ensure realm_id is set
	state.RealmID = types.StringValue(realmName)

	// Set the state with the import ID
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	// Add the import state ID
	resource.ImportStatePassthroughID(ctx, resource.DefaultsPath("id"), req, resp)

	tflog.Debug(ctx, "Group imported successfully", map[string]interface{}{
		"name":     group.Name,
		"id":       group.ID,
		"realm_id": realmName,
	})
}

// mapGroupPlanToCreateRequest maps the Terraform plan to the create request
func mapGroupPlanToCreateRequest(ctx context.Context, plan GroupResourceModel, req *client.CreateGroupRequest) {
	if !plan.Description.IsNull() {
		req.Description = plan.Description.ValueString()
	}

	if !plan.ParentID.IsNull() {
		parentID := plan.ParentID.ValueString()
		req.ParentID = &parentID
	}
}

// mapGroupPlanToUpdateRequest maps the Terraform plan to the update request
func mapGroupPlanToUpdateRequest(ctx context.Context, plan GroupResourceModel, req *client.UpdateGroupRequest) {
	if !plan.Name.IsNull() {
		req.Name = plan.Name.ValueString()
	}

	if !plan.Description.IsNull() {
		req.Description = plan.Description.ValueString()
	}

	if !plan.ParentID.IsNull() {
		parentID := plan.ParentID.ValueString()
		req.ParentID = &parentID
	}
}

// mapGroupToState maps the API group response to the Terraform state
func mapGroupToState(ctx context.Context, group *client.Group, state *GroupResourceModel) {
	state.ID = types.StringValue(group.ID)
	state.Name = types.StringValue(group.Name)
	state.Path = types.StringValue(group.Path)
	state.Description = types.StringValue(group.Description)
	state.CreatedAt = types.StringValue(group.CreatedAt)
	state.UpdatedAt = types.StringValue(group.UpdatedAt)

	// Handle parent ID
	if group.ParentID != nil && *group.ParentID != "" {
		state.ParentID = types.StringValue(*group.ParentID)
	} else {
		state.ParentID = types.StringValue("")
	}
}