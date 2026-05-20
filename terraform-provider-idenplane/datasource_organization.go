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
	_ datasource.DataSource = &OrganizationDataSource{}
)

// OrganizationDataSource implements the organization data source
type OrganizationDataSource struct {
	// httpClient is the internal HTTP client
	httpClient *client.HTTPClient
}

// OrganizationDataSourceModel represents the Terraform model for organization data source
type OrganizationDataSourceModel struct {
	ID               types.String `tfsdk:"id"`
	RealmID          types.String `tfsdk:"realm_id"`
	Slug             types.String `tfsdk:"slug"`
	Name             types.String `tfsdk:"name"`
	DisplayName      types.String `tfsdk:"display_name"`
	Description     types.String `tfsdk:"description"`
	Enabled         types.Bool   `tfsdk:"enabled"`
	LogoURL         types.String `tfsdk:"logo_url"`
	PrimaryColor    types.String `tfsdk:"primary_color"`
	RequireMFA      types.Bool   `tfsdk:"require_mfa"`
	VerifiedDomains types.List   `tfsdk:"verified_domains"`
	CreatedAt       types.String `tfsdk:"created_at"`
	UpdatedAt       types.String `tfsdk:"updated_at"`
}

// NewOrganizationDataSource creates a new organization data source
func NewOrganizationDataSource() datasource.DataSource {
	return &OrganizationDataSource{}
}

// Metadata returns the data source metadata (name)
func (d *OrganizationDataSource) Metadata(ctx context.Context, req datasource.MetadataRequest, resp *datasource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_organization"
}

// Schema returns the data source schema
func (d *OrganizationDataSource) Schema(ctx context.Context, req datasource.SchemaRequest, resp *datasource.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "Provides information about an Idenplane organization. This data source allows you to " +
			"read existing organizations without managing them as Terraform resources.",

		Attributes: map[string]schema.Attribute{
			"id": schema.StringAttribute{
				MarkdownDescription: "Unique identifier for the organization",
				Computed:             true,
			},
			"realm_id": schema.StringAttribute{
				MarkdownDescription: "The realm ID this organization belongs to",
				Required:             true,
			},
			"slug": schema.StringAttribute{
				MarkdownDescription: "The organization slug (unique identifier)",
				Required:             true,
			},
			"name": schema.StringAttribute{
				MarkdownDescription: "Organization name",
				Computed:             true,
			},
			"display_name": schema.StringAttribute{
				MarkdownDescription: "Display name of the organization",
				Computed:             true,
			},
			"description": schema.StringAttribute{
				MarkdownDescription: "Description of the organization",
				Computed:             true,
			},
			"enabled": schema.BoolAttribute{
				MarkdownDescription: "Whether the organization is enabled",
				Computed:             true,
			},
			"logo_url": schema.StringAttribute{
				MarkdownDescription: "Logo URL",
				Computed:             true,
			},
			"primary_color": schema.StringAttribute{
				MarkdownDescription: "Primary color",
				Computed:             true,
			},
			"require_mfa": schema.BoolAttribute{
				MarkdownDescription: "Whether MFA is required",
				Computed:             true,
			},
			"verified_domains": schema.ListAttribute{
				MarkdownDescription: "List of verified email domains",
				Computed:             true,
				ElementType:          types.StringType,
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
func (d *OrganizationDataSource) Configure(ctx context.Context, req datasource.ConfigureRequest, resp *datasource.ConfigureResponse) {
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

// Read reads the organization data from the Idenplane API
func (d *OrganizationDataSource) Read(ctx context.Context, req datasource.ReadRequest, resp *datasource.ReadResponse) {
	tflog.Debug(ctx, "Reading organization data source")

	// Get the slug and realm from the config
	var config OrganizationDataSourceModel
	resp.Diagnostics.Append(req.Config.Get(ctx, &config)...)
	if resp.Diagnostics.HasError() {
		return
	}

	slug := config.Slug.ValueString()
	if slug == "" {
		resp.Diagnostics.AddError(
			"Invalid Configuration",
			"Organization slug is required",
		)
		return
	}

	realmName := config.RealmID.ValueString()
	if realmName == "" {
		resp.Diagnostics.AddError(
			"Invalid Configuration",
			"Realm ID is required to look up an organization",
		)
		return
	}

	// Create the organizations client
	orgsClient := client.NewOrganizationsClient(d.httpClient)

	// Fetch the organization from the API
	org, err := orgsClient.GetOrganization(ctx, realmName, slug)
	if err != nil {
		resp.Diagnostics.AddError(
			"Error Reading Organization",
			fmt.Sprintf("Unable to read organization %s: %v", slug, err),
		)
		return
	}

	// Map the organization response to the Terraform model
	var state OrganizationDataSourceModel
	state.ID = types.StringValue(org.ID)
	state.RealmID = types.StringValue(realmName)
	state.Slug = types.StringValue(org.Slug)
	state.Name = types.StringValue(org.Name)
	state.DisplayName = types.StringValue(org.DisplayName)
	state.Description = types.StringValue(org.Description)
	state.Enabled = types.BoolValue(org.Enabled)
	state.LogoURL = types.StringValue(org.LogoURL)
	state.PrimaryColor = types.StringValue(org.PrimaryColor)
	state.RequireMFA = types.BoolValue(org.RequireMFA)
	state.CreatedAt = types.StringValue(org.CreatedAt)
	state.UpdatedAt = types.StringValue(org.UpdatedAt)

	// Handle list types
	if len(org.VerifiedDomains) > 0 {
		domains, diag := types.ListValueFrom(ctx, types.StringType, org.VerifiedDomains)
		if !diag.HasError() {
			state.VerifiedDomains = domains
		}
	}

	// Set the state
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	tflog.Debug(ctx, "Organization data source read successfully")
}
