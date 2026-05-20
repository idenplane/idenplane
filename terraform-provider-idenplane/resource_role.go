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
	_ resource.Resource                = &RoleResource{}
	_ resource.ResourceWithConfigure   = &RoleResource{}
	_ resource.ResourceWithImportState = &RoleResource{}
)

// RoleResource implements the role resource
type RoleResource struct {
	// httpClient is the internal HTTP client
	httpClient *client.HTTPClient
}

// RoleResourceModel represents the Terraform model for role resource
type RoleResourceModel struct {
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

// NewRoleResource creates a new role resource
func NewRoleResource() resource.Resource {
	return &RoleResource{}
}

// Metadata returns the resource metadata (name)
func (r *RoleResource) Metadata(ctx context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_role"
}

// Schema returns the resource schema
func (r *RoleResource) Schema(ctx context.Context, req resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "Manages an AuthMe role. This resource allows you to create, update, and delete realm or client roles.",

		Attributes: map[string]schema.Attribute{
			"id": schema.StringAttribute{
				MarkdownDescription: "Unique identifier for the role (computed)",
				Computed:             true,
			},
			"realm_id": schema.StringAttribute{
				MarkdownDescription: "The realm ID this role belongs to",
				Required:            true,
				PlanModifiers: []planmodifier.String{
					planmodifier.RequiresReplace(),
				},
				Validators: []validator.String{
					stringvalidator.LengthAtLeast(1),
				},
			},
			"client_id": schema.StringAttribute{
				MarkdownDescription: "The client ID (only for client-specific roles). If not set, a realm role is created.",
				Optional:           true,
				PlanModifiers: []planmodifier.String{
					planmodifier.RequiresReplace(),
				},
			},
			"name": schema.StringAttribute{
				MarkdownDescription: "The role name",
				Required:            true,
				PlanModifiers: []planmodifier.String{
					planmodifier.RequiresReplace(),
				},
				Validators: []validator.String{
					stringvalidator.LengthAtLeast(1),
				},
			},
			"description": schema.StringAttribute{
				MarkdownDescription: "Description of the role",
				Optional:           true,
			},
			"composite": schema.BoolAttribute{
				MarkdownDescription: "Whether this is a composite role (computed)",
				Computed:             true,
			},
			"client_role": schema.BoolAttribute{
				MarkdownDescription: "Whether this is a client-specific role (computed)",
				Computed:             true,
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
func (r *RoleResource) Configure(ctx context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
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

// Create creates the role resource
func (r *RoleResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	tflog.Debug(ctx, "Creating role resource")

	// Get the plan from the config
	var plan RoleResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	// Build the create request
	createReq := client.CreateRoleRequest{
		Name: plan.Name.ValueString(),
	}

	// Map optional fields from the plan
	mapRolePlanToCreateRequest(ctx, plan, &createReq)

	// Create the roles client
	rolesClient := client.NewRolesClient(r.httpClient)
	realmName := plan.RealmID.ValueString()
	clientID := plan.ClientID.ValueString()

	var role *client.Role
	var err error

	if clientID != "" {
		// Client role
		role, err = rolesClient.CreateClientRole(ctx, realmName, clientID, createReq)
		if err != nil {
			resp.Diagnostics.AddError(
				"Error Creating Client Role",
				fmt.Sprintf("Unable to create client role %s for client %s in realm %s: %v", plan.Name.ValueString(), clientID, realmName, err),
			)
			return
		}
	} else {
		// Realm role
		role, err = rolesClient.CreateRealmRole(ctx, realmName, createReq)
		if err != nil {
			resp.Diagnostics.AddError(
				"Error Creating Realm Role",
				fmt.Sprintf("Unable to create realm role %s in realm %s: %v", plan.Name.ValueString(), realmName, err),
			)
			return
		}
	}

	// Map the response to the Terraform state
	var state RoleResourceModel
	mapRoleToState(ctx, role, &state)

	// Ensure realm_id and client_id are preserved
	state.RealmID = plan.RealmID
	state.ClientID = plan.ClientID

	// Set the state
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	tflog.Debug(ctx, "Role created successfully", map[string]interface{}{
		"name":     role.Name,
		"id":       role.ID,
		"realm_id": realmName,
		"client_id": clientID,
	})
}

// Read reads the role resource
func (r *RoleResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	tflog.Debug(ctx, "Reading role resource")

	// Get the current state
	var state RoleResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	roleName := state.Name.ValueString()
	realmName := state.RealmID.ValueString()
	clientID := state.ClientID.ValueString()

	if roleName == "" || realmName == "" {
		resp.Diagnostics.AddError(
			"Invalid State",
			"Role name and Realm ID are required in state",
		)
		return
	}

	// Create the roles client
	rolesClient := client.NewRolesClient(r.httpClient)

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

	// Map the response to the Terraform state
	mapRoleToState(ctx, role, &state)

	// Ensure realm_id and client_id are preserved
	state.RealmID = types.StringValue(realmName)
	state.ClientID = types.StringValue(clientID)

	// Set the state
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	tflog.Debug(ctx, "Role read successfully", map[string]interface{}{
		"name":     role.Name,
		"id":       role.ID,
		"realm_id": realmName,
		"client_id": clientID,
	})
}

// Update updates the role resource
func (r *RoleResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	tflog.Debug(ctx, "Updating role resource")

	// Get the plan from the config
	var plan RoleResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	// Get the current state to get the original identifiers
	var state RoleResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	roleName := plan.Name.ValueString()
	realmName := plan.RealmID.ValueString()
	clientID := plan.ClientID.ValueString()

	// Build the update request
	updateReq := client.UpdateRoleRequest{}

	// Map optional fields from the plan
	mapRolePlanToUpdateRequest(ctx, plan, &updateReq)

	// Create the roles client
	rolesClient := client.NewRolesClient(r.httpClient)

	var role *client.Role
	var err error

	if clientID != "" {
		// Client role
		role, err = rolesClient.UpdateClientRole(ctx, realmName, clientID, roleName, updateReq)
		if err != nil {
			resp.Diagnostics.AddError(
				"Error Updating Client Role",
				fmt.Sprintf("Unable to update client role %s for client %s in realm %s: %v", roleName, clientID, realmName, err),
			)
			return
		}
	} else {
		// Realm role
		role, err = rolesClient.UpdateRealmRole(ctx, realmName, roleName, updateReq)
		if err != nil {
			resp.Diagnostics.AddError(
				"Error Updating Realm Role",
				fmt.Sprintf("Unable to update realm role %s in realm %s: %v", roleName, realmName, err),
			)
			return
		}
	}

	// Map the response to the Terraform state
	var newState RoleResourceModel
	mapRoleToState(ctx, role, &newState)

	// Ensure realm_id, client_id, and name are preserved
	newState.RealmID = state.RealmID
	newState.ClientID = state.ClientID
	newState.Name = state.Name

	// Set the state
	resp.Diagnostics.Append(resp.State.Set(ctx, &newState)...)
	if resp.Diagnostics.HasError() {
		return
	}

	tflog.Debug(ctx, "Role updated successfully", map[string]interface{}{
		"name":     role.Name,
		"id":       role.ID,
		"realm_id": realmName,
		"client_id": clientID,
	})
}

// Delete deletes the role resource
func (r *RoleResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	tflog.Debug(ctx, "Deleting role resource")

	// Get the current state
	var state RoleResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	roleName := state.Name.ValueString()
	realmName := state.RealmID.ValueString()
	clientID := state.ClientID.ValueString()

	if roleName == "" || realmName == "" {
		resp.Diagnostics.AddError(
			"Invalid State",
			"Role name and Realm ID are required in state",
		)
		return
	}

	// Create the roles client
	rolesClient := client.NewRolesClient(r.httpClient)

	var err error

	if clientID != "" {
		// Client role
		err = rolesClient.DeleteClientRole(ctx, realmName, clientID, roleName)
		if err != nil {
			resp.Diagnostics.AddError(
				"Error Deleting Client Role",
				fmt.Sprintf("Unable to delete client role %s for client %s in realm %s: %v", roleName, clientID, realmName, err),
			)
			return
		}
	} else {
		// Realm role
		err = rolesClient.DeleteRealmRole(ctx, realmName, roleName)
		if err != nil {
			resp.Diagnostics.AddError(
				"Error Deleting Realm Role",
				fmt.Sprintf("Unable to delete realm role %s in realm %s: %v", roleName, realmName, err),
			)
			return
		}
	}

	tflog.Debug(ctx, "Role deleted successfully", map[string]interface{}{
		"name":     roleName,
		"realm_id": realmName,
		"client_id": clientID,
	})
}

// ImportState imports the role resource state
func (r *RoleResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	// The import ID format is: realm_id/role_name or realm_id/client_id/role_name
	importID := req.ID
	if importID == "" {
		resp.Diagnostics.AddError(
			"Invalid Import ID",
			"Import ID must be in format: realm_id/role_name or realm_id/client_id/role_name",
		)
		return
	}

	// Parse the import ID
	parts := strings.Split(importID, "/")
	var realmName, clientID, roleName string

	if len(parts) == 2 {
		// Format: realm_id/role_name (realm role)
		realmName = parts[0]
		roleName = parts[1]
	} else if len(parts) == 3 {
		// Format: realm_id/client_id/role_name (client role)
		realmName = parts[0]
		clientID = parts[1]
		roleName = parts[2]
	} else {
		resp.Diagnostics.AddError(
			"Invalid Import ID",
			"Import ID must be in format: realm_id/role_name or realm_id/client_id/role_name",
		)
		return
	}

	if realmName == "" || roleName == "" {
		resp.Diagnostics.AddError(
			"Invalid Import ID",
			"Realm ID and role name are required",
		)
		return
	}

	// Create the roles client
	rolesClient := client.NewRolesClient(r.httpClient)

	var role *client.Role
	var err error

	if clientID != "" {
		// Client role
		role, err = rolesClient.GetClientRole(ctx, realmName, clientID, roleName)
		if err != nil {
			resp.Diagnostics.AddError(
				"Error Importing Client Role",
				fmt.Sprintf("Unable to import client role %s for client %s in realm %s: %v", roleName, clientID, realmName, err),
			)
			return
		}
	} else {
		// Realm role
		role, err = rolesClient.GetRealmRole(ctx, realmName, roleName)
		if err != nil {
			resp.Diagnostics.AddError(
				"Error Importing Realm Role",
				fmt.Sprintf("Unable to import realm role %s in realm %s: %v", roleName, realmName, err),
			)
			return
		}
	}

	// Map the role to the state
	var state RoleResourceModel
	mapRoleToState(ctx, role, &state)

	// Ensure realm_id, client_id, and name are set
	state.RealmID = types.StringValue(realmName)
	state.ClientID = types.StringValue(clientID)
	state.Name = types.StringValue(roleName)

	// Set the state with the import ID
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	// Add the import state ID
	resource.ImportStatePassthroughID(ctx, resource.DefaultsPath("name"), req, resp)

	tflog.Debug(ctx, "Role imported successfully", map[string]interface{}{
		"name":     role.Name,
		"id":       role.ID,
		"realm_id": realmName,
		"client_id": clientID,
	})
}

// mapRolePlanToCreateRequest maps the Terraform plan to the create request
func mapRolePlanToCreateRequest(ctx context.Context, plan RoleResourceModel, req *client.CreateRoleRequest) {
	if !plan.Description.IsNull() {
		req.Description = plan.Description.ValueString()
	}
}

// mapRolePlanToUpdateRequest maps the Terraform plan to the update request
func mapRolePlanToUpdateRequest(ctx context.Context, plan RoleResourceModel, req *client.UpdateRoleRequest) {
	if !plan.Description.IsNull() {
		req.Description = plan.Description.ValueString()
	}
}

// mapRoleToState maps the API role response to the Terraform state
func mapRoleToState(ctx context.Context, role *client.Role, state *RoleResourceModel) {
	state.ID = types.StringValue(role.ID)
	state.Name = types.StringValue(role.Name)
	state.Description = types.StringValue(role.Description)
	state.Composite = types.BoolValue(role.Composite)
	state.ClientRole = types.BoolValue(role.ClientRole)
	state.CreatedAt = types.StringValue(role.CreatedAt)
	state.UpdatedAt = types.StringValue(role.UpdatedAt)
}