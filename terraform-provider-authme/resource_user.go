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
	_ resource.Resource                = &UserResource{}
	_ resource.ResourceWithConfigure   = &UserResource{}
	_ resource.ResourceWithImportState = &UserResource{}
)

// UserResource implements the user resource
type UserResource struct {
	// httpClient is the internal HTTP client
	httpClient *client.HTTPClient
}

// UserResourceModel represents the Terraform model for user resource
type UserResourceModel struct {
	ID            types.String `tfsdk:"id"`
	RealmID       types.String `tfsdk:"realm_id"`
	Username      types.String `tfsdk:"username"`
	Email         types.String `tfsdk:"email"`
	EmailVerified types.Bool   `tfsdk:"email_verified"`
	FirstName     types.String `tfsdk:"first_name"`
	LastName      types.String `tfsdk:"last_name"`
	Enabled       types.Bool   `tfsdk:"enabled"`
	Password      types.String `tfsdk:"password"`
	CreatedAt     types.String `tfsdk:"created_at"`
	UpdatedAt     types.String `tfsdk:"updated_at"`
}

// NewUserResource creates a new user resource
func NewUserResource() resource.Resource {
	return &UserResource{}
}

// Metadata returns the resource metadata (name)
func (r *UserResource) Metadata(ctx context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_user"
}

// Schema returns the resource schema
func (r *UserResource) Schema(ctx context.Context, req resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "Manages an AuthMe user. This resource allows you to create, update, and delete users.",

		Attributes: map[string]schema.Attribute{
			"id": schema.StringAttribute{
				MarkdownDescription: "Unique identifier for the user (UUID, computed)",
				Computed:             true,
			},
			"realm_id": schema.StringAttribute{
				MarkdownDescription: "The realm ID this user belongs to",
				Required:            true,
				PlanModifiers: []planmodifier.String{
					planmodifier.RequiresReplace(),
				},
				Validators: []validator.String{
					stringvalidator.LengthAtLeast(1),
				},
			},
			"username": schema.StringAttribute{
				MarkdownDescription: "The username",
				Required:            true,
				PlanModifiers: []planmodifier.String{
					planmodifier.RequiresReplace(),
				},
				Validators: []validator.String{
					stringvalidator.LengthAtLeast(1),
				},
			},
			"email": schema.StringAttribute{
				MarkdownDescription: "Email address",
				Optional:            true,
			},
			"email_verified": schema.BoolAttribute{
				MarkdownDescription: "Whether the email has been verified",
				Optional:            true,
			},
			"first_name": schema.StringAttribute{
				MarkdownDescription: "First name",
				Optional:            true,
			},
			"last_name": schema.StringAttribute{
				MarkdownDescription: "Last name",
				Optional:            true,
			},
			"enabled": schema.BoolAttribute{
				MarkdownDescription: "Whether the user is enabled",
				Optional:            true,
			},
			"password": schema.StringAttribute{
				MarkdownDescription: "The initial password for the user",
				Optional:            true,
				Sensitive:           true,
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
func (r *UserResource) Configure(ctx context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
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

// Create creates the user resource
func (r *UserResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	tflog.Debug(ctx, "Creating user resource")

	// Get the plan from the config
	var plan UserResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	// Build the create request
	createReq := client.CreateUserRequest{
		Username: plan.Username.ValueString(),
	}

	// Map optional fields from the plan
	mapUserPlanToCreateRequest(ctx, plan, &createReq)

	// Create the users client
	usersClient := client.NewUsersClient(r.httpClient)
	realmName := plan.RealmID.ValueString()

	user, err := usersClient.CreateUser(ctx, realmName, createReq)
	if err != nil {
		resp.Diagnostics.AddError(
			"Error Creating User",
			fmt.Sprintf("Unable to create user %s in realm %s: %v", plan.Username.ValueString(), realmName, err),
		)
		return
	}

	// If password is provided, set it
	if !plan.Password.IsNull() && plan.Password.ValueString() != "" {
		passwordReq := client.ResetPasswordRequest{
			Type:      "password",
			Temporary: boolPtr(false),
			Value:     plan.Password.ValueString(),
		}
		if err := usersClient.ResetUserPassword(ctx, realmName, user.ID, passwordReq); err != nil {
			resp.Diagnostics.AddError(
				"Error Setting User Password",
				fmt.Sprintf("Unable to set password for user %s: %v", user.ID, err),
			)
			return
		}
	}

	// Map the response to the Terraform state
	var state UserResourceModel
	mapUserToState(ctx, user, &state)

	// Ensure realm_id is preserved
	state.RealmID = plan.RealmID

	// Set the state
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	tflog.Debug(ctx, "User created successfully", map[string]interface{}{
		"username": user.Username,
		"id":       user.ID,
		"realm_id": realmName,
	})
}

// Read reads the user resource
func (r *UserResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	tflog.Debug(ctx, "Reading user resource")

	// Get the current state
	var state UserResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	userID := state.ID.ValueString()
	realmName := state.RealmID.ValueString()

	if userID == "" || realmName == "" {
		resp.Diagnostics.AddError(
			"Invalid State",
			"User ID and Realm ID are required in state",
		)
		return
	}

	// Create the users client
	usersClient := client.NewUsersClient(r.httpClient)

	user, err := usersClient.GetUser(ctx, realmName, userID)
	if err != nil {
		resp.Diagnostics.AddError(
			"Error Reading User",
			fmt.Sprintf("Unable to read user %s in realm %s: %v", userID, realmName, err),
		)
		return
	}

	// Map the response to the Terraform state
	mapUserToState(ctx, user, &state)

	// Set the state
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	tflog.Debug(ctx, "User read successfully", map[string]interface{}{
		"username": user.Username,
		"id":       user.ID,
		"realm_id": realmName,
	})
}

// Update updates the user resource
func (r *UserResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	tflog.Debug(ctx, "Updating user resource")

	// Get the plan from the config
	var plan UserResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	// Get the current state to get the original identifiers
	var state UserResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	userID := state.ID.ValueString()
	realmName := plan.RealmID.ValueString()

	// Build the update request
	updateReq := client.UpdateUserRequest{}

	// Map optional fields from the plan
	mapUserPlanToUpdateRequest(ctx, plan, &updateReq)

	// Create the users client
	usersClient := client.NewUsersClient(r.httpClient)

	user, err := usersClient.UpdateUser(ctx, realmName, userID, updateReq)
	if err != nil {
		resp.Diagnostics.AddError(
			"Error Updating User",
			fmt.Sprintf("Unable to update user %s in realm %s: %v", userID, realmName, err),
		)
		return
	}

	// If password is provided, update it
	if !plan.Password.IsNull() && plan.Password.ValueString() != "" {
		passwordReq := client.ResetPasswordRequest{
			Type:      "password",
			Temporary: boolPtr(false),
			Value:     plan.Password.ValueString(),
		}
		if err := usersClient.ResetUserPassword(ctx, realmName, user.ID, passwordReq); err != nil {
			resp.Diagnostics.AddError(
				"Error Setting User Password",
				fmt.Sprintf("Unable to set password for user %s: %v", user.ID, err),
			)
			return
		}
	}

	// Map the response to the Terraform state
	var newState UserResourceModel
	mapUserToState(ctx, user, &newState)

	// Ensure realm_id is preserved from the original state
	newState.RealmID = state.RealmID

	// Set the state
	resp.Diagnostics.Append(resp.State.Set(ctx, &newState)...)
	if resp.Diagnostics.HasError() {
		return
	}

	tflog.Debug(ctx, "User updated successfully", map[string]interface{}{
		"username": user.Username,
		"id":       user.ID,
		"realm_id": realmName,
	})
}

// Delete deletes the user resource
func (r *UserResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	tflog.Debug(ctx, "Deleting user resource")

	// Get the current state
	var state UserResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	userID := state.ID.ValueString()
	realmName := state.RealmID.ValueString()

	if userID == "" || realmName == "" {
		resp.Diagnostics.AddError(
			"Invalid State",
			"User ID and Realm ID are required in state",
		)
		return
	}

	// Create the users client
	usersClient := client.NewUsersClient(r.httpClient)

	err := usersClient.DeleteUser(ctx, realmName, userID)
	if err != nil {
		resp.Diagnostics.AddError(
			"Error Deleting User",
			fmt.Sprintf("Unable to delete user %s in realm %s: %v", userID, realmName, err),
		)
		return
	}

	tflog.Debug(ctx, "User deleted successfully", map[string]interface{}{
		"id":       userID,
		"realm_id": realmName,
	})
}

// ImportState imports the user resource state
func (r *UserResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	// The import ID format is: realm_id/user_id
	importID := req.ID
	if importID == "" {
		resp.Diagnostics.AddError(
			"Invalid Import ID",
			"Import ID must be in format: realm_id/user_id",
		)
		return
	}

	// Parse the import ID
	parts := strings.Split(importID, "/")
	if len(parts) != 2 {
		resp.Diagnostics.AddError(
			"Invalid Import ID",
			"Import ID must be in format: realm_id/user_id",
		)
		return
	}

	realmName := parts[0]
	userID := parts[1]

	if realmName == "" || userID == "" {
		resp.Diagnostics.AddError(
			"Invalid Import ID",
			"Both realm_id and user_id must be provided in format: realm_id/user_id",
		)
		return
	}

	// Create the users client
	usersClient := client.NewUsersClient(r.httpClient)

	user, err := usersClient.GetUser(ctx, realmName, userID)
	if err != nil {
		resp.Diagnostics.AddError(
			"Error Importing User",
			fmt.Sprintf("Unable to import user %s in realm %s: %v", userID, realmName, err),
		)
		return
	}

	// Map the user to the state
	var state UserResourceModel
	mapUserToState(ctx, user, &state)

	// Ensure realm_id is set
	state.RealmID = types.StringValue(realmName)

	// Set the state with the import ID
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	// Add the import state ID
	resource.ImportStatePassthroughID(ctx, resource.DefaultsPath("id"), req, resp)

	tflog.Debug(ctx, "User imported successfully", map[string]interface{}{
		"username": user.Username,
		"id":       user.ID,
		"realm_id": realmName,
	})
}

// mapUserPlanToCreateRequest maps the Terraform plan to the create request
func mapUserPlanToCreateRequest(ctx context.Context, plan UserResourceModel, req *client.CreateUserRequest) {
	if !plan.Email.IsNull() {
		req.Email = plan.Email.ValueString()
	}

	if !plan.FirstName.IsNull() {
		req.FirstName = plan.FirstName.ValueString()
	}

	if !plan.LastName.IsNull() {
		req.LastName = plan.LastName.ValueString()
	}

	enabled := plan.Enabled.ValueBool()
	req.Enabled = &enabled

	emailVerified := plan.EmailVerified.ValueBool()
	req.EmailVerified = &emailVerified
}

// mapUserPlanToUpdateRequest maps the Terraform plan to the update request
func mapUserPlanToUpdateRequest(ctx context.Context, plan UserResourceModel, req *client.UpdateUserRequest) {
	if !plan.Email.IsNull() {
		email := plan.Email.ValueString()
		req.Email = &email
	}

	if !plan.FirstName.IsNull() {
		firstName := plan.FirstName.ValueString()
		req.FirstName = &firstName
	}

	if !plan.LastName.IsNull() {
		lastName := plan.LastName.ValueString()
		req.LastName = &lastName
	}

	if !plan.Enabled.IsNull() {
		enabled := plan.Enabled.ValueBool()
		req.Enabled = &enabled
	}

	if !plan.EmailVerified.IsNull() {
		emailVerified := plan.EmailVerified.ValueBool()
		req.EmailVerified = &emailVerified
	}
}

// mapUserToState maps the API user response to the Terraform state
func mapUserToState(ctx context.Context, user *client.User, state *UserResourceModel) {
	state.ID = types.StringValue(user.ID)
	state.Username = types.StringValue(user.Username)
	state.Email = types.StringValue(user.Email)
	state.EmailVerified = types.BoolValue(user.EmailVerified)
	state.FirstName = types.StringValue(user.FirstName)
	state.LastName = types.StringValue(user.LastName)
	state.Enabled = types.BoolValue(user.Enabled)
	state.CreatedAt = types.StringValue(user.CreatedAt)
	state.UpdatedAt = types.StringValue(user.UpdatedAt)
}

// boolPtr returns a pointer to a bool value
func boolPtr(b bool) *bool {
	return &b
}
