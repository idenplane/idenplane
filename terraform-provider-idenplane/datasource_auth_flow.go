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
	_ datasource.DataSource = &AuthFlowDataSource{}
)

// AuthFlowDataSource implements the auth flow data source
type AuthFlowDataSource struct {
	// httpClient is the internal HTTP client
	httpClient *client.HTTPClient
}

// AuthFlowDataSourceModel represents the Terraform model for auth flow data source
type AuthFlowDataSourceModel struct {
	ID          types.String `tfsdk:"id"`
	RealmID     types.String `tfsdk:"realm_id"`
	Alias       types.String `tfsdk:"alias"`
	Description types.String `tfsdk:"description"`
	ProviderID  types.String `tfsdk:"provider_id"`
	Type        types.String `tfsdk:"type"`
	BuiltIn     types.Bool   `tfsdk:"built_in"`
	CreatedAt   types.String `tfsdk:"created_at"`
	UpdatedAt   types.String `tfsdk:"updated_at"`
	Executions  types.List   `tfsdk:"executions"`
}

// ExecutionModel represents a simplified execution model for auth flow executions
type ExecutionModel struct {
	ID                  types.String `tfsdk:"id"`
	DisplayName         types.String `tfsdk:"display_name"`
	Requirement         types.String `tfsdk:"requirement"`
	Authenticator       types.String `tfsdk:"authenticator"`
	AuthenticatorFlow   types.Bool   `tfsdk:"authenticator_flow"`
	Priority            types.Int64  `tfsdk:"priority"`
	Configurable        types.Bool   `tfsdk:"configurable"`
	Authentication      types.String `tfsdk:"authentication"`
	SubFlow             types.Bool   `tfsdk:"sub_flow"`
}

// NewAuthFlowDataSource creates a new auth flow data source
func NewAuthFlowDataSource() datasource.DataSource {
	return &AuthFlowDataSource{}
}

// Metadata returns the data source metadata (name)
func (d *AuthFlowDataSource) Metadata(ctx context.Context, req datasource.MetadataRequest, resp *datasource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_auth_flow"
}

// Schema returns the data source schema
func (d *AuthFlowDataSource) Schema(ctx context.Context, req datasource.SchemaRequest, resp *datasource.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "Provides information about an Idenplane authentication flow. This data source allows you to " +
			"read existing authentication flows without managing them as Terraform resources.",

		Attributes: map[string]schema.Attribute{
			"id": schema.StringAttribute{
				MarkdownDescription: "Unique identifier for the authentication flow",
				Computed:             true,
			},
			"realm_id": schema.StringAttribute{
				MarkdownDescription: "The realm ID this authentication flow belongs to",
				Required:             true,
			},
			"alias": schema.StringAttribute{
				MarkdownDescription: "The authentication flow alias (unique identifier)",
				Required:             true,
			},
			"description": schema.StringAttribute{
				MarkdownDescription: "Description of the authentication flow",
				Computed:             true,
			},
			"provider_id": schema.StringAttribute{
				MarkdownDescription: "Provider ID",
				Computed:             true,
			},
			"type": schema.StringAttribute{
				MarkdownDescription: "Flow type",
				Computed:             true,
			},
			"built_in": schema.BoolAttribute{
				MarkdownDescription: "Whether this is a built-in flow",
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
			"executions": schema.ListNestedAttribute{
				MarkdownDescription: "List of authentication executions",
				Computed:             true,
				NestedObject: schema.NestedAttributeObject{
					Attributes: map[string]schema.Attribute{
						"id": schema.StringAttribute{
							MarkdownDescription: "Execution ID",
							Computed:             true,
						},
						"display_name": schema.StringAttribute{
							MarkdownDescription: "Display name",
							Computed:             true,
						},
						"requirement": schema.StringAttribute{
							MarkdownDescription: "Requirement (REQUIRED, OPTIONAL, DISABLED, ALTERNATIVE)",
							Computed:             true,
						},
						"authenticator": schema.StringAttribute{
							MarkdownDescription: "Authenticator",
							Computed:             true,
						},
						"authenticator_flow": schema.BoolAttribute{
							MarkdownDescription: "Whether this is an authenticator flow",
							Computed:             true,
						},
						"priority": schema.Int64Attribute{
							MarkdownDescription: "Execution priority",
							Computed:             true,
						},
						"configurable": schema.BoolAttribute{
							MarkdownDescription: "Whether this execution is configurable",
							Computed:             true,
						},
						"authentication": schema.StringAttribute{
							MarkdownDescription: "Authentication",
							Computed:             true,
						},
						"sub_flow": schema.BoolAttribute{
							MarkdownDescription: "Whether this is a sub-flow",
							Computed:             true,
						},
					},
				},
			},
		},
	}
}

// Configure configures the data source
func (d *AuthFlowDataSource) Configure(ctx context.Context, req datasource.ConfigureRequest, resp *datasource.ConfigureResponse) {
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

// Read reads the auth flow data from the Idenplane API
func (d *AuthFlowDataSource) Read(ctx context.Context, req datasource.ReadRequest, resp *datasource.ReadResponse) {
	tflog.Debug(ctx, "Reading auth flow data source")

	// Get the alias and realm from the config
	var config AuthFlowDataSourceModel
	resp.Diagnostics.Append(req.Config.Get(ctx, &config)...)
	if resp.Diagnostics.HasError() {
		return
	}

	alias := config.Alias.ValueString()
	if alias == "" {
		resp.Diagnostics.AddError(
			"Invalid Configuration",
			"Authentication flow alias is required",
		)
		return
	}

	realmName := config.RealmID.ValueString()
	if realmName == "" {
		resp.Diagnostics.AddError(
			"Invalid Configuration",
			"Realm ID is required to look up an authentication flow",
		)
		return
	}

	// Create the auth flows client
	flowsClient := client.NewAuthFlowsClient(d.httpClient)

	// Fetch the auth flow by alias
	flow, err := flowsClient.GetAuthFlowByAlias(ctx, realmName, alias)
	if err != nil {
		resp.Diagnostics.AddError(
			"Error Reading Auth Flow",
			fmt.Sprintf("Unable to read auth flow %s: %v", alias, err),
		)
		return
	}

	// Fetch executions for the flow
	executions, err := flowsClient.GetExecutions(ctx, realmName, flow.ID)
	if err != nil {
		resp.Diagnostics.AddError(
			"Error Reading Auth Flow Executions",
			fmt.Sprintf("Unable to read executions for auth flow %s: %v", alias, err),
		)
		return
	}

	// Map the auth flow response to the Terraform model
	var state AuthFlowDataSourceModel
	state.ID = types.StringValue(flow.ID)
	state.RealmID = types.StringValue(realmName)
	state.Alias = types.StringValue(flow.Alias)
	state.Description = types.StringValue(flow.Description)
	state.ProviderID = types.StringValue(flow.ProviderID)
	state.Type = types.StringValue(flow.Type)
	state.BuiltIn = types.BoolValue(flow.BuiltIn)
	state.CreatedAt = types.StringValue(flow.CreatedAt)
	state.UpdatedAt = types.StringValue(flow.UpdatedAt)

	// Map executions
	execs := make([]ExecutionModel, 0, len(executions))
	for _, exec := range executions {
		execs = append(execs, ExecutionModel{
			ID:                types.StringValue(exec.ID),
			DisplayName:       types.StringValue(exec.DisplayName),
			Requirement:       types.StringValue(exec.Requirement),
			Authenticator:     types.StringValue(exec.Authenticator),
			AuthenticatorFlow: types.BoolValue(exec.AuthenticatorFlow),
			Priority:          types.Int64Value(int64(exec.Priority)),
			Configurable:      types.BoolValue(exec.Configurable),
			Authentication:    types.StringValue(exec.Authentication),
			SubFlow:           types.BoolValue(exec.SubFlow),
		})
	}
	state.Executions = types.ListValueMust(types.ObjectType{AttrTypes: map[string]attr.Type{
		"id":                   types.StringType,
		"display_name":         types.StringType,
		"requirement":          types.StringType,
		"authenticator":       types.StringType,
		"authenticator_flow":   types.BoolType,
		"priority":             types.Int64Type,
		"configurable":         types.BoolType,
		"authentication":       types.StringType,
		"sub_flow":             types.BoolType,
	}}, convertExecutionsToNestedAttr(execs))

	// Set the state
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	tflog.Debug(ctx, "Auth flow data source read successfully")
}

// Helper function to convert executions to list of nested attributes
func convertExecutionsToNestedAttr(execs []ExecutionModel) []attr.Value {
	result := make([]attr.Value, 0, len(execs))
	for _, e := range execs {
		obj, _ := types.ObjectValue(map[string]attr.Type{
			"id":                   types.StringType,
			"display_name":         types.StringType,
			"requirement":          types.StringType,
			"authenticator":        types.StringType,
			"authenticator_flow":   types.BoolType,
			"priority":             types.Int64Type,
			"configurable":         types.BoolType,
			"authentication":       types.StringType,
			"sub_flow":             types.BoolType,
		}, map[string]attr.Value{
			"id":                   e.ID,
			"display_name":         e.DisplayName,
			"requirement":          e.Requirement,
			"authenticator":        e.Authenticator,
			"authenticator_flow":   e.AuthenticatorFlow,
			"priority":             e.Priority,
			"configurable":         e.Configurable,
			"authentication":      e.Authentication,
			"sub_flow":             e.SubFlow,
		})
		result = append(result, obj)
	}
	return result
}
