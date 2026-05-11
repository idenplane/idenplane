// Package provider implements the Terraform provider for AuthMe
package provider

import (
	"context"
	"fmt"

	"github.com/authme/terraform-provider-authme/client"
	"github.com/hashicorp/terraform-plugin-framework/datasource"
	"github.com/hashicorp/terraform-plugin-framework/datasource/schema"
	"github.com/hashicorp/terraform-plugin-framework/types"
	"github.com/hashicorp/terraform-plugin-log/tflog"
)

// Ensure the implementation satisfies the expected interfaces
var (
	_ datasource.DataSource = &RealmDataSource{}
)

// RealmDataSource implements the realm data source
type RealmDataSource struct {
	// httpClient is the internal HTTP client
	httpClient *client.HTTPClient
}

// RealmDataSourceModel represents the Terraform model for realm data source
type RealmDataSourceModel struct {
	ID                         types.String `tfsdk:"id"`
	Name                       types.String `tfsdk:"name"`
	DisplayName                types.String `tfsdk:"display_name"`
	Enabled                    types.Bool   `tfsdk:"enabled"`
	AccessTokenLifespan        types.Int64  `tfsdk:"access_token_lifespan"`
	RefreshTokenLifespan       types.Int64  `tfsdk:"refresh_token_lifespan"`
	OfflineTokenLifespan       types.Int64  `tfsdk:"offline_token_lifespan"`
	SMTPHost                   types.String `tfsdk:"smtp_host"`
	SMTPPort                   types.Int64  `tfsdk:"smtp_port"`
	SMTPUser                   types.String `tfsdk:"smtp_user"`
	SMTPFrom                   types.String `tfsdk:"smtp_from"`
	SMTPSecure                 types.Bool   `tfsdk:"smtp_secure"`
	PasswordMinLength          types.Int64  `tfsdk:"password_min_length"`
	PasswordRequireUppercase   types.Bool   `tfsdk:"password_require_uppercase"`
	PasswordRequireLowercase   types.Bool   `tfsdk:"password_require_lowercase"`
	PasswordRequireDigits      types.Bool   `tfsdk:"password_require_digits"`
	PasswordRequireSpecial     types.Bool   `tfsdk:"password_require_special"`
	PasswordHistoryCount        types.Int64  `tfsdk:"password_history_count"`
	PasswordMaxAgeDays         types.Int64  `tfsdk:"password_max_age_days"`
	BruteForceEnabled          types.Bool   `tfsdk:"brute_force_enabled"`
	MaxLoginFailures           types.Int64  `tfsdk:"max_login_failures"`
	LockoutDuration            types.Int64  `tfsdk:"lockout_duration"`
	FailureResetTime           types.Int64  `tfsdk:"failure_reset_time"`
	PermanentLockoutAfter      types.Int64  `tfsdk:"permanent_lockout_after"`
	RegistrationAllowed        types.Bool   `tfsdk:"registration_allowed"`
	RequireEmailVerification   types.Bool   `tfsdk:"require_email_verification"`
	MFARequired                types.Bool   `tfsdk:"mfa_required"`
	EventsEnabled              types.Bool   `tfsdk:"events_enabled"`
	EventsExpiration           types.Int64  `tfsdk:"events_expiration"`
	AdminEventsEnabled         types.Bool   `tfsdk:"admin_events_enabled"`
	RateLimitEnabled           types.Bool   `tfsdk:"rate_limit_enabled"`
	ClientRateLimitPerMinute   types.Int64  `tfsdk:"client_rate_limit_per_minute"`
	ClientRateLimitPerHour     types.Int64  `tfsdk:"client_rate_limit_per_hour"`
	UserRateLimitPerMinute     types.Int64  `tfsdk:"user_rate_limit_per_minute"`
	UserRateLimitPerHour       types.Int64  `tfsdk:"user_rate_limit_per_hour"`
	IPRateLimitPerMinute       types.Int64  `tfsdk:"ip_rate_limit_per_minute"`
	IPRateLimitPerHour         types.Int64  `tfsdk:"ip_rate_limit_per_hour"`
	MaxSessionsPerUser         types.Int64  `tfsdk:"max_sessions_per_user"`
	ThemeName                  types.String `tfsdk:"theme_name"`
	LoginTheme                 types.String `tfsdk:"login_theme"`
	AccountTheme               types.String `tfsdk:"account_theme"`
	EmailTheme                 types.String `tfsdk:"email_theme"`
	ImpersonationEnabled       types.Bool   `tfsdk:"impersonation_enabled"`
	ImpersonationMaxDuration   types.Int64  `tfsdk:"impersonation_max_duration"`
	WebAuthnEnabled            types.Bool   `tfsdk:"webauthn_enabled"`
	WebAuthnRpName              types.String `tfsdk:"webauthn_rp_name"`
	WebAuthnRpID               types.String `tfsdk:"webauthn_rp_id"`
	AdaptiveAuthEnabled        types.Bool   `tfsdk:"adaptive_auth_enabled"`
	RiskThresholdStepUp        types.Int64  `tfsdk:"risk_threshold_step_up"`
	RiskThresholdBlock         types.Int64  `tfsdk:"risk_threshold_block"`
	DefaultLocale              types.String `tfsdk:"default_locale"`
	SupportedLocales           types.List   `tfsdk:"supported_locales"`
	TermsOfServiceURL          types.String `tfsdk:"terms_of_service_url"`
	RegistrationApprovalRequired types.Bool `tfsdk:"registration_approval_required"`
	AllowedEmailDomains        types.List   `tfsdk:"allowed_email_domains"`
	CreatedAt                  types.String `tfsdk:"created_at"`
	UpdatedAt                  types.String `tfsdk:"updated_at"`
}

// NewRealmDataSource creates a new realm data source
func NewRealmDataSource() datasource.DataSource {
	return &RealmDataSource{}
}

// Metadata returns the data source metadata (name)
func (d *RealmDataSource) Metadata(ctx context.Context, req datasource.MetadataRequest, resp *datasource.MetadataResponse) {
	resp.TypeName = req.ProviderTypeName + "_realm"
}

// Schema returns the data source schema
func (d *RealmDataSource) Schema(ctx context.Context, req datasource.SchemaRequest, resp *datasource.SchemaResponse) {
	resp.Schema = schema.Schema{
		MarkdownDescription: "Provides information about an AuthMe realm. This data source allows you to " +
			"read existing realms without managing them as Terraform resources.",

		Attributes: map[string]schema.Attribute{
			"id": schema.StringAttribute{
				MarkdownDescription: "Unique identifier for the realm",
				Computed:             true,
			},
			"name": schema.StringAttribute{
				MarkdownDescription: "Unique name of the realm",
				Required:             true,
			},
			"display_name": schema.StringAttribute{
				MarkdownDescription: "Display name of the realm",
				Computed:             true,
			},
			"enabled": schema.BoolAttribute{
				MarkdownDescription: "Whether the realm is enabled",
				Computed:             true,
			},
			"access_token_lifespan": schema.Int64Attribute{
				MarkdownDescription: "Access token lifespan in seconds",
				Computed:             true,
			},
			"refresh_token_lifespan": schema.Int64Attribute{
				MarkdownDescription: "Refresh token lifespan in seconds",
				Computed:             true,
			},
			"offline_token_lifespan": schema.Int64Attribute{
				MarkdownDescription: "Offline token lifespan in seconds",
				Computed:             true,
			},
			// SMTP settings
			"smtp_host": schema.StringAttribute{
				MarkdownDescription: "SMTP host",
				Computed:             true,
			},
			"smtp_port": schema.Int64Attribute{
				MarkdownDescription: "SMTP port",
				Computed:             true,
			},
			"smtp_user": schema.StringAttribute{
				MarkdownDescription: "SMTP username",
				Computed:             true,
			},
			"smtp_from": schema.StringAttribute{
				MarkdownDescription: "SMTP from address",
				Computed:             true,
			},
			"smtp_secure": schema.BoolAttribute{
				MarkdownDescription: "Whether to use SMTP over TLS/SSL",
				Computed:             true,
			},
			// Password settings
			"password_min_length": schema.Int64Attribute{
				MarkdownDescription: "Minimum password length",
				Computed:             true,
			},
			"password_require_uppercase": schema.BoolAttribute{
				MarkdownDescription: "Require uppercase characters in passwords",
				Computed:             true,
			},
			"password_require_lowercase": schema.BoolAttribute{
				MarkdownDescription: "Require lowercase characters in passwords",
				Computed:             true,
			},
			"password_require_digits": schema.BoolAttribute{
				MarkdownDescription: "Require digits in passwords",
				Computed:             true,
			},
			"password_require_special": schema.BoolAttribute{
				MarkdownDescription: "Require special characters in passwords",
				Computed:             true,
			},
			"password_history_count": schema.Int64Attribute{
				MarkdownDescription: "Number of previous passwords to remember",
				Computed:             true,
			},
			"password_max_age_days": schema.Int64Attribute{
				MarkdownDescription: "Maximum password age in days",
				Computed:             true,
			},
			// Brute force protection
			"brute_force_enabled": schema.BoolAttribute{
				MarkdownDescription: "Whether brute force protection is enabled",
				Computed:             true,
			},
			"max_login_failures": schema.Int64Attribute{
				MarkdownDescription: "Maximum login failures before lockout",
				Computed:             true,
			},
			"lockout_duration": schema.Int64Attribute{
				MarkdownDescription: "Lockout duration in minutes",
				Computed:             true,
			},
			"failure_reset_time": schema.Int64Attribute{
				MarkdownDescription: "Time in minutes before failure count resets",
				Computed:             true,
			},
			"permanent_lockout_after": schema.Int64Attribute{
				MarkdownDescription: "Number of permanent lockouts before permanent ban",
				Computed:             true,
			},
			// Registration settings
			"registration_allowed": schema.BoolAttribute{
				MarkdownDescription: "Whether user registration is allowed",
				Computed:             true,
			},
			"require_email_verification": schema.BoolAttribute{
				MarkdownDescription: "Whether email verification is required",
				Computed:             true,
			},
			"mfa_required": schema.BoolAttribute{
				MarkdownDescription: "Whether multi-factor authentication is required",
				Computed:             true,
			},
			// Event settings
			"events_enabled": schema.BoolAttribute{
				MarkdownDescription: "Whether events are enabled",
				Computed:             true,
			},
			"events_expiration": schema.Int64Attribute{
				MarkdownDescription: "Event expiration time in seconds",
				Computed:             true,
			},
			"admin_events_enabled": schema.BoolAttribute{
				MarkdownDescription: "Whether admin events are enabled",
				Computed:             true,
			},
			// Rate limiting
			"rate_limit_enabled": schema.BoolAttribute{
				MarkdownDescription: "Whether rate limiting is enabled",
				Computed:             true,
			},
			"client_rate_limit_per_minute": schema.Int64Attribute{
				MarkdownDescription: "Client rate limit per minute",
				Computed:             true,
			},
			"client_rate_limit_per_hour": schema.Int64Attribute{
				MarkdownDescription: "Client rate limit per hour",
				Computed:             true,
			},
			"user_rate_limit_per_minute": schema.Int64Attribute{
				MarkdownDescription: "User rate limit per minute",
				Computed:             true,
			},
			"user_rate_limit_per_hour": schema.Int64Attribute{
				MarkdownDescription: "User rate limit per hour",
				Computed:             true,
			},
			"ip_rate_limit_per_minute": schema.Int64Attribute{
				MarkdownDescription: "IP rate limit per minute",
				Computed:             true,
			},
			"ip_rate_limit_per_hour": schema.Int64Attribute{
				MarkdownDescription: "IP rate limit per hour",
				Computed:             true,
			},
			// Session settings
			"max_sessions_per_user": schema.Int64Attribute{
				MarkdownDescription: "Maximum sessions per user",
				Computed:             true,
			},
			// Theme settings
			"theme_name": schema.StringAttribute{
				MarkdownDescription: "Name of the theme",
				Computed:             true,
			},
			"login_theme": schema.StringAttribute{
				MarkdownDescription: "Login page theme",
				Computed:             true,
			},
			"account_theme": schema.StringAttribute{
				MarkdownDescription: "Account page theme",
				Computed:             true,
			},
			"email_theme": schema.StringAttribute{
				MarkdownDescription: "Email template theme",
				Computed:             true,
			},
			// Impersonation settings
			"impersonation_enabled": schema.BoolAttribute{
				MarkdownDescription: "Whether impersonation is enabled",
				Computed:             true,
			},
			"impersonation_max_duration": schema.Int64Attribute{
				MarkdownDescription: "Maximum impersonation duration in minutes",
				Computed:             true,
			},
			// WebAuthn settings
			"webauthn_enabled": schema.BoolAttribute{
				MarkdownDescription: "Whether WebAuthn/passkeys are enabled",
				Computed:             true,
			},
			"webauthn_rp_name": schema.StringAttribute{
				MarkdownDescription: "WebAuthn relying party name",
				Computed:             true,
			},
			"webauthn_rp_id": schema.StringAttribute{
				MarkdownDescription: "WebAuthn relying party ID",
				Computed:             true,
			},
			// Adaptive auth settings
			"adaptive_auth_enabled": schema.BoolAttribute{
				MarkdownDescription: "Whether adaptive authentication is enabled",
				Computed:             true,
			},
			"risk_threshold_step_up": schema.Int64Attribute{
				MarkdownDescription: "Risk threshold for step-up authentication",
				Computed:             true,
			},
			"risk_threshold_block": schema.Int64Attribute{
				MarkdownDescription: "Risk threshold for blocking",
				Computed:             true,
			},
			// Locale settings
			"default_locale": schema.StringAttribute{
				MarkdownDescription: "Default locale",
				Computed:             true,
			},
			"supported_locales": schema.ListAttribute{
				MarkdownDescription: "List of supported locales",
				Computed:             true,
				ElementType:          types.StringType,
			},
			// Legal / registration controls
			"terms_of_service_url": schema.StringAttribute{
				MarkdownDescription: "Terms of service URL",
				Computed:             true,
			},
			"registration_approval_required": schema.BoolAttribute{
				MarkdownDescription: "Whether registration requires approval",
				Computed:             true,
			},
			"allowed_email_domains": schema.ListAttribute{
				MarkdownDescription: "List of allowed email domains",
				Computed:             true,
				ElementType:          types.StringType,
			},
			// Timestamps
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
func (d *RealmDataSource) Configure(ctx context.Context, req datasource.ConfigureRequest, resp *datasource.ConfigureResponse) {
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

// Read reads the realm data from the AuthMe API
func (d *RealmDataSource) Read(ctx context.Context, req datasource.ReadRequest, resp *datasource.ReadResponse) {
	tflog.Debug(ctx, "Reading realm data source")

	// Get the realm name from the config
	var config RealmDataSourceModel
	resp.Diagnostics.Append(req.Config.Get(ctx, &config)...)
	if resp.Diagnostics.HasError() {
		return
	}

	realmName := config.Name.ValueString()
	if realmName == "" {
		resp.Diagnostics.AddError(
			"Invalid Configuration",
			"Realm name is required",
		)
		return
	}

	// Create the realms client
	realmsClient := client.NewRealmsClient(d.httpClient)

	// Fetch the realm from the API
	realm, err := realmsClient.GetRealm(ctx, realmName)
	if err != nil {
		resp.Diagnostics.AddError(
			"Error Reading Realm",
			fmt.Sprintf("Unable to read realm %s: %v", realmName, err),
		)
		return
	}

	// Map the realm response to the Terraform model
	var state RealmDataSourceModel
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

	// Set the state
	resp.Diagnostics.Append(resp.State.Set(ctx, &state)...)
	if resp.Diagnostics.HasError() {
		return
	}

	tflog.Debug(ctx, "Realm data source read successfully")
}
