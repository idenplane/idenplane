// Package provider implements the Terraform provider for Idenplane
package provider

import (
	"context"
	"strings"

	"github.com/hashicorp/terraform-plugin-framework-validators/stringvalidator"
	"github.com/hashicorp/terraform-plugin-framework/resource"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/planmodifier"
	"github.com/hashicorp/terraform-plugin-framework/resource/schema/stringplanmodifier"
	"github.com/hashicorp/terraform-plugin-framework/schema/validator"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/hashicorp/terraform-plugin-log/tflog"
	"github.com/idenplane/terraform-provider-idenplane/client"
)

// Ensure the implementation satisfies the expected interfaces
var (
	_ resource.Resource                = &UserFederationResource{}
	_ resource.ResourceWithConfigure   = &UserFederationResource{}
	_ resource.ResourceWithImportState = &UserFederationResource{}
)

// UserFederationResource implements the user federation resource
type UserFederationResource struct {
	baseResource
}

// UserFederationResourceModel represents the Terraform model for user federation resource
type UserFederationResourceModel struct {
	ID                types.String `tfsdk:"id"`
	RealmID           types.String `tfsdk:"realm_id"`
	Name              types.String `tfsdk:"name"`
	ProviderType      types.String `tfsdk:"provider_type"`
	Enabled           types.Bool   `tfsdk:"enabled"`
	Priority          types.Int64  `tfsdk:"priority"`
	ConnectionURL     types.String `tfsdk:"connection_url"`
	BindDn            types.String `tfsdk:"bind_dn"`
	BindCredential    types.String `tfsdk:"bind_credential"`
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

// NewUserFederationResource creates a new user federation resource
func NewUserFederationResource() resource.Resource {
	return &UserFederationResource{}
}

// Metadata returns the resource metadata (name)
func (r *UserFederationResource) Metadata(ctx context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_user_federation"
}

// Schema returns the resource schema
func (r *UserFederationResource) Schema(ctx context.Context, req resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "Manages an Idenplane user federation (LDAP/external user store). This resource allows you to create, update, and delete user federations.",

		Attributes: map[string]schema.Attribute{
			"id": schema.StringAttribute{
				MarkdownDescription: "Unique identifier for the user federation (UUID, computed)",
				Computed:            true,
			},
			"realm_id": schema.StringAttribute{
				MarkdownDescription: "The realm ID this user federation belongs to",
				Required:            true,
				PlanModifiers: []planmodifier.String{
					stringplanmodifier.RequiresReplace(),
				},
				Validators: []validator.String{
					stringvalidator.LengthAtLeast(1),
				},
			},
			"name": schema.StringAttribute{
				MarkdownDescription: "Display name of the user federation",
				Required:            true,
				Validators: []validator.String{
					stringvalidator.LengthAtLeast(1),
				},
			},
			"provider_type": schema.StringAttribute{
				MarkdownDescription: "The user federation provider type (e.g., ldap, kerberos)",
				Required:            true,
				PlanModifiers: []planmodifier.String{
					stringplanmodifier.RequiresReplace(),
				},
				Validators: []validator.String{
					stringvalidator.LengthAtLeast(1),
				},
			},
			"enabled": schema.BoolAttribute{
				MarkdownDescription: "Whether the user federation is enabled",
				Optional:            true,
				Computed:            true,
			},
			"priority": schema.Int64Attribute{
				MarkdownDescription: "Priority of the user federation among others in the realm",
				Optional:            true,
				Computed:            true,
			},
			"connection_url": schema.StringAttribute{
				MarkdownDescription: "LDAP connection URL",
				Optional:            true,
				Computed:            true,
			},
			"bind_dn": schema.StringAttribute{
				MarkdownDescription: "LDAP bind DN",
				Optional:            true,
				Computed:            true,
			},
			"bind_credential": schema.StringAttribute{
				MarkdownDescription: "LDAP bind credential (sensitive, not returned by the API on read)",
				Optional:            true,
				Sensitive:           true,
			},
			"start_tls": schema.BoolAttribute{
				MarkdownDescription: "Whether to use StartTLS for the LDAP connection",
				Optional:            true,
				Computed:            true,
			},
			"connection_timeout": schema.Int64Attribute{
				MarkdownDescription: "LDAP connection timeout in milliseconds",
				Optional:            true,
				Computed:            true,
			},
			"users_dn": schema.StringAttribute{
				MarkdownDescription: "Base DN under which users are searched",
				Optional:            true,
				Computed:            true,
			},
			"user_object_class": schema.StringAttribute{
				MarkdownDescription: "LDAP object class for user entries",
				Optional:            true,
				Computed:            true,
			},
			"username_ldap_attr": schema.StringAttribute{
				MarkdownDescription: "LDAP attribute mapped to the username",
				Optional:            true,
				Computed:            true,
			},
			"rdn_ldap_attr": schema.StringAttribute{
				MarkdownDescription: "LDAP attribute used as the RDN",
				Optional:            true,
				Computed:            true,
			},
			"uuid_ldap_attr": schema.StringAttribute{
				MarkdownDescription: "LDAP attribute used as the unique identifier",
				Optional:            true,
				Computed:            true,
			},
			"search_filter": schema.StringAttribute{
				MarkdownDescription: "Additional LDAP search filter applied to user searches",
				Optional:            true,
				Computed:            true,
			},
			"sync_mode": schema.StringAttribute{
				MarkdownDescription: "Sync mode for imported users",
				Optional:            true,
				Computed:            true,
			},
			"sync_period": schema.Int64Attribute{
				MarkdownDescription: "Sync period in seconds",
				Optional:            true,
				Computed:            true,
			},
			"import_enabled": schema.BoolAttribute{
				MarkdownDescription: "Whether users are imported into the local store",
				Optional:            true,
				Computed:            true,
			},
			"edit_mode": schema.StringAttribute{
				MarkdownDescription: "Edit mode (READ_ONLY, WRITABLE, UNSYNCED)",
				Optional:            true,
				Computed:            true,
			},
			"last_sync_at": schema.StringAttribute{
				MarkdownDescription: "Timestamp of the last sync (computed)",
				Computed:            true,
			},
			"last_sync_status": schema.StringAttribute{
				MarkdownDescription: "Status of the last sync (computed)",
				Computed:            true,
			},
			"created_at": schema.StringAttribute{
				MarkdownDescription: "Creation timestamp (computed)",
				Computed:            true,
			},
			"updated_at": schema.StringAttribute{
				MarkdownDescription: "Last update timestamp (computed)",
				Computed:            true,
			},
		},
	}
}

// Create creates the user federation resource
func (r *UserFederationResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	tflog.Debug(ctx, "Creating user federation resource")

	// Get the plan from the config
	var plan UserFederationResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	// Build the create request
	createReq := client.CreateUserFederationRequest{
		Name:         plan.Name.ValueString(),
		ProviderType: plan.ProviderType.ValueString(),
	}

	// Map optional fields from the plan
	mapUserFederationPlanToCreateRequest(plan, &createReq)

	// Create the user federations client and call the API
	federationsClient := client.NewUserFederationsClient(r.httpClient)
	realmName := plan.RealmID.ValueString()

	federation, err := federationsClient.CreateUserFederation(ctx, realmName, createReq)
	if err != nil {
		addAPIError(&resp.Diagnostics, "Error Creating User Federation", "Unable to create user federation %s in realm %s: %v", plan.Name.ValueString(), realmName, err)
		return
	}

	// Map the response to the Terraform state
	var state UserFederationResourceModel

	// bind_credential is Optional (not Computed) and the API never echoes it
	// back, so the resulting state must always mirror the configured value.
	state.BindCredential = plan.BindCredential

	mapUserFederationToState(federation, &state)

	// Ensure realm_id is preserved (the API may not reliably return it)
	state.RealmID = plan.RealmID

	// Set the state
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	tflog.Debug(ctx, "User federation created successfully", map[string]interface{}{
		"name":     federation.Name,
		"id":       federation.ID,
		"realm_id": realmName,
	})
}

// Read reads the user federation resource
func (r *UserFederationResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	tflog.Debug(ctx, "Reading user federation resource")

	// Get the current state
	var state UserFederationResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	federationID := state.ID.ValueString()
	realmName := state.RealmID.ValueString()

	if federationID == "" || realmName == "" {
		resp.Diagnostics.AddError(
			"Invalid State",
			"User federation ID and Realm ID are required in state",
		)
		return
	}

	// Create the user federations client and fetch the user federation
	federationsClient := client.NewUserFederationsClient(r.httpClient)

	federation, err := federationsClient.GetUserFederation(ctx, realmName, federationID)
	if err != nil {
		addAPIError(&resp.Diagnostics, "Error Reading User Federation", "Unable to read user federation %s in realm %s: %v", federationID, realmName, err)
		return
	}

	// Map the response to the Terraform state. The API does not return the
	// bind credential, so mapUserFederationToState leaves state.BindCredential
	// untouched, preserving whatever value was already in state.
	mapUserFederationToState(federation, &state)

	// Ensure realm_id is preserved (the API may not reliably return it)
	state.RealmID = types.StringValue(realmName)

	// Set the state
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	tflog.Debug(ctx, "User federation read successfully", map[string]interface{}{
		"id":       federation.ID,
		"realm_id": realmName,
	})
}

// Update updates the user federation resource
func (r *UserFederationResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	tflog.Debug(ctx, "Updating user federation resource")

	// Get the plan from the config
	var plan UserFederationResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	// Get the current state to get the realm name and federation ID
	var state UserFederationResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	federationID := state.ID.ValueString()
	realmName := state.RealmID.ValueString()

	if federationID == "" || realmName == "" {
		resp.Diagnostics.AddError(
			"Invalid State",
			"User federation ID and Realm ID are required in state",
		)
		return
	}

	// Build the update request. Name is mutable (unlike provider_type, which
	// is RequiresReplace), so it is always sent.
	updateReq := client.UpdateUserFederationRequest{
		Name:         plan.Name.ValueString(),
		ProviderType: plan.ProviderType.ValueString(),
	}

	// Map optional fields from the plan
	mapUserFederationPlanToUpdateRequest(plan, &updateReq)

	// Create the user federations client and call the API
	federationsClient := client.NewUserFederationsClient(r.httpClient)

	federation, err := federationsClient.UpdateUserFederation(ctx, realmName, federationID, updateReq)
	if err != nil {
		addAPIError(&resp.Diagnostics, "Error Updating User Federation", "Unable to update user federation %s in realm %s: %v", federationID, realmName, err)
		return
	}

	// Map the response to the Terraform state
	var newState UserFederationResourceModel

	// bind_credential is Optional (not Computed) and the API never echoes it
	// back, so the resulting state must always mirror the configured value.
	newState.BindCredential = plan.BindCredential

	mapUserFederationToState(federation, &newState)

	// Ensure realm_id and id are preserved from the original state. The API's
	// update response is not guaranteed to echo the id back, and this resource
	// (unlike ClientResource/IdentityProviderResource, which key off a
	// human-assigned client_id/alias) uses id as its API path key for every
	// subsequent Read/Update/Delete, so losing it here would be silent state
	// corruption rather than a loud failure.
	newState.RealmID = state.RealmID
	newState.ID = state.ID

	// Set the state
	resp.Diagnostics.Append(resp.State.Set(ctx, &newState)...)
	if resp.Diagnostics.HasError() {
		return
	}

	tflog.Debug(ctx, "User federation updated successfully", map[string]interface{}{
		"id":       federation.ID,
		"realm_id": realmName,
	})
}

// Delete deletes the user federation resource
func (r *UserFederationResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	tflog.Debug(ctx, "Deleting user federation resource")

	// Get the current state
	var state UserFederationResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	federationID := state.ID.ValueString()
	realmName := state.RealmID.ValueString()

	if federationID == "" || realmName == "" {
		resp.Diagnostics.AddError(
			"Invalid State",
			"User federation ID and Realm ID are required in state",
		)
		return
	}

	// Create the user federations client and delete the user federation
	federationsClient := client.NewUserFederationsClient(r.httpClient)

	err := federationsClient.DeleteUserFederation(ctx, realmName, federationID)
	if err != nil {
		addAPIError(&resp.Diagnostics, "Error Deleting User Federation", "Unable to delete user federation %s in realm %s: %v", federationID, realmName, err)
		return
	}

	tflog.Debug(ctx, "User federation deleted successfully", map[string]interface{}{
		"id":       federationID,
		"realm_id": realmName,
	})
}

// ImportState imports the user federation resource state
func (r *UserFederationResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	// The import ID format is: realm_id/federation_id
	importID := req.ID
	if importID == "" {
		resp.Diagnostics.AddError(
			"Invalid Import ID",
			"Import ID must be in format: realm_id/federation_id",
		)
		return
	}

	// Parse the import ID
	parts := strings.Split(importID, "/")
	if len(parts) != 2 {
		resp.Diagnostics.AddError(
			"Invalid Import ID",
			"Import ID must be in format: realm_id/federation_id",
		)
		return
	}

	realmName := parts[0]
	federationID := parts[1]

	if realmName == "" || federationID == "" {
		resp.Diagnostics.AddError(
			"Invalid Import ID",
			"Both realm_id and federation_id must be provided in format: realm_id/federation_id",
		)
		return
	}

	// Fetch the user federation to ensure it exists and get its data
	federationsClient := client.NewUserFederationsClient(r.httpClient)

	federation, err := federationsClient.GetUserFederation(ctx, realmName, federationID)
	if err != nil {
		addAPIError(&resp.Diagnostics, "Error Importing User Federation", "Unable to import user federation %s in realm %s: %v", federationID, realmName, err)
		return
	}

	// Map the user federation to the state
	var state UserFederationResourceModel
	mapUserFederationToState(federation, &state)

	// Ensure realm_id is set (the API may not reliably return it)
	state.RealmID = types.StringValue(realmName)

	// Set the state. Unlike the passthrough helper used by some other resources,
	// we do not call resource.ImportStatePassthroughID here: the import ID is a
	// composite "realm_id/federation_id" string, and passing it through to the
	// "id" attribute would overwrite the correct ID mapUserFederationToState
	// already set. resp.State.Set below already populates every attribute
	// correctly.
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	tflog.Debug(ctx, "User federation imported successfully", map[string]interface{}{
		"id":       federation.ID,
		"realm_id": realmName,
	})
}

// mapUserFederationPlanToCreateRequest maps the Terraform plan to the create request
func mapUserFederationPlanToCreateRequest(plan UserFederationResourceModel, req *client.CreateUserFederationRequest) {
	if !plan.Enabled.IsNull() {
		val := plan.Enabled.ValueBool()
		req.Enabled = &val
	}

	if !plan.Priority.IsNull() {
		req.Priority = int(plan.Priority.ValueInt64())
	}

	if !plan.ConnectionURL.IsNull() {
		req.ConnectionURL = plan.ConnectionURL.ValueString()
	}

	if !plan.BindDn.IsNull() {
		req.BindDn = plan.BindDn.ValueString()
	}

	if !plan.BindCredential.IsNull() {
		req.BindCredential = plan.BindCredential.ValueString()
	}

	if !plan.StartTLS.IsNull() {
		val := plan.StartTLS.ValueBool()
		req.StartTLS = &val
	}

	if !plan.ConnectionTimeout.IsNull() {
		req.ConnectionTimeout = int(plan.ConnectionTimeout.ValueInt64())
	}

	if !plan.UsersDn.IsNull() {
		req.UsersDn = plan.UsersDn.ValueString()
	}

	if !plan.UserObjectClass.IsNull() {
		req.UserObjectClass = plan.UserObjectClass.ValueString()
	}

	if !plan.UsernameLdapAttr.IsNull() {
		req.UsernameLdapAttr = plan.UsernameLdapAttr.ValueString()
	}

	if !plan.RdnLdapAttr.IsNull() {
		req.RdnLdapAttr = plan.RdnLdapAttr.ValueString()
	}

	if !plan.UuidLdapAttr.IsNull() {
		req.UuidLdapAttr = plan.UuidLdapAttr.ValueString()
	}

	if !plan.SearchFilter.IsNull() {
		req.SearchFilter = plan.SearchFilter.ValueString()
	}

	if !plan.SyncMode.IsNull() {
		req.SyncMode = plan.SyncMode.ValueString()
	}

	if !plan.SyncPeriod.IsNull() {
		req.SyncPeriod = int(plan.SyncPeriod.ValueInt64())
	}

	if !plan.ImportEnabled.IsNull() {
		val := plan.ImportEnabled.ValueBool()
		req.ImportEnabled = &val
	}

	if !plan.EditMode.IsNull() {
		req.EditMode = plan.EditMode.ValueString()
	}
}

// mapUserFederationPlanToUpdateRequest maps the Terraform plan to the update request
func mapUserFederationPlanToUpdateRequest(plan UserFederationResourceModel, req *client.UpdateUserFederationRequest) {
	if !plan.Enabled.IsNull() {
		val := plan.Enabled.ValueBool()
		req.Enabled = &val
	}

	if !plan.Priority.IsNull() {
		req.Priority = int(plan.Priority.ValueInt64())
	}

	if !plan.ConnectionURL.IsNull() {
		req.ConnectionURL = plan.ConnectionURL.ValueString()
	}

	if !plan.BindDn.IsNull() {
		req.BindDn = plan.BindDn.ValueString()
	}

	if !plan.BindCredential.IsNull() {
		req.BindCredential = plan.BindCredential.ValueString()
	}

	if !plan.StartTLS.IsNull() {
		val := plan.StartTLS.ValueBool()
		req.StartTLS = &val
	}

	if !plan.ConnectionTimeout.IsNull() {
		req.ConnectionTimeout = int(plan.ConnectionTimeout.ValueInt64())
	}

	if !plan.UsersDn.IsNull() {
		req.UsersDn = plan.UsersDn.ValueString()
	}

	if !plan.UserObjectClass.IsNull() {
		req.UserObjectClass = plan.UserObjectClass.ValueString()
	}

	if !plan.UsernameLdapAttr.IsNull() {
		req.UsernameLdapAttr = plan.UsernameLdapAttr.ValueString()
	}

	if !plan.RdnLdapAttr.IsNull() {
		req.RdnLdapAttr = plan.RdnLdapAttr.ValueString()
	}

	if !plan.UuidLdapAttr.IsNull() {
		req.UuidLdapAttr = plan.UuidLdapAttr.ValueString()
	}

	if !plan.SearchFilter.IsNull() {
		req.SearchFilter = plan.SearchFilter.ValueString()
	}

	if !plan.SyncMode.IsNull() {
		req.SyncMode = plan.SyncMode.ValueString()
	}

	if !plan.SyncPeriod.IsNull() {
		req.SyncPeriod = int(plan.SyncPeriod.ValueInt64())
	}

	if !plan.ImportEnabled.IsNull() {
		val := plan.ImportEnabled.ValueBool()
		req.ImportEnabled = &val
	}

	if !plan.EditMode.IsNull() {
		req.EditMode = plan.EditMode.ValueString()
	}
}

// mapUserFederationToState maps the API user federation response to the Terraform state.
// It intentionally never touches state.BindCredential or state.RealmID: bind_credential is
// an Optional (not Computed) attribute that the API never echoes back, so the framework
// requires its state value to always equal whatever the caller (Create/Update/Read/
// ImportState) already put there; and the user federation payload does not reliably include
// the realm ID. Callers are responsible for setting both fields themselves.
func mapUserFederationToState(federation *client.UserFederation, state *UserFederationResourceModel) {
	state.ID = types.StringValue(federation.ID)
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
}
