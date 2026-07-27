// Package provider implements the Terraform provider for Idenplane
package provider

import (
	"context"
	"fmt"
	"strings"

	"github.com/idenplane/terraform-provider-idenplane/client"
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
	_ resource.Resource                = &ClientResource{}
	_ resource.ResourceWithConfigure   = &ClientResource{}
	_ resource.ResourceWithImportState = &ClientResource{}
)

// ClientResource implements the client resource
type ClientResource struct {
	// httpClient is the internal HTTP client
	httpClient *client.HTTPClient
}

// ClientResourceModel represents the Terraform model for client resource
type ClientResourceModel struct {
	ID                                  types.String `tfsdk:"id"`
	RealmID                             types.String `tfsdk:"realm_id"`
	ClientID                            types.String `tfsdk:"client_id"`
	ClientType                          types.String `tfsdk:"client_type"`
	Name                                types.String `tfsdk:"name"`
	Description                         types.String `tfsdk:"description"`
	Enabled                             types.Bool   `tfsdk:"enabled"`
	RedirectUris                        types.List   `tfsdk:"redirect_uris"`
	WebOrigins                          types.List   `tfsdk:"web_origins"`
	GrantTypes                          types.List   `tfsdk:"grant_types"`
	RequireConsent                      types.Bool   `tfsdk:"require_consent"`
	BackchannelLogoutUri                types.String `tfsdk:"backchannel_logout_uri"`
	BackchannelLogoutSessionRequired     types.Bool   `tfsdk:"backchannel_logout_session_required"`
	ServiceAccountUserID                types.String `tfsdk:"service_account_user_id"`
	ClientSecret                        types.String `tfsdk:"client_secret"`
	CreatedAt                           types.String `tfsdk:"created_at"`
	UpdatedAt                           types.String `tfsdk:"updated_at"`
}

// NewClientResource creates a new client resource
func NewClientResource() resource.Resource {
	return &ClientResource{}
}

// Metadata returns the resource metadata (name)
func (r *ClientResource) Metadata(ctx context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_client"
}

// Schema returns the resource schema
func (r *ClientResource) Schema(ctx context.Context, req resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "Manages an Idenplane OAuth client. This resource allows you to create, update, and delete OAuth clients.",

		Attributes: map[string]schema.Attribute{
			"id": schema.StringAttribute{
				MarkdownDescription: "Unique identifier for the client (UUID, computed)",
				Computed:             true,
			},
			"realm_id": schema.StringAttribute{
				MarkdownDescription: "The realm ID this client belongs to",
				Required:            true,
				PlanModifiers: []planmodifier.String{
					planmodifier.RequiresReplace(),
				},
				Validators: []validator.String{
					stringvalidator.LengthAtLeast(1),
				},
			},
			"client_id": schema.StringAttribute{
				MarkdownDescription: "The OAuth client identifier (client_id)",
				Required:            true,
				PlanModifiers: []planmodifier.String{
					planmodifier.RequiresReplace(),
				},
				Validators: []validator.String{
					stringvalidator.LengthAtLeast(1),
				},
			},
			"client_type": schema.StringAttribute{
				MarkdownDescription: "Client type (CONFIDENTIAL or PUBLIC)",
				Optional:           true,
				Computed:           true,
			},
			"name": schema.StringAttribute{
				MarkdownDescription: "Display name of the client",
				Optional:           true,
			},
			"description": schema.StringAttribute{
				MarkdownDescription: "Description of the client",
				Optional:           true,
			},
			"enabled": schema.BoolAttribute{
				MarkdownDescription: "Whether the client is enabled",
				Optional:           true,
				Computed:           true,
			},
			"redirect_uris": schema.ListAttribute{
				MarkdownDescription: "List of valid redirect URIs",
				Optional:           true,
				ElementType:        types.StringType,
			},
			"web_origins": schema.ListAttribute{
				MarkdownDescription: "List of allowed web origins for CORS",
				Optional:           true,
				ElementType:        types.StringType,
			},
			"grant_types": schema.ListAttribute{
				MarkdownDescription: "List of allowed grant types",
				Optional:           true,
				ElementType:        types.StringType,
			},
			"require_consent": schema.BoolAttribute{
				MarkdownDescription: "Whether consent is required from users",
				Optional:           true,
				Computed:           true,
			},
			"backchannel_logout_uri": schema.StringAttribute{
				MarkdownDescription: "Backchannel logout URI",
				Optional:           true,
			},
			"backchannel_logout_session_required": schema.BoolAttribute{
				MarkdownDescription: "Whether backchannel logout session is required",
				Optional:           true,
				Computed:           true,
			},
			"service_account_user_id": schema.StringAttribute{
				MarkdownDescription: "Service account user ID (computed if client is a service account)",
				Computed:             true,
			},
			"client_secret": schema.StringAttribute{
				MarkdownDescription: "Client secret (sensitive, computed on creation for confidential clients)",
				Computed:             true,
				Sensitive:            true,
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
func (r *ClientResource) Configure(ctx context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
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

// Create creates the client resource
func (r *ClientResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	tflog.Debug(ctx, "Creating client resource")

	// Get the plan from the config
	var plan ClientResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	// Build the create request
	createReq := client.CreateClientRequest{
		ClientID: plan.ClientID.ValueString(),
	}

	// Map optional fields from the plan
	mapClientPlanToCreateRequest(ctx, plan, &createReq)

	// Create the clients client and call the API
	clientsClient := client.NewClientsClient(r.httpClient)
	realmName := plan.RealmID.ValueString()

	clientData, err := clientsClient.CreateClient(ctx, realmName, createReq)
	if err != nil {
		resp.Diagnostics.AddError(
			"Error Creating Client",
			fmt.Sprintf("Unable to create client %s in realm %s: %v", plan.ClientID.ValueString(), realmName, err),
		)
		return
	}

	// Map the response to the Terraform state
	var state ClientResourceModel
	mapClientToState(ctx, clientData, &state)

	// Set the state
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	tflog.Debug(ctx, "Client created successfully", map[string]interface{}{
		"client_id": clientData.ClientID,
		"id":        clientData.ID,
		"realm_id":  realmName,
	})
}

// Read reads the client resource
func (r *ClientResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	tflog.Debug(ctx, "Reading client resource")

	// Get the current state
	var state ClientResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	clientID := state.ClientID.ValueString()
	realmName := state.RealmID.ValueString()

	if clientID == "" || realmName == "" {
		resp.Diagnostics.AddError(
			"Invalid State",
			"Client ID and Realm ID are required in state",
		)
		return
	}

	// Create the clients client and fetch the client
	clientsClient := client.NewClientsClient(r.httpClient)

	clientData, err := clientsClient.GetClient(ctx, realmName, clientID)
	if err != nil {
		// Check if the client was deleted
		resp.Diagnostics.AddError(
			"Error Reading Client",
			fmt.Sprintf("Unable to read client %s in realm %s: %v", clientID, realmName, err),
		)
		return
	}

	// Map the response to the Terraform state
	mapClientToState(ctx, clientData, &state)

	// Set the state
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	tflog.Debug(ctx, "Client read successfully", map[string]interface{}{
		"client_id": clientData.ClientID,
		"id":        clientData.ID,
	})
}

// Update updates the client resource
func (r *ClientResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	tflog.Debug(ctx, "Updating client resource")

	// Get the plan from the config
	var plan ClientResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	// Get the current state to get the realm name and client ID
	var state ClientResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	clientID := state.ClientID.ValueString()
	realmName := state.RealmID.ValueString()

	// Build the update request
	updateReq := client.UpdateClientRequest{}

	// Map optional fields from the plan
	mapClientPlanToUpdateRequest(ctx, plan, &updateReq)

	// Create the clients client and call the API
	clientsClient := client.NewClientsClient(r.httpClient)

	clientData, err := clientsClient.UpdateClient(ctx, realmName, clientID, updateReq)
	if err != nil {
		resp.Diagnostics.AddError(
			"Error Updating Client",
			fmt.Sprintf("Unable to update client %s in realm %s: %v", clientID, realmName, err),
		)
		return
	}

	// Map the response to the Terraform state
	var newState ClientResourceModel
	mapClientToState(ctx, clientData, &newState)

	// Ensure realm_id and client_id are preserved from the original state
	newState.RealmID = state.RealmID
	newState.ClientID = state.ClientID

	// Set the state
	resp.Diagnostics.Append(resp.State.Set(ctx, &newState)...)
	if resp.Diagnostics.HasError() {
		return
	}

	tflog.Debug(ctx, "Client updated successfully", map[string]interface{}{
		"client_id": clientData.ClientID,
		"id":        clientData.ID,
	})
}

// Delete deletes the client resource
func (r *ClientResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	tflog.Debug(ctx, "Deleting client resource")

	// Get the current state
	var state ClientResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	clientID := state.ClientID.ValueString()
	realmName := state.RealmID.ValueString()

	if clientID == "" || realmName == "" {
		resp.Diagnostics.AddError(
			"Invalid State",
			"Client ID and Realm ID are required in state",
		)
		return
	}

	// Create the clients client and delete the client
	clientsClient := client.NewClientsClient(r.httpClient)

	err := clientsClient.DeleteClient(ctx, realmName, clientID)
	if err != nil {
		resp.Diagnostics.AddError(
			"Error Deleting Client",
			fmt.Sprintf("Unable to delete client %s in realm %s: %v", clientID, realmName, err),
		)
		return
	}

	tflog.Debug(ctx, "Client deleted successfully", map[string]interface{}{
		"client_id": clientID,
		"realm_id":  realmName,
	})
}

// ImportState imports the client resource state
func (r *ClientResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	// The import ID format is: realm_id/client_id
	importID := req.ID
	if importID == "" {
		resp.Diagnostics.AddError(
			"Invalid Import ID",
			"Import ID must be in format: realm_id/client_id",
		)
		return
	}

	// Parse the import ID
	parts := strings.Split(importID, "/")
	if len(parts) != 2 {
		resp.Diagnostics.AddError(
			"Invalid Import ID",
			"Import ID must be in format: realm_id/client_id",
		)
		return
	}

	realmName := parts[0]
	clientID := parts[1]

	if realmName == "" || clientID == "" {
		resp.Diagnostics.AddError(
			"Invalid Import ID",
			"Both realm_id and client_id must be provided in format: realm_id/client_id",
		)
		return
	}

	// Fetch the client to ensure it exists and get its data
	clientsClient := client.NewClientsClient(r.httpClient)

	clientData, err := clientsClient.GetClient(ctx, realmName, clientID)
	if err != nil {
		resp.Diagnostics.AddError(
			"Error Importing Client",
			fmt.Sprintf("Unable to import client %s in realm %s: %v", clientID, realmName, err),
		)
		return
	}

	// Map the client to the state
	var state ClientResourceModel
	mapClientToState(ctx, clientData, &state)

	// Set the state with the import ID
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	// Add the import state ID
	resource.ImportStatePassthroughID(ctx, resource.DefaultsPath("client_id"), req, resp)

	tflog.Debug(ctx, "Client imported successfully", map[string]interface{}{
		"client_id": clientData.ClientID,
		"id":        clientData.ID,
		"realm_id":  realmName,
	})
}

// mapClientPlanToCreateRequest maps the Terraform plan to the create request
func mapClientPlanToCreateRequest(ctx context.Context, plan ClientResourceModel, req *client.CreateClientRequest) {
	if !plan.ClientType.IsNull() {
		req.ClientType = plan.ClientType.ValueString()
	}

	if !plan.Name.IsNull() {
		req.Name = plan.Name.ValueString()
	}

	if !plan.Description.IsNull() {
		req.Description = plan.Description.ValueString()
	}

	if !plan.Enabled.IsNull() {
		enabled := plan.Enabled.ValueBool()
		req.Enabled = &enabled
	}

	if !plan.RedirectUris.IsNull() {
		var uris []string
		plan.RedirectUris.ElementsAs(ctx, &uris, false)
		req.RedirectUris = uris
	}

	if !plan.WebOrigins.IsNull() {
		var origins []string
		plan.WebOrigins.ElementsAs(ctx, &origins, false)
		req.WebOrigins = origins
	}

	if !plan.GrantTypes.IsNull() {
		var grantTypes []string
		plan.GrantTypes.ElementsAs(ctx, &grantTypes, false)
		req.GrantTypes = grantTypes
	}

	if !plan.RequireConsent.IsNull() {
		val := plan.RequireConsent.ValueBool()
		req.RequireConsent = &val
	}

	if !plan.BackchannelLogoutUri.IsNull() {
		req.BackchannelLogoutUri = plan.BackchannelLogoutUri.ValueString()
	}

	if !plan.BackchannelLogoutSessionRequired.IsNull() {
		val := plan.BackchannelLogoutSessionRequired.ValueBool()
		req.BackchannelLogoutSessionRequired = &val
	}
}

// mapClientPlanToUpdateRequest maps the Terraform plan to the update request
func mapClientPlanToUpdateRequest(ctx context.Context, plan ClientResourceModel, req *client.UpdateClientRequest) {
	if !plan.ClientType.IsNull() {
		req.ClientType = plan.ClientType.ValueString()
	}

	if !plan.Name.IsNull() {
		req.Name = plan.Name.ValueString()
	}

	if !plan.Description.IsNull() {
		req.Description = plan.Description.ValueString()
	}

	if !plan.Enabled.IsNull() {
		enabled := plan.Enabled.ValueBool()
		req.Enabled = &enabled
	}

	if !plan.RedirectUris.IsNull() {
		var uris []string
		plan.RedirectUris.ElementsAs(ctx, &uris, false)
		req.RedirectUris = uris
	}

	if !plan.WebOrigins.IsNull() {
		var origins []string
		plan.WebOrigins.ElementsAs(ctx, &origins, false)
		req.WebOrigins = origins
	}

	if !plan.GrantTypes.IsNull() {
		var grantTypes []string
		plan.GrantTypes.ElementsAs(ctx, &grantTypes, false)
		req.GrantTypes = grantTypes
	}

	if !plan.RequireConsent.IsNull() {
		val := plan.RequireConsent.ValueBool()
		req.RequireConsent = &val
	}

	if !plan.BackchannelLogoutUri.IsNull() {
		req.BackchannelLogoutUri = plan.BackchannelLogoutUri.ValueString()
	}

	if !plan.BackchannelLogoutSessionRequired.IsNull() {
		val := plan.BackchannelLogoutSessionRequired.ValueBool()
		req.BackchannelLogoutSessionRequired = &val
	}
}

// mapClientToState maps the API client response to the Terraform state
func mapClientToState(ctx context.Context, clientData *client.Client, state *ClientResourceModel) {
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

	// Include client secret if returned (only on creation for confidential clients)
	if clientData.ClientSecret != "" {
		state.ClientSecret = types.StringValue(clientData.ClientSecret)
	}

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
}
