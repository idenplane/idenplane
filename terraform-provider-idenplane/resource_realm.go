// Package provider implements the Terraform provider for AuthMe
package provider

import (
	"context"
	"fmt"

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
	_ resource.Resource                = &RealmResource{}
	_ resource.ResourceWithConfigure   = &RealmResource{}
	_ resource.ResourceWithImportState = &RealmResource{}
)

// RealmResource implements the realm resource
type RealmResource struct {
	// httpClient is the internal HTTP client
	httpClient *client.HTTPClient
}

// RealmResourceModel represents the Terraform model for realm resource
type RealmResourceModel struct {
	ID                           types.String `tfsdk:"id"`
	Name                         types.String `tfsdk:"name"`
	DisplayName                  types.String `tfsdk:"display_name"`
	Enabled                      types.Bool   `tfsdk:"enabled"`
	AccessTokenLifespan          types.Int64  `tfsdk:"access_token_lifespan"`
	RefreshTokenLifespan         types.Int64  `tfsdk:"refresh_token_lifespan"`
	OfflineTokenLifespan         types.Int64  `tfsdk:"offline_token_lifespan"`
	SMTPHost                     types.String `tfsdk:"smtp_host"`
	SMTPPort                     types.Int64  `tfsdk:"smtp_port"`
	SMTPUser                     types.String `tfsdk:"smtp_user"`
	SMTPPassword                 types.String `tfsdk:"smtp_password"`
	SMTPFrom                     types.String `tfsdk:"smtp_from"`
	SMTPSecure                   types.Bool   `tfsdk:"smtp_secure"`
	PasswordMinLength            types.Int64  `tfsdk:"password_min_length"`
	PasswordRequireUppercase     types.Bool   `tfsdk:"password_require_uppercase"`
	PasswordRequireLowercase     types.Bool   `tfsdk:"password_require_lowercase"`
	PasswordRequireDigits        types.Bool   `tfsdk:"password_require_digits"`
	PasswordRequireSpecial      types.Bool   `tfsdk:"password_require_special"`
	PasswordHistoryCount         types.Int64  `tfsdk:"password_history_count"`
	PasswordMaxAgeDays           types.Int64  `tfsdk:"password_max_age_days"`
	BruteForceEnabled            types.Bool   `tfsdk:"brute_force_enabled"`
	MaxLoginFailures             types.Int64  `tfsdk:"max_login_failures"`
	LockoutDuration              types.Int64  `tfsdk:"lockout_duration"`
	FailureResetTime             types.Int64  `tfsdk:"failure_reset_time"`
	PermanentLockoutAfter        types.Int64  `tfsdk:"permanent_lockout_after"`
	RegistrationAllowed          types.Bool   `tfsdk:"registration_allowed"`
	RequireEmailVerification     types.Bool   `tfsdk:"require_email_verification"`
	MFARequired                  types.Bool   `tfsdk:"mfa_required"`
	EventsEnabled                types.Bool   `tfsdk:"events_enabled"`
	EventsExpiration             types.Int64  `tfsdk:"events_expiration"`
	AdminEventsEnabled           types.Bool   `tfsdk:"admin_events_enabled"`
	RateLimitEnabled             types.Bool   `tfsdk:"rate_limit_enabled"`
	ClientRateLimitPerMinute     types.Int64  `tfsdk:"client_rate_limit_per_minute"`
	ClientRateLimitPerHour       types.Int64  `tfsdk:"client_rate_limit_per_hour"`
	UserRateLimitPerMinute       types.Int64  `tfsdk:"user_rate_limit_per_minute"`
	UserRateLimitPerHour         types.Int64  `tfsdk:"user_rate_limit_per_hour"`
	IPRateLimitPerMinute         types.Int64  `tfsdk:"ip_rate_limit_per_minute"`
	IPRateLimitPerHour           types.Int64  `tfsdk:"ip_rate_limit_per_hour"`
	MaxSessionsPerUser          types.Int64  `tfsdk:"max_sessions_per_user"`
	ThemeName                    types.String `tfsdk:"theme_name"`
	LoginTheme                   types.String `tfsdk:"login_theme"`
	AccountTheme                 types.String `tfsdk:"account_theme"`
	EmailTheme                   types.String `tfsdk:"email_theme"`
	ImpersonationEnabled         types.Bool   `tfsdk:"impersonation_enabled"`
	ImpersonationMaxDuration     types.Int64  `tfsdk:"impersonation_max_duration"`
	WebAuthnEnabled              types.Bool   `tfsdk:"webauthn_enabled"`
	WebAuthnRpName               types.String `tfsdk:"webauthn_rp_name"`
	WebAuthnRpID                types.String `tfsdk:"webauthn_rp_id"`
	AdaptiveAuthEnabled         types.Bool   `tfsdk:"adaptive_auth_enabled"`
	RiskThresholdStepUp          types.Int64  `tfsdk:"risk_threshold_step_up"`
	RiskThresholdBlock           types.Int64  `tfsdk:"risk_threshold_block"`
	DefaultLocale                types.String `tfsdk:"default_locale"`
	SupportedLocales            types.List   `tfsdk:"supported_locales"`
	TermsOfServiceURL            types.String `tfsdk:"terms_of_service_url"`
	RegistrationApprovalRequired types.Bool   `tfsdk:"registration_approval_required"`
	AllowedEmailDomains         types.List   `tfsdk:"allowed_email_domains"`
	CreatedAt                   types.String `tfsdk:"created_at"`
	UpdatedAt                   types.String `tfsdk:"updated_at"`
}

// NewRealmResource creates a new realm resource
func NewRealmResource() resource.Resource {
	return &RealmResource{}
}

// Metadata returns the resource metadata (name)
func (r *RealmResource) Metadata(ctx context.Context, req resource.MetadataRequest, resp *resource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_realm"
}

// Schema returns the resource schema
func (r *RealmResource) Schema(ctx context.Context, req resource.SchemaRequest, resp *resource.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "Manages an AuthMe realm. This resource allows you to create, update, and delete realms.",

		Attributes: map[string]schema.Attribute{
			"id": schema.StringAttribute{
				MarkdownDescription: "Unique identifier for the realm (computed)",
				Computed:           true,
			},
			"name": schema.StringAttribute{
				MarkdownDescription: "Unique name of the realm",
				Required:            true,
				PlanModifiers: []planmodifier.String{
					planmodifier.RequiresReplace(),
				},
				Validators: []validator.String{
					stringvalidator.LengthAtLeast(1),
				},
			},
			"display_name": schema.StringAttribute{
				MarkdownDescription: "Display name of the realm",
				Optional:           true,
			},
			"enabled": schema.BoolAttribute{
				MarkdownDescription: "Whether the realm is enabled",
				Optional:           true,
				Computed:           true,
			},
			"access_token_lifespan": schema.Int64Attribute{
				MarkdownDescription: "Access token lifespan in seconds",
				Optional:           true,
				Computed:           true,
			},
			"refresh_token_lifespan": schema.Int64Attribute{
				MarkdownDescription: "Refresh token lifespan in seconds",
				Optional:           true,
				Computed:           true,
			},
			"offline_token_lifespan": schema.Int64Attribute{
				MarkdownDescription: "Offline token lifespan in seconds",
				Optional:           true,
				Computed:           true,
			},
			// SMTP settings
			"smtp_host": schema.StringAttribute{
				MarkdownDescription: "SMTP host",
				Optional:           true,
			},
			"smtp_port": schema.Int64Attribute{
				MarkdownDescription: "SMTP port",
				Optional:           true,
			},
			"smtp_user": schema.StringAttribute{
				MarkdownDescription: "SMTP username",
				Optional:           true,
			},
			"smtp_password": schema.StringAttribute{
				MarkdownDescription: "SMTP password (sensitive)",
				Optional:           true,
				Sensitive:          true,
			},
			"smtp_from": schema.StringAttribute{
				MarkdownDescription: "SMTP from address",
				Optional:           true,
			},
			"smtp_secure": schema.BoolAttribute{
				MarkdownDescription: "Whether to use SMTP over TLS/SSL",
				Optional:           true,
				Computed:           true,
			},
			// Password settings
			"password_min_length": schema.Int64Attribute{
				MarkdownDescription: "Minimum password length",
				Optional:           true,
			},
			"password_require_uppercase": schema.BoolAttribute{
				MarkdownDescription: "Require uppercase characters in passwords",
				Optional:           true,
			},
			"password_require_lowercase": schema.BoolAttribute{
				MarkdownDescription: "Require lowercase characters in passwords",
				Optional:           true,
			},
			"password_require_digits": schema.BoolAttribute{
				MarkdownDescription: "Require digits in passwords",
				Optional:           true,
			},
			"password_require_special": schema.BoolAttribute{
				MarkdownDescription: "Require special characters in passwords",
				Optional:           true,
			},
			"password_history_count": schema.Int64Attribute{
				MarkdownDescription: "Number of previous passwords to remember",
				Optional:           true,
			},
			"password_max_age_days": schema.Int64Attribute{
				MarkdownDescription: "Maximum password age in days",
				Optional:           true,
			},
			// Brute force protection
			"brute_force_enabled": schema.BoolAttribute{
				MarkdownDescription: "Whether brute force protection is enabled",
				Optional:           true,
				Computed:           true,
			},
			"max_login_failures": schema.Int64Attribute{
				MarkdownDescription: "Maximum login failures before lockout",
				Optional:           true,
			},
			"lockout_duration": schema.Int64Attribute{
				MarkdownDescription: "Lockout duration in minutes",
				Optional:           true,
			},
			"failure_reset_time": schema.Int64Attribute{
				MarkdownDescription: "Time in minutes before failure count resets",
				Optional:           true,
			},
			"permanent_lockout_after": schema.Int64Attribute{
				MarkdownDescription: "Number of permanent lockouts before permanent ban",
				Optional:           true,
			},
			// Registration settings
			"registration_allowed": schema.BoolAttribute{
				MarkdownDescription: "Whether user registration is allowed",
				Optional:           true,
				Computed:           true,
			},
			"require_email_verification": schema.BoolAttribute{
				MarkdownDescription: "Whether email verification is required",
				Optional:           true,
				Computed:           true,
			},
			"mfa_required": schema.BoolAttribute{
				MarkdownDescription: "Whether multi-factor authentication is required",
				Optional:           true,
				Computed:           true,
			},
			// Event settings
			"events_enabled": schema.BoolAttribute{
				MarkdownDescription: "Whether events are enabled",
				Optional:           true,
				Computed:           true,
			},
			"events_expiration": schema.Int64Attribute{
				MarkdownDescription: "Event expiration time in seconds",
				Optional:           true,
			},
			"admin_events_enabled": schema.BoolAttribute{
				MarkdownDescription: "Whether admin events are enabled",
				Optional:           true,
				Computed:           true,
			},
			// Rate limiting
			"rate_limit_enabled": schema.BoolAttribute{
				MarkdownDescription: "Whether rate limiting is enabled",
				Optional:           true,
				Computed:           true,
			},
			"client_rate_limit_per_minute": schema.Int64Attribute{
				MarkdownDescription: "Client rate limit per minute",
				Optional:           true,
			},
			"client_rate_limit_per_hour": schema.Int64Attribute{
				MarkdownDescription: "Client rate limit per hour",
				Optional:           true,
			},
			"user_rate_limit_per_minute": schema.Int64Attribute{
				MarkdownDescription: "User rate limit per minute",
				Optional:           true,
			},
			"user_rate_limit_per_hour": schema.Int64Attribute{
				MarkdownDescription: "User rate limit per hour",
				Optional:           true,
			},
			"ip_rate_limit_per_minute": schema.Int64Attribute{
				MarkdownDescription: "IP rate limit per minute",
				Optional:           true,
			},
			"ip_rate_limit_per_hour": schema.Int64Attribute{
				MarkdownDescription: "IP rate limit per hour",
				Optional:           true,
			},
			// Session settings
			"max_sessions_per_user": schema.Int64Attribute{
				MarkdownDescription: "Maximum sessions per user",
				Optional:           true,
			},
			// Theme settings
			"theme_name": schema.StringAttribute{
				MarkdownDescription: "Name of the theme",
				Optional:           true,
			},
			"login_theme": schema.StringAttribute{
				MarkdownDescription: "Login page theme",
				Optional:           true,
			},
			"account_theme": schema.StringAttribute{
				MarkdownDescription: "Account page theme",
				Optional:           true,
			},
			"email_theme": schema.StringAttribute{
				MarkdownDescription: "Email template theme",
				Optional:           true,
			},
			// Impersonation settings
			"impersonation_enabled": schema.BoolAttribute{
				MarkdownDescription: "Whether impersonation is enabled",
				Optional:           true,
				Computed:           true,
			},
			"impersonation_max_duration": schema.Int64Attribute{
				MarkdownDescription: "Maximum impersonation duration in minutes",
				Optional:           true,
			},
			// WebAuthn settings
			"webauthn_enabled": schema.BoolAttribute{
				MarkdownDescription: "Whether WebAuthn/passkeys are enabled",
				Optional:           true,
				Computed:           true,
			},
			"webauthn_rp_name": schema.StringAttribute{
				MarkdownDescription: "WebAuthn relying party name",
				Optional:           true,
			},
			"webauthn_rp_id": schema.StringAttribute{
				MarkdownDescription: "WebAuthn relying party ID",
				Optional:           true,
			},
			// Adaptive auth settings
			"adaptive_auth_enabled": schema.BoolAttribute{
				MarkdownDescription: "Whether adaptive authentication is enabled",
				Optional:           true,
				Computed:           true,
			},
			"risk_threshold_step_up": schema.Int64Attribute{
				MarkdownDescription: "Risk threshold for step-up authentication",
				Optional:           true,
			},
			"risk_threshold_block": schema.Int64Attribute{
				MarkdownDescription: "Risk threshold for blocking",
				Optional:           true,
			},
			// Locale settings
			"default_locale": schema.StringAttribute{
				MarkdownDescription: "Default locale",
				Optional:           true,
			},
			"supported_locales": schema.ListAttribute{
				MarkdownDescription: "List of supported locales",
				Optional:           true,
				ElementType:        types.StringType,
			},
			// Legal / registration controls
			"terms_of_service_url": schema.StringAttribute{
				MarkdownDescription: "Terms of service URL",
				Optional:           true,
			},
			"registration_approval_required": schema.BoolAttribute{
				MarkdownDescription: "Whether registration requires approval",
				Optional:           true,
				Computed:           true,
			},
			"allowed_email_domains": schema.ListAttribute{
				MarkdownDescription: "List of allowed email domains",
				Optional:           true,
				ElementType:        types.StringType,
			},
			// Timestamps
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

// Configure configures the resource
func (r *RealmResource) Configure(ctx context.Context, req resource.ConfigureRequest, resp *resource.ConfigureResponse) {
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

// Create creates the realm resource
func (r *RealmResource) Create(ctx context.Context, req resource.CreateRequest, resp *resource.CreateResponse) {
	tflog.Debug(ctx, "Creating realm resource")

	// Get the plan from the config
	var plan RealmResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	// Build the create request
	createReq := client.CreateRealmRequest{
		Name: plan.Name.ValueString(),
	}

	// Map optional fields from the plan
	mapRealmPlanToCreateRequest(ctx, plan, &createReq)

	// Create the realms client and call the API
	realmsClient := client.NewRealmsClient(r.httpClient)

	realm, err := realmsClient.CreateRealm(ctx, createReq)
	if err != nil {
		resp.Diagnostics.AddError(
			"Error Creating Realm",
			fmt.Sprintf("Unable to create realm %s: %v", plan.Name.ValueString(), err),
		)
		return
	}

	// Map the response to the Terraform state
	var state RealmResourceModel
	mapRealmToState(ctx, realm, &state)

	// Set the state
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	tflog.Debug(ctx, "Realm created successfully", map[string]interface{}{
		"name": realm.Name,
		"id":   realm.ID,
	})
}

// Read reads the realm resource
func (r *RealmResource) Read(ctx context.Context, req resource.ReadRequest, resp *resource.ReadResponse) {
	tflog.Debug(ctx, "Reading realm resource")

	// Get the current state
	var state RealmResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	realmName := state.Name.ValueString()
	if realmName == "" {
		resp.Diagnostics.AddError(
			"Invalid State",
			"Realm name is required in state",
		)
		return
	}

	// Create the realms client and fetch the realm
	realmsClient := client.NewRealmsClient(r.httpClient)

	realm, err := realmsClient.GetRealm(ctx, realmName)
	if err != nil {
		// Check if the realm was deleted
		resp.Diagnostics.AddError(
			"Error Reading Realm",
			fmt.Sprintf("Unable to read realm %s: %v", realmName, err),
		)
		return
	}

	// Map the response to the Terraform state
	mapRealmToState(ctx, realm, &state)

	// Set the state
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	tflog.Debug(ctx, "Realm read successfully", map[string]interface{}{
		"name": realm.Name,
		"id":   realm.ID,
	})
}

// Update updates the realm resource
func (r *RealmResource) Update(ctx context.Context, req resource.UpdateRequest, resp *resource.UpdateResponse) {
	tflog.Debug(ctx, "Updating realm resource")

	// Get the plan from the config
	var plan RealmResourceModel
	resp.Diagnostics.Append(req.Plan.Get(ctx, &plan)...)
	if resp.Diagnostics.HasError() {
		return
	}

	// Get the current state to get the realm name
	var state RealmResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	realmName := state.Name.ValueString()

	// Build the update request
	updateReq := client.UpdateRealmRequest{}

	// Map optional fields from the plan
	mapRealmPlanToUpdateRequest(ctx, plan, &updateReq)

	// Create the realms client and call the API
	realmsClient := client.NewRealmsClient(r.httpClient)

	realm, err := realmsClient.UpdateRealm(ctx, realmName, updateReq)
	if err != nil {
		resp.Diagnostics.AddError(
			"Error Updating Realm",
			fmt.Sprintf("Unable to update realm %s: %v", realmName, err),
		)
		return
	}

	// Map the response to the Terraform state
	var newState RealmResourceModel
	mapRealmToState(ctx, realm, &newState)

	// Set the state
	resp.Diagnostics.Append(resp.State.Set(ctx, &newState)...)
	if resp.Diagnostics.HasError() {
		return
	}

	tflog.Debug(ctx, "Realm updated successfully", map[string]interface{}{
		"name": realm.Name,
		"id":   realm.ID,
	})
}

// Delete deletes the realm resource
func (r *RealmResource) Delete(ctx context.Context, req resource.DeleteRequest, resp *resource.DeleteResponse) {
	tflog.Debug(ctx, "Deleting realm resource")

	// Get the current state
	var state RealmResourceModel
	resp.Diagnostics.Append(req.State.Get(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	realmName := state.Name.ValueString()
	if realmName == "" {
		resp.Diagnostics.AddError(
			"Invalid State",
			"Realm name is required in state",
		)
		return
	}

	// Create the realms client and delete the realm
	realmsClient := client.NewRealmsClient(r.httpClient)

	err := realmsClient.DeleteRealm(ctx, realmName)
	if err != nil {
		resp.Diagnostics.AddError(
			"Error Deleting Realm",
			fmt.Sprintf("Unable to delete realm %s: %v", realmName, err),
		)
		return
	}

	tflog.Debug(ctx, "Realm deleted successfully", map[string]interface{}{
		"name": realmName,
	})
}

// ImportState imports the realm resource state
func (r *RealmResource) ImportState(ctx context.Context, req resource.ImportStateRequest, resp *resource.ImportStateResponse) {
	// The import ID is the realm name
	realmName := req.ID
	if realmName == "" {
		resp.Diagnostics.AddError(
			"Invalid Import ID",
			"Import ID must be the realm name",
		)
		return
	}

	// Fetch the realm to ensure it exists and get its data
	realmsClient := client.NewRealmsClient(r.httpClient)

	realm, err := realmsClient.GetRealm(ctx, realmName)
	if err != nil {
		resp.Diagnostics.AddError(
			"Error Importing Realm",
			fmt.Sprintf("Unable to import realm %s: %v", realmName, err),
		)
		return
	}

	// Map the realm to the state
	var state RealmResourceModel
	mapRealmToState(ctx, realm, &state)

	// Set the state with the import ID
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	// Add the import state ID
	resource.ImportStatePassthroughID(ctx, resource.DefaultsPath("name"), req, resp)

	tflog.Debug(ctx, "Realm imported successfully", map[string]interface{}{
		"name": realm.Name,
		"id":   realm.ID,
	})
}

// mapRealmPlanToCreateRequest maps the Terraform plan to the create request
func mapRealmPlanToCreateRequest(ctx context.Context, plan RealmResourceModel, req *client.CreateRealmRequest) {
	if !plan.DisplayName.IsNull() {
		req.DisplayName = plan.DisplayName.ValueString()
	}

	if !plan.Enabled.IsNull() {
		enabled := plan.Enabled.ValueBool()
		req.Enabled = &enabled
	}

	if !plan.AccessTokenLifespan.IsNull() {
		req.AccessTokenLifespan = int(plan.AccessTokenLifespan.ValueInt64())
	}

	if !plan.RefreshTokenLifespan.IsNull() {
		req.RefreshTokenLifespan = int(plan.RefreshTokenLifespan.ValueInt64())
	}

	if !plan.OfflineTokenLifespan.IsNull() {
		req.OfflineTokenLifespan = int(plan.OfflineTokenLifespan.ValueInt64())
	}

	// SMTP settings
	if !plan.SMTPHost.IsNull() {
		req.SMTPHost = plan.SMTPHost.ValueString()
	}
	if !plan.SMTPPort.IsNull() {
		req.SMTPPort = int(plan.SMTPPort.ValueInt64())
	}
	if !plan.SMTPUser.IsNull() {
		req.SMTPUser = plan.SMTPUser.ValueString()
	}
	if !plan.SMTPPassword.IsNull() && plan.SMTPPassword.ValueString() != "" {
		req.SMTPPassword = plan.SMTPPassword.ValueString()
	}
	if !plan.SMTPFrom.IsNull() {
		req.SMTPFrom = plan.SMTPFrom.ValueString()
	}
	if !plan.SMTPSecure.IsNull() {
		secure := plan.SMTPSecure.ValueBool()
		req.SMTPSecure = &secure
	}

	// Password settings
	if !plan.PasswordMinLength.IsNull() {
		req.PasswordMinLength = int(plan.PasswordMinLength.ValueInt64())
	}
	if !plan.PasswordRequireUppercase.IsNull() {
		val := plan.PasswordRequireUppercase.ValueBool()
		req.PasswordRequireUppercase = &val
	}
	if !plan.PasswordRequireLowercase.IsNull() {
		val := plan.PasswordRequireLowercase.ValueBool()
		req.PasswordRequireLowercase = &val
	}
	if !plan.PasswordRequireDigits.IsNull() {
		val := plan.PasswordRequireDigits.ValueBool()
		req.PasswordRequireDigits = &val
	}
	if !plan.PasswordRequireSpecial.IsNull() {
		val := plan.PasswordRequireSpecial.ValueBool()
		req.PasswordRequireSpecialChars = &val
	}
	if !plan.PasswordHistoryCount.IsNull() {
		req.PasswordHistoryCount = int(plan.PasswordHistoryCount.ValueInt64())
	}
	if !plan.PasswordMaxAgeDays.IsNull() {
		req.PasswordMaxAgeDays = int(plan.PasswordMaxAgeDays.ValueInt64())
	}

	// Brute force protection
	if !plan.BruteForceEnabled.IsNull() {
		val := plan.BruteForceEnabled.ValueBool()
		req.BruteForceEnabled = &val
	}
	if !plan.MaxLoginFailures.IsNull() {
		req.MaxLoginFailures = int(plan.MaxLoginFailures.ValueInt64())
	}
	if !plan.LockoutDuration.IsNull() {
		req.LockoutDuration = int(plan.LockoutDuration.ValueInt64())
	}
	if !plan.FailureResetTime.IsNull() {
		req.FailureResetTime = int(plan.FailureResetTime.ValueInt64())
	}
	if !plan.PermanentLockoutAfter.IsNull() {
		req.PermanentLockoutAfter = int(plan.PermanentLockoutAfter.ValueInt64())
	}

	// Registration settings
	if !plan.RegistrationAllowed.IsNull() {
		val := plan.RegistrationAllowed.ValueBool()
		req.RegistrationAllowed = &val
	}
	if !plan.RequireEmailVerification.IsNull() {
		val := plan.RequireEmailVerification.ValueBool()
		req.RequireEmailVerification = &val
	}
	if !plan.MFARequired.IsNull() {
		val := plan.MFARequired.ValueBool()
		req.MFARequired = &val
	}

	// Event settings
	if !plan.EventsEnabled.IsNull() {
		val := plan.EventsEnabled.ValueBool()
		req.EventsEnabled = &val
	}
	if !plan.EventsExpiration.IsNull() {
		req.EventsExpiration = int(plan.EventsExpiration.ValueInt64())
	}
	if !plan.AdminEventsEnabled.IsNull() {
		val := plan.AdminEventsEnabled.ValueBool()
		req.AdminEventsEnabled = &val
	}

	// Rate limiting
	if !plan.RateLimitEnabled.IsNull() {
		val := plan.RateLimitEnabled.ValueBool()
		req.RateLimitEnabled = &val
	}
	if !plan.ClientRateLimitPerMinute.IsNull() {
		req.ClientRateLimitPerMinute = int(plan.ClientRateLimitPerMinute.ValueInt64())
	}
	if !plan.ClientRateLimitPerHour.IsNull() {
		req.ClientRateLimitPerHour = int(plan.ClientRateLimitPerHour.ValueInt64())
	}
	if !plan.UserRateLimitPerMinute.IsNull() {
		req.UserRateLimitPerMinute = int(plan.UserRateLimitPerMinute.ValueInt64())
	}
	if !plan.UserRateLimitPerHour.IsNull() {
		req.UserRateLimitPerHour = int(plan.UserRateLimitPerHour.ValueInt64())
	}
	if !plan.IPRateLimitPerMinute.IsNull() {
		req.IPRateLimitPerMinute = int(plan.IPRateLimitPerMinute.ValueInt64())
	}
	if !plan.IPRateLimitPerHour.IsNull() {
		req.IPRateLimitPerHour = int(plan.IPRateLimitPerHour.ValueInt64())
	}

	// Session management
	if !plan.MaxSessionsPerUser.IsNull() {
		req.MaxSessionsPerUser = int(plan.MaxSessionsPerUser.ValueInt64())
	}

	// Theme settings
	if !plan.ThemeName.IsNull() {
		req.ThemeName = plan.ThemeName.ValueString()
	}
	if !plan.LoginTheme.IsNull() {
		req.LoginTheme = plan.LoginTheme.ValueString()
	}
	if !plan.AccountTheme.IsNull() {
		req.AccountTheme = plan.AccountTheme.ValueString()
	}
	if !plan.EmailTheme.IsNull() {
		req.EmailTheme = plan.EmailTheme.ValueString()
	}

	// Impersonation
	if !plan.ImpersonationEnabled.IsNull() {
		val := plan.ImpersonationEnabled.ValueBool()
		req.ImpersonationEnabled = &val
	}
	if !plan.ImpersonationMaxDuration.IsNull() {
		req.ImpersonationMaxDuration = int(plan.ImpersonationMaxDuration.ValueInt64())
	}

	// WebAuthn
	if !plan.WebAuthnEnabled.IsNull() {
		val := plan.WebAuthnEnabled.ValueBool()
		req.WebAuthnEnabled = &val
	}
	if !plan.WebAuthnRpName.IsNull() {
		req.WebAuthnRpName = plan.WebAuthnRpName.ValueString()
	}
	if !plan.WebAuthnRpID.IsNull() {
		req.WebAuthnRpID = plan.WebAuthnRpID.ValueString()
	}

	// Adaptive auth
	if !plan.AdaptiveAuthEnabled.IsNull() {
		val := plan.AdaptiveAuthEnabled.ValueBool()
		req.AdaptiveAuthEnabled = &val
	}
	if !plan.RiskThresholdStepUp.IsNull() {
		req.RiskThresholdStepUp = int(plan.RiskThresholdStepUp.ValueInt64())
	}
	if !plan.RiskThresholdBlock.IsNull() {
		req.RiskThresholdBlock = int(plan.RiskThresholdBlock.ValueInt64())
	}

	// Locale settings
	if !plan.DefaultLocale.IsNull() {
		req.DefaultLocale = plan.DefaultLocale.ValueString()
	}
	if !plan.SupportedLocales.IsNull() {
		var locales []string
		plan.SupportedLocales.ElementsAs(ctx, &locales, false)
		req.SupportedLocales = locales
	}

	// Legal / registration controls
	if !plan.TermsOfServiceURL.IsNull() {
		req.TermsOfServiceURL = plan.TermsOfServiceURL.ValueString()
	}
	if !plan.RegistrationApprovalRequired.IsNull() {
		val := plan.RegistrationApprovalRequired.ValueBool()
		req.RegistrationApprovalRequired = &val
	}
	if !plan.AllowedEmailDomains.IsNull() {
		var domains []string
		plan.AllowedEmailDomains.ElementsAs(ctx, &domains, false)
		req.AllowedEmailDomains = domains
	}
}

// mapRealmPlanToUpdateRequest maps the Terraform plan to the update request
func mapRealmPlanToUpdateRequest(ctx context.Context, plan RealmResourceModel, req *client.UpdateRealmRequest) {
	if !plan.DisplayName.IsNull() {
		req.DisplayName = plan.DisplayName.ValueString()
	}

	if !plan.Enabled.IsNull() {
		enabled := plan.Enabled.ValueBool()
		req.Enabled = &enabled
	}

	if !plan.AccessTokenLifespan.IsNull() {
		req.AccessTokenLifespan = int(plan.AccessTokenLifespan.ValueInt64())
	}

	if !plan.RefreshTokenLifespan.IsNull() {
		req.RefreshTokenLifespan = int(plan.RefreshTokenLifespan.ValueInt64())
	}

	if !plan.OfflineTokenLifespan.IsNull() {
		req.OfflineTokenLifespan = int(plan.OfflineTokenLifespan.ValueInt64())
	}

	// SMTP settings
	if !plan.SMTPHost.IsNull() {
		req.SMTPHost = plan.SMTPHost.ValueString()
	}
	if !plan.SMTPPort.IsNull() {
		req.SMTPPort = int(plan.SMTPPort.ValueInt64())
	}
	if !plan.SMTPUser.IsNull() {
		req.SMTPUser = plan.SMTPUser.ValueString()
	}
	if !plan.SMTPPassword.IsNull() && plan.SMTPPassword.ValueString() != "" {
		req.SMTPPassword = plan.SMTPPassword.ValueString()
	}
	if !plan.SMTPFrom.IsNull() {
		req.SMTPFrom = plan.SMTPFrom.ValueString()
	}
	if !plan.SMTPSecure.IsNull() {
		secure := plan.SMTPSecure.ValueBool()
		req.SMTPSecure = &secure
	}

	// Password settings
	if !plan.PasswordMinLength.IsNull() {
		req.PasswordMinLength = int(plan.PasswordMinLength.ValueInt64())
	}
	if !plan.PasswordRequireUppercase.IsNull() {
		val := plan.PasswordRequireUppercase.ValueBool()
		req.PasswordRequireUppercase = &val
	}
	if !plan.PasswordRequireLowercase.IsNull() {
		val := plan.PasswordRequireLowercase.ValueBool()
		req.PasswordRequireLowercase = &val
	}
	if !plan.PasswordRequireDigits.IsNull() {
		val := plan.PasswordRequireDigits.ValueBool()
		req.PasswordRequireDigits = &val
	}
	if !plan.PasswordRequireSpecial.IsNull() {
		val := plan.PasswordRequireSpecial.ValueBool()
		req.PasswordRequireSpecialChars = &val
	}
	if !plan.PasswordHistoryCount.IsNull() {
		req.PasswordHistoryCount = int(plan.PasswordHistoryCount.ValueInt64())
	}
	if !plan.PasswordMaxAgeDays.IsNull() {
		req.PasswordMaxAgeDays = int(plan.PasswordMaxAgeDays.ValueInt64())
	}

	// Brute force protection
	if !plan.BruteForceEnabled.IsNull() {
		val := plan.BruteForceEnabled.ValueBool()
		req.BruteForceEnabled = &val
	}
	if !plan.MaxLoginFailures.IsNull() {
		req.MaxLoginFailures = int(plan.MaxLoginFailures.ValueInt64())
	}
	if !plan.LockoutDuration.IsNull() {
		req.LockoutDuration = int(plan.LockoutDuration.ValueInt64())
	}
	if !plan.FailureResetTime.IsNull() {
		req.FailureResetTime = int(plan.FailureResetTime.ValueInt64())
	}
	if !plan.PermanentLockoutAfter.IsNull() {
		req.PermanentLockoutAfter = int(plan.PermanentLockoutAfter.ValueInt64())
	}

	// Registration settings
	if !plan.RegistrationAllowed.IsNull() {
		val := plan.RegistrationAllowed.ValueBool()
		req.RegistrationAllowed = &val
	}
	if !plan.RequireEmailVerification.IsNull() {
		val := plan.RequireEmailVerification.ValueBool()
		req.RequireEmailVerification = &val
	}
	if !plan.MFARequired.IsNull() {
		val := plan.MFARequired.ValueBool()
		req.MFARequired = &val
	}

	// Event settings
	if !plan.EventsEnabled.IsNull() {
		val := plan.EventsEnabled.ValueBool()
		req.EventsEnabled = &val
	}
	if !plan.EventsExpiration.IsNull() {
		req.EventsExpiration = int(plan.EventsExpiration.ValueInt64())
	}
	if !plan.AdminEventsEnabled.IsNull() {
		val := plan.AdminEventsEnabled.ValueBool()
		req.AdminEventsEnabled = &val
	}

	// Rate limiting
	if !plan.RateLimitEnabled.IsNull() {
		val := plan.RateLimitEnabled.ValueBool()
		req.RateLimitEnabled = &val
	}
	if !plan.ClientRateLimitPerMinute.IsNull() {
		req.ClientRateLimitPerMinute = int(plan.ClientRateLimitPerMinute.ValueInt64())
	}
	if !plan.ClientRateLimitPerHour.IsNull() {
		req.ClientRateLimitPerHour = int(plan.ClientRateLimitPerHour.ValueInt64())
	}
	if !plan.UserRateLimitPerMinute.IsNull() {
		req.UserRateLimitPerMinute = int(plan.UserRateLimitPerMinute.ValueInt64())
	}
	if !plan.UserRateLimitPerHour.IsNull() {
		req.UserRateLimitPerHour = int(plan.UserRateLimitPerHour.ValueInt64())
	}
	if !plan.IPRateLimitPerMinute.IsNull() {
		req.IPRateLimitPerMinute = int(plan.IPRateLimitPerMinute.ValueInt64())
	}
	if !plan.IPRateLimitPerHour.IsNull() {
		req.IPRateLimitPerHour = int(plan.IPRateLimitPerHour.ValueInt64())
	}

	// Session management
	if !plan.MaxSessionsPerUser.IsNull() {
		req.MaxSessionsPerUser = int(plan.MaxSessionsPerUser.ValueInt64())
	}

	// Theme settings
	if !plan.ThemeName.IsNull() {
		req.ThemeName = plan.ThemeName.ValueString()
	}
	if !plan.LoginTheme.IsNull() {
		req.LoginTheme = plan.LoginTheme.ValueString()
	}
	if !plan.AccountTheme.IsNull() {
		req.AccountTheme = plan.AccountTheme.ValueString()
	}
	if !plan.EmailTheme.IsNull() {
		req.EmailTheme = plan.EmailTheme.ValueString()
	}

	// Impersonation
	if !plan.ImpersonationEnabled.IsNull() {
		val := plan.ImpersonationEnabled.ValueBool()
		req.ImpersonationEnabled = &val
	}
	if !plan.ImpersonationMaxDuration.IsNull() {
		req.ImpersonationMaxDuration = int(plan.ImpersonationMaxDuration.ValueInt64())
	}

	// WebAuthn
	if !plan.WebAuthnEnabled.IsNull() {
		val := plan.WebAuthnEnabled.ValueBool()
		req.WebAuthnEnabled = &val
	}
	if !plan.WebAuthnRpName.IsNull() {
		req.WebAuthnRpName = plan.WebAuthnRpName.ValueString()
	}
	if !plan.WebAuthnRpID.IsNull() {
		req.WebAuthnRpID = plan.WebAuthnRpID.ValueString()
	}

	// Adaptive auth
	if !plan.AdaptiveAuthEnabled.IsNull() {
		val := plan.AdaptiveAuthEnabled.ValueBool()
		req.AdaptiveAuthEnabled = &val
	}
	if !plan.RiskThresholdStepUp.IsNull() {
		req.RiskThresholdStepUp = int(plan.RiskThresholdStepUp.ValueInt64())
	}
	if !plan.RiskThresholdBlock.IsNull() {
		req.RiskThresholdBlock = int(plan.RiskThresholdBlock.ValueInt64())
	}

	// Locale settings
	if !plan.DefaultLocale.IsNull() {
		req.DefaultLocale = plan.DefaultLocale.ValueString()
	}
	if !plan.SupportedLocales.IsNull() {
		var locales []string
		plan.SupportedLocales.ElementsAs(ctx, &locales, false)
		req.SupportedLocales = locales
	}

	// Legal / registration controls
	if !plan.TermsOfServiceURL.IsNull() {
		req.TermsOfServiceURL = plan.TermsOfServiceURL.ValueString()
	}
	if !plan.RegistrationApprovalRequired.IsNull() {
		val := plan.RegistrationApprovalRequired.ValueBool()
		req.RegistrationApprovalRequired = &val
	}
	if !plan.AllowedEmailDomains.IsNull() {
		var domains []string
		plan.AllowedEmailDomains.ElementsAs(ctx, &domains, false)
		req.AllowedEmailDomains = domains
	}
}

// mapRealmToState maps the API realm response to the Terraform state
func mapRealmToState(ctx context.Context, realm *client.Realm, state *RealmResourceModel) {
	state.ID = types.StringValue(realm.ID)
	state.Name = types.StringValue(realm.Name)
	state.DisplayName = types.StringValue(realm.DisplayName)
	state.Enabled = types.BoolValue(realm.Enabled)
	state.AccessTokenLifespan = types.Int64Value(int64(realm.AccessTokenLifespan))
	state.RefreshTokenLifespan = types.Int64Value(int64(realm.RefreshTokenLifespan))
	state.OfflineTokenLifespan = types.Int64Value(int64(realm.OfflineTokenLifespan))
	state.SMTPHost = types.StringValue(realm.SMTPHost)
	state.SMTPPort = types.Int64Value(int64(realm.SMTPPort))
	state.SMTPUser = types.StringValue(realm.SMTPUser)
	state.SMTPFrom = types.StringValue(realm.SMTPFrom)
	state.SMTPSecure = types.BoolValue(realm.SMTPSecure)
	state.PasswordMinLength = types.Int64Value(int64(realm.PasswordMinLength))
	state.PasswordRequireUppercase = types.BoolValue(realm.PasswordRequireUppercase)
	state.PasswordRequireLowercase = types.BoolValue(realm.PasswordRequireLowercase)
	state.PasswordRequireDigits = types.BoolValue(realm.PasswordRequireDigits)
	state.PasswordRequireSpecial = types.BoolValue(realm.PasswordRequireSpecial)
	state.PasswordHistoryCount = types.Int64Value(int64(realm.PasswordHistoryCount))
	state.PasswordMaxAgeDays = types.Int64Value(int64(realm.PasswordMaxAgeDays))
	state.BruteForceEnabled = types.BoolValue(realm.BruteForceEnabled)
	state.MaxLoginFailures = types.Int64Value(int64(realm.MaxLoginFailures))
	state.LockoutDuration = types.Int64Value(int64(realm.LockoutDuration))
	state.FailureResetTime = types.Int64Value(int64(realm.FailureResetTime))
	state.PermanentLockoutAfter = types.Int64Value(int64(realm.PermanentLockoutAfter))
	state.RegistrationAllowed = types.BoolValue(realm.RegistrationAllowed)
	state.RequireEmailVerification = types.BoolValue(realm.RequireEmailVerification)
	state.MFARequired = types.BoolValue(realm.MFARequired)
	state.EventsEnabled = types.BoolValue(realm.EventsEnabled)
	state.EventsExpiration = types.Int64Value(int64(realm.EventsExpiration))
	state.AdminEventsEnabled = types.BoolValue(realm.AdminEventsEnabled)
	state.RateLimitEnabled = types.BoolValue(realm.RateLimitEnabled)
	state.ClientRateLimitPerMinute = types.Int64Value(int64(realm.ClientRateLimitPerMinute))
	state.ClientRateLimitPerHour = types.Int64Value(int64(realm.ClientRateLimitPerHour))
	state.UserRateLimitPerMinute = types.Int64Value(int64(realm.UserRateLimitPerMinute))
	state.UserRateLimitPerHour = types.Int64Value(int64(realm.UserRateLimitPerHour))
	state.IPRateLimitPerMinute = types.Int64Value(int64(realm.IPRateLimitPerMinute))
	state.IPRateLimitPerHour = types.Int64Value(int64(realm.IPRateLimitPerHour))
	state.MaxSessionsPerUser = types.Int64Value(int64(realm.MaxSessionsPerUser))
	state.ThemeName = types.StringValue(realm.ThemeName)
	state.LoginTheme = types.StringValue(realm.LoginTheme)
	state.AccountTheme = types.StringValue(realm.AccountTheme)
	state.EmailTheme = types.StringValue(realm.EmailTheme)
	state.ImpersonationEnabled = types.BoolValue(realm.ImpersonationEnabled)
	state.ImpersonationMaxDuration = types.Int64Value(int64(realm.ImpersonationMaxDuration))
	state.WebAuthnEnabled = types.BoolValue(realm.WebAuthnEnabled)
	state.WebAuthnRpName = types.StringValue(realm.WebAuthnRpName)
	state.WebAuthnRpID = types.StringValue(realm.WebAuthnRpID)
	state.AdaptiveAuthEnabled = types.BoolValue(realm.AdaptiveAuthEnabled)
	state.RiskThresholdStepUp = types.Int64Value(int64(realm.RiskThresholdStepUp))
	state.RiskThresholdBlock = types.Int64Value(int64(realm.RiskThresholdBlock))
	state.DefaultLocale = types.StringValue(realm.DefaultLocale)
	state.TermsOfServiceURL = types.StringValue(realm.TermsOfServiceURL)
	state.RegistrationApprovalRequired = types.BoolValue(realm.RegistrationApprovalRequired)
	state.CreatedAt = types.StringValue(realm.CreatedAt)
	state.UpdatedAt = types.StringValue(realm.UpdatedAt)

	// Handle list types
	if len(realm.SupportedLocales) > 0 {
		locales, diag := types.ListValueFrom(ctx, types.StringType, realm.SupportedLocales)
		if !diag.HasError() {
			state.SupportedLocales = locales
		}
	}

	if len(realm.AllowedEmailDomains) > 0 {
		domains, diag := types.ListValueFrom(ctx, types.StringType, realm.AllowedEmailDomains)
		if !diag.HasError() {
			state.AllowedEmailDomains = domains
		}
	}
}