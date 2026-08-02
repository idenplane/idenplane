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
	_ resource.Resource                = &IdentityProviderResource{}
	_ resource.ResourceWithConfigure   = &IdentityProviderResource{}
	_ resource.ResourceWithImportState = &IdentityProviderResource{}
)

// IdentityProviderResource implements the identity provider resource
type IdentityProviderResource struct {
	baseResource
}

// IdentityProviderResourceModel represents the Terraform model for identity provider resource
type IdentityProviderResourceModel struct {
	ID                        types.String `tfsdk:"id"`
	RealmID                   types.String `tfsdk:"realm_id"`
	Alias                     types.String `tfsdk:"alias"`
	DisplayName               types.String `tfsdk:"display_name"`
	Enabled                   types.Bool   `tfsdk:"enabled"`
	ProviderID                types.String `tfsdk:"provider_id"`
	FirstBrokerLoginFlowAlias types.String `tfsdk:"first_broker_login_flow_alias"`
	PostBrokerLoginFlowAlias  types.String `tfsdk:"post_broker_login_flow_alias"`
	InternalID                types.String `tfsdk:"internal_id"`
	TrustEmail                types.Bool   `tfsdk:"trust_email"`
	StoreToken                types.Bool   `tfsdk:"store_token"`
	ReadOnly                  types.Bool   `tfsdk:"read_only"`
	AddReadTokenRoleOnCreate  types.Bool   `tfsdk:"add_read_token_role_on_create"`
	SyncMode                  types.String `tfsdk:"sync_mode"`
	Discoverable              types.Bool   `tfsdk:"discoverable"`
	SamlMetadataURL           types.String `tfsdk:"saml_metadata_url"`
	SamlMetadata              types.String `tfsdk:"saml_metadata"`
	WantAssertionsSigned      types.Bool   `tfsdk:"want_assertions_signed"`
	OidcMetadataURL           types.String `tfsdk:"oidc_metadata_url"`
	ClientID                  types.String `tfsdk:"client_id"`
	ClientSecret              types.String `tfsdk:"client_secret"`
	HideOnLoginPage           types.Bool   `tfsdk:"hide_on_login_page"`
	CreatedAt                 types.String `tfsdk:"created_at"`
	UpdatedAt                 types.String `tfsdk:"updated_at"`
}

// NewIdentityProviderResource creates a new identity provider resource
func NewIdentityProviderResource() resource.Resource {
	return &IdentityProviderResource{}
}

// Metadata returns the resource metadata (name)
func (r *IdentityProviderResource) Metadata(ctx context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_identity_provider"
}

// Schema returns the resource schema
func (r *IdentityProviderResource) Schema(ctx context.Context, req resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "Manages an Idenplane identity provider. This resource allows you to create, update, and delete identity providers.",

		Attributes: map[string]schema.Attribute{
			"id": schema.StringAttribute{
				MarkdownDescription: "Unique identifier for the identity provider (computed)",
				Computed:            true,
			},
			"realm_id": schema.StringAttribute{
				MarkdownDescription: "The realm ID this identity provider belongs to",
				Required:            true,
				PlanModifiers: []planmodifier.String{
					stringplanmodifier.RequiresReplace(),
				},
				Validators: []validator.String{
					stringvalidator.LengthAtLeast(1),
				},
			},
			"alias": schema.StringAttribute{
				MarkdownDescription: "The identity provider alias (unique identifier)",
				Required:            true,
				PlanModifiers: []planmodifier.String{
					stringplanmodifier.RequiresReplace(),
				},
				Validators: []validator.String{
					stringvalidator.LengthAtLeast(1),
				},
			},
			"display_name": schema.StringAttribute{
				MarkdownDescription: "Display name of the identity provider",
				Optional:            true,
				Computed:            true,
			},
			"enabled": schema.BoolAttribute{
				MarkdownDescription: "Whether the identity provider is enabled",
				Optional:            true,
				Computed:            true,
			},
			"provider_id": schema.StringAttribute{
				MarkdownDescription: "The identity provider type (e.g., oidc, saml)",
				Required:            true,
				PlanModifiers: []planmodifier.String{
					stringplanmodifier.RequiresReplace(),
				},
				Validators: []validator.String{
					stringvalidator.LengthAtLeast(1),
				},
			},
			"first_broker_login_flow_alias": schema.StringAttribute{
				MarkdownDescription: "First broker login flow alias",
				Optional:            true,
				Computed:            true,
			},
			"post_broker_login_flow_alias": schema.StringAttribute{
				MarkdownDescription: "Post broker login flow alias",
				Optional:            true,
				Computed:            true,
			},
			"internal_id": schema.StringAttribute{
				MarkdownDescription: "Internal ID of the identity provider (computed)",
				Computed:            true,
			},
			"trust_email": schema.BoolAttribute{
				MarkdownDescription: "Whether to trust email addresses from this provider",
				Optional:            true,
				Computed:            true,
			},
			"store_token": schema.BoolAttribute{
				MarkdownDescription: "Whether to store tokens from this provider",
				Optional:            true,
				Computed:            true,
			},
			"read_only": schema.BoolAttribute{
				MarkdownDescription: "Whether the identity provider is read-only (computed)",
				Computed:            true,
			},
			"add_read_token_role_on_create": schema.BoolAttribute{
				MarkdownDescription: "Whether to add read token role on create",
				Optional:            true,
				Computed:            true,
			},
			"sync_mode": schema.StringAttribute{
				MarkdownDescription: "Sync mode (IMPORT, LEGACY, FORCED)",
				Optional:            true,
				Computed:            true,
			},
			"discoverable": schema.BoolAttribute{
				MarkdownDescription: "Whether the identity provider is discoverable",
				Optional:            true,
				Computed:            true,
			},
			"saml_metadata_url": schema.StringAttribute{
				MarkdownDescription: "SAML metadata URL",
				Optional:            true,
				Computed:            true,
			},
			"saml_metadata": schema.StringAttribute{
				MarkdownDescription: "SAML metadata XML",
				Optional:            true,
				Computed:            true,
			},
			"want_assertions_signed": schema.BoolAttribute{
				MarkdownDescription: "Whether assertions should be signed",
				Optional:            true,
				Computed:            true,
			},
			"oidc_metadata_url": schema.StringAttribute{
				MarkdownDescription: "OIDC metadata URL",
				Optional:            true,
				Computed:            true,
			},
			"client_id": schema.StringAttribute{
				MarkdownDescription: "Client ID for OIDC provider",
				Optional:            true,
				Computed:            true,
			},
			"client_secret": schema.StringAttribute{
				MarkdownDescription: "Client secret for OIDC provider (sensitive, not returned by the API on read)",
				Optional:            true,
				Sensitive:           true,
			},
			"hide_on_login_page": schema.BoolAttribute{
				MarkdownDescription: "Whether to hide this provider on login page",
				Optional:            true,
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

// Create creates the identity provider resource
func (r *IdentityProviderResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	tflog.Debug(ctx, "Creating identity provider resource")

	// Get the plan from the config
	var plan IdentityProviderResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	// Build the create request
	createReq := client.CreateIdentityProviderRequest{
		Alias:      plan.Alias.ValueString(),
		ProviderID: plan.ProviderID.ValueString(),
	}

	// Map optional fields from the plan
	mapIdentityProviderPlanToCreateRequest(plan, &createReq)

	// Create the identity providers client and call the API
	idpClient := client.NewIdentityProvidersClient(r.httpClient)
	realmName := plan.RealmID.ValueString()

	idp, err := idpClient.CreateIdentityProvider(ctx, realmName, createReq)
	if err != nil {
		addAPIError(&resp.Diagnostics, "Error Creating Identity Provider", "Unable to create identity provider %s in realm %s: %v", plan.Alias.ValueString(), realmName, err)
		return
	}

	// Map the response to the Terraform state
	var state IdentityProviderResourceModel

	// client_secret is Optional (not Computed) and the API never echoes it
	// back, so the resulting state must always mirror the configured value.
	state.ClientSecret = plan.ClientSecret

	mapIdentityProviderToState(idp, &state)

	// Ensure realm_id is preserved (the API does not return it)
	state.RealmID = plan.RealmID

	// Set the state
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	tflog.Debug(ctx, "Identity provider created successfully", map[string]interface{}{
		"alias":    idp.Alias,
		"id":       idp.ID,
		"realm_id": realmName,
	})
}

// Read reads the identity provider resource
func (r *IdentityProviderResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	tflog.Debug(ctx, "Reading identity provider resource")

	// Get the current state
	var state IdentityProviderResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	alias := state.Alias.ValueString()
	realmName := state.RealmID.ValueString()

	if alias == "" || realmName == "" {
		resp.Diagnostics.AddError(
			"Invalid State",
			"Identity provider alias and Realm ID are required in state",
		)
		return
	}

	// Create the identity providers client and fetch the identity provider
	idpClient := client.NewIdentityProvidersClient(r.httpClient)

	idp, err := idpClient.GetIdentityProvider(ctx, realmName, alias)
	if err != nil {
		addAPIError(&resp.Diagnostics, "Error Reading Identity Provider", "Unable to read identity provider %s in realm %s: %v", alias, realmName, err)
		return
	}

	// Map the response to the Terraform state. The API does not return the
	// client secret, so mapIdentityProviderToState leaves state.ClientSecret
	// untouched, preserving whatever value was already in state.
	mapIdentityProviderToState(idp, &state)

	// Ensure realm_id is preserved (the API does not return it)
	state.RealmID = types.StringValue(realmName)

	// Set the state
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	tflog.Debug(ctx, "Identity provider read successfully", map[string]interface{}{
		"alias":    idp.Alias,
		"id":       idp.ID,
		"realm_id": realmName,
	})
}

// Update updates the identity provider resource
func (r *IdentityProviderResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	tflog.Debug(ctx, "Updating identity provider resource")

	// Get the plan from the config
	var plan IdentityProviderResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	// Get the current state to get the realm name and alias
	var state IdentityProviderResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	alias := state.Alias.ValueString()
	realmName := state.RealmID.ValueString()

	// Build the update request
	updateReq := client.UpdateIdentityProviderRequest{}

	// Map optional fields from the plan
	mapIdentityProviderPlanToUpdateRequest(plan, &updateReq)

	// Create the identity providers client and call the API
	idpClient := client.NewIdentityProvidersClient(r.httpClient)

	idp, err := idpClient.UpdateIdentityProvider(ctx, realmName, alias, updateReq)
	if err != nil {
		addAPIError(&resp.Diagnostics, "Error Updating Identity Provider", "Unable to update identity provider %s in realm %s: %v", alias, realmName, err)
		return
	}

	// Map the response to the Terraform state
	var newState IdentityProviderResourceModel

	// client_secret is Optional (not Computed) and the API never echoes it
	// back, so the resulting state must always mirror the configured value.
	newState.ClientSecret = plan.ClientSecret

	mapIdentityProviderToState(idp, &newState)

	// Ensure realm_id and alias are preserved from the original state
	newState.RealmID = state.RealmID
	newState.Alias = state.Alias

	// Set the state
	resp.Diagnostics.Append(resp.State.Set(ctx, &newState)...)
	if resp.Diagnostics.HasError() {
		return
	}

	tflog.Debug(ctx, "Identity provider updated successfully", map[string]interface{}{
		"alias":    idp.Alias,
		"id":       idp.ID,
		"realm_id": realmName,
	})
}

// Delete deletes the identity provider resource
func (r *IdentityProviderResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	tflog.Debug(ctx, "Deleting identity provider resource")

	// Get the current state
	var state IdentityProviderResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	alias := state.Alias.ValueString()
	realmName := state.RealmID.ValueString()

	if alias == "" || realmName == "" {
		resp.Diagnostics.AddError(
			"Invalid State",
			"Identity provider alias and Realm ID are required in state",
		)
		return
	}

	// Create the identity providers client and delete the identity provider
	idpClient := client.NewIdentityProvidersClient(r.httpClient)

	err := idpClient.DeleteIdentityProvider(ctx, realmName, alias)
	if err != nil {
		addAPIError(&resp.Diagnostics, "Error Deleting Identity Provider", "Unable to delete identity provider %s in realm %s: %v", alias, realmName, err)
		return
	}

	tflog.Debug(ctx, "Identity provider deleted successfully", map[string]interface{}{
		"alias":    alias,
		"realm_id": realmName,
	})
}

// ImportState imports the identity provider resource state
func (r *IdentityProviderResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	// The import ID format is: realm_id/alias
	importID := req.ID
	if importID == "" {
		resp.Diagnostics.AddError(
			"Invalid Import ID",
			"Import ID must be in format: realm_id/alias",
		)
		return
	}

	// Parse the import ID
	parts := strings.Split(importID, "/")
	if len(parts) != 2 {
		resp.Diagnostics.AddError(
			"Invalid Import ID",
			"Import ID must be in format: realm_id/alias",
		)
		return
	}

	realmName := parts[0]
	alias := parts[1]

	if realmName == "" || alias == "" {
		resp.Diagnostics.AddError(
			"Invalid Import ID",
			"Both realm_id and alias must be provided in format: realm_id/alias",
		)
		return
	}

	// Fetch the identity provider to ensure it exists and get its data
	idpClient := client.NewIdentityProvidersClient(r.httpClient)

	idp, err := idpClient.GetIdentityProvider(ctx, realmName, alias)
	if err != nil {
		addAPIError(&resp.Diagnostics, "Error Importing Identity Provider", "Unable to import identity provider %s in realm %s: %v", alias, realmName, err)
		return
	}

	// Map the identity provider to the state
	var state IdentityProviderResourceModel
	mapIdentityProviderToState(idp, &state)

	// Ensure realm_id is set (the API does not return it)
	state.RealmID = types.StringValue(realmName)

	// Set the state. Unlike the passthrough helper used by some other resources,
	// we do not call resource.ImportStatePassthroughID here: the import ID is a
	// composite "realm_id/alias" string, and passing it through to the "alias"
	// attribute would overwrite the correct alias mapIdentityProviderToState just
	// set. resp.State.Set below already populates every attribute correctly.
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	tflog.Debug(ctx, "Identity provider imported successfully", map[string]interface{}{
		"alias":    idp.Alias,
		"id":       idp.ID,
		"realm_id": realmName,
	})
}

// mapIdentityProviderPlanToCreateRequest maps the Terraform plan to the create request
func mapIdentityProviderPlanToCreateRequest(plan IdentityProviderResourceModel, req *client.CreateIdentityProviderRequest) {
	if !plan.DisplayName.IsNull() {
		req.DisplayName = plan.DisplayName.ValueString()
	}

	if !plan.Enabled.IsNull() {
		val := plan.Enabled.ValueBool()
		req.Enabled = &val
	}

	if !plan.FirstBrokerLoginFlowAlias.IsNull() {
		req.FirstBrokerLoginFlowAlias = plan.FirstBrokerLoginFlowAlias.ValueString()
	}

	if !plan.PostBrokerLoginFlowAlias.IsNull() {
		req.PostBrokerLoginFlowAlias = plan.PostBrokerLoginFlowAlias.ValueString()
	}

	if !plan.TrustEmail.IsNull() {
		val := plan.TrustEmail.ValueBool()
		req.TrustEmail = &val
	}

	if !plan.StoreToken.IsNull() {
		val := plan.StoreToken.ValueBool()
		req.StoreToken = &val
	}

	if !plan.AddReadTokenRoleOnCreate.IsNull() {
		val := plan.AddReadTokenRoleOnCreate.ValueBool()
		req.AddReadTokenRoleOnCreate = &val
	}

	if !plan.SyncMode.IsNull() {
		req.SyncMode = plan.SyncMode.ValueString()
	}

	if !plan.Discoverable.IsNull() {
		val := plan.Discoverable.ValueBool()
		req.Discoverable = &val
	}

	if !plan.SamlMetadataURL.IsNull() {
		req.SamlMetadataURL = plan.SamlMetadataURL.ValueString()
	}

	if !plan.SamlMetadata.IsNull() {
		req.SamlMetadata = plan.SamlMetadata.ValueString()
	}

	if !plan.WantAssertionsSigned.IsNull() {
		val := plan.WantAssertionsSigned.ValueBool()
		req.WantAssertionsSigned = &val
	}

	if !plan.OidcMetadataURL.IsNull() {
		req.OidcMetadataURL = plan.OidcMetadataURL.ValueString()
	}

	if !plan.ClientID.IsNull() {
		req.ClientID = plan.ClientID.ValueString()
	}

	if !plan.ClientSecret.IsNull() {
		req.ClientSecret = plan.ClientSecret.ValueString()
	}

	if !plan.HideOnLoginPage.IsNull() {
		val := plan.HideOnLoginPage.ValueBool()
		req.HideOnLoginPage = &val
	}
}

// mapIdentityProviderPlanToUpdateRequest maps the Terraform plan to the update request
func mapIdentityProviderPlanToUpdateRequest(plan IdentityProviderResourceModel, req *client.UpdateIdentityProviderRequest) {
	if !plan.DisplayName.IsNull() {
		req.DisplayName = plan.DisplayName.ValueString()
	}

	if !plan.Enabled.IsNull() {
		val := plan.Enabled.ValueBool()
		req.Enabled = &val
	}

	if !plan.FirstBrokerLoginFlowAlias.IsNull() {
		req.FirstBrokerLoginFlowAlias = plan.FirstBrokerLoginFlowAlias.ValueString()
	}

	if !plan.PostBrokerLoginFlowAlias.IsNull() {
		req.PostBrokerLoginFlowAlias = plan.PostBrokerLoginFlowAlias.ValueString()
	}

	if !plan.TrustEmail.IsNull() {
		val := plan.TrustEmail.ValueBool()
		req.TrustEmail = &val
	}

	if !plan.StoreToken.IsNull() {
		val := plan.StoreToken.ValueBool()
		req.StoreToken = &val
	}

	if !plan.AddReadTokenRoleOnCreate.IsNull() {
		val := plan.AddReadTokenRoleOnCreate.ValueBool()
		req.AddReadTokenRoleOnCreate = &val
	}

	if !plan.SyncMode.IsNull() {
		req.SyncMode = plan.SyncMode.ValueString()
	}

	if !plan.Discoverable.IsNull() {
		val := plan.Discoverable.ValueBool()
		req.Discoverable = &val
	}

	if !plan.SamlMetadataURL.IsNull() {
		req.SamlMetadataURL = plan.SamlMetadataURL.ValueString()
	}

	if !plan.SamlMetadata.IsNull() {
		req.SamlMetadata = plan.SamlMetadata.ValueString()
	}

	if !plan.WantAssertionsSigned.IsNull() {
		val := plan.WantAssertionsSigned.ValueBool()
		req.WantAssertionsSigned = &val
	}

	if !plan.OidcMetadataURL.IsNull() {
		req.OidcMetadataURL = plan.OidcMetadataURL.ValueString()
	}

	if !plan.ClientID.IsNull() {
		req.ClientID = plan.ClientID.ValueString()
	}

	if !plan.ClientSecret.IsNull() {
		req.ClientSecret = plan.ClientSecret.ValueString()
	}

	if !plan.HideOnLoginPage.IsNull() {
		val := plan.HideOnLoginPage.ValueBool()
		req.HideOnLoginPage = &val
	}
}

// mapIdentityProviderToState maps the API identity provider response to the Terraform state.
// It intentionally never touches state.ClientSecret or state.RealmID: client_secret is an
// Optional (not Computed) attribute that the API never echoes back, so the framework requires
// its state value to always equal whatever the caller (Create/Update/Read/ImportState) already
// put there; and the identity provider payload does not reliably include the realm ID. Callers
// are responsible for setting both fields themselves.
func mapIdentityProviderToState(idp *client.IdentityProvider, state *IdentityProviderResourceModel) {
	state.ID = types.StringValue(idp.ID)
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
}
