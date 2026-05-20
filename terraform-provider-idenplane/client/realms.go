// Package client provides HTTP client functionality for Idenplane API communication
package client

import (
	"context"
	"fmt"
)

// Realm represents a realm in the Idenplane API
type Realm struct {
	ID                       string   `json:"id"`
	Name                     string   `json:"name"`
	DisplayName              string   `json:"displayName,omitempty"`
	Enabled                  bool     `json:"enabled,omitempty"`
	AccessTokenLifespan      int      `json:"accessTokenLifespan,omitempty"`
	RefreshTokenLifespan     int      `json:"refreshTokenLifespan,omitempty"`
	SMTPHost                 string   `json:"smtpHost,omitempty"`
	SMTPPort                 int      `json:"smtpPort,omitempty"`
	SMTPUser                 string   `json:"smtpUser,omitempty"`
	SMTPPassword             string   `json:"smtpPassword,omitempty"`
	SMTPFrom                 string   `json:"smtpFrom,omitempty"`
	SMTPSecure               bool     `json:"smtpSecure,omitempty"`
	PasswordMinLength        int      `json:"passwordMinLength,omitempty"`
	PasswordRequireUppercase bool     `json:"passwordRequireUppercase,omitempty"`
	PasswordRequireLowercase bool     `json:"passwordRequireLowercase,omitempty"`
	PasswordRequireDigits    bool     `json:"passwordRequireDigits,omitempty"`
	PasswordRequireSpecial   bool     `json:"passwordRequireSpecialChars,omitempty"`
	PasswordHistoryCount     int      `json:"passwordHistoryCount,omitempty"`
	PasswordMaxAgeDays       int      `json:"passwordMaxAgeDays,omitempty"`
	BruteForceEnabled        bool     `json:"bruteForceEnabled,omitempty"`
	MaxLoginFailures         int      `json:"maxLoginFailures,omitempty"`
	LockoutDuration          int      `json:"lockoutDuration,omitempty"`
	FailureResetTime         int      `json:"failureResetTime,omitempty"`
	PermanentLockoutAfter    int      `json:"permanentLockoutAfter,omitempty"`
	RegistrationAllowed      bool     `json:"registrationAllowed,omitempty"`
	RequireEmailVerification bool    `json:"requireEmailVerification,omitempty"`
	 MFARequired             bool     `json:"mfaRequired,omitempty"`
	OfflineTokenLifespan     int      `json:"offlineTokenLifespan,omitempty"`
	EventsEnabled            bool     `json:"eventsEnabled,omitempty"`
	EventsExpiration         int      `json:"eventsExpiration,omitempty"`
	AdminEventsEnabled       bool     `json:"adminEventsEnabled,omitempty"`
	// Rate limiting
	RateLimitEnabled        bool `json:"rateLimitEnabled,omitempty"`
	ClientRateLimitPerMinute int  `json:"clientRateLimitPerMinute,omitempty"`
	ClientRateLimitPerHour   int  `json:"clientRateLimitPerHour,omitempty"`
	UserRateLimitPerMinute   int  `json:"userRateLimitPerMinute,omitempty"`
	UserRateLimitPerHour     int  `json:"userRateLimitPerHour,omitempty"`
	IPRateLimitPerMinute     int  `json:"ipRateLimitPerMinute,omitempty"`
	IPRateLimitPerHour       int  `json:"ipRateLimitPerHour,omitempty"`
	// Session management
	MaxSessionsPerUser int `json:"maxSessionsPerUser,omitempty"`
	// Theming
	ThemeName   string                 `json:"themeName,omitempty"`
	Theme       map[string]interface{} `json:"theme,omitempty"`
	LoginTheme  string                 `json:"loginTheme,omitempty"`
	AccountTheme string                `json:"accountTheme,omitempty"`
	EmailTheme  string                 `json:"emailTheme,omitempty"`
	// Impersonation
	ImpersonationEnabled   bool `json:"impersonationEnabled,omitempty"`
	ImpersonationMaxDuration int `json:"impersonationMaxDuration,omitempty"`
	// WebAuthn / passkeys
	WebAuthnEnabled bool   `json:"webAuthnEnabled,omitempty"`
	WebAuthnRpName  string `json:"webAuthnRpName,omitempty"`
	WebAuthnRpID    string `json:"webAuthnRpId,omitempty"`
	// Adaptive authentication
	AdaptiveAuthEnabled  bool `json:"adaptiveAuthEnabled,omitempty"`
	RiskThresholdStepUp  int  `json:"riskThresholdStepUp,omitempty"`
	RiskThresholdBlock    int  `json:"riskThresholdBlock,omitempty"`
	// Localisation
	DefaultLocale     string   `json:"defaultLocale,omitempty"`
	SupportedLocales  []string `json:"supportedLocales,omitempty"`
	// Legal / registration controls
	TermsOfServiceURL          string   `json:"termsOfServiceUrl,omitempty"`
	RegistrationApprovalRequired bool   `json:"registrationApprovalRequired,omitempty"`
	AllowedEmailDomains        []string `json:"allowedEmailDomains,omitempty"`
	// Timestamps
	CreatedAt string `json:"createdAt,omitempty"`
	UpdatedAt string `json:"updatedAt,omitempty"`
}

// CreateRealmRequest represents the request body for creating a realm
type CreateRealmRequest struct {
	Name                          string                 `json:"name"`
	DisplayName                   string                 `json:"displayName,omitempty"`
	Enabled                       *bool                  `json:"enabled,omitempty"`
	AccessTokenLifespan           int                    `json:"accessTokenLifespan,omitempty"`
	RefreshTokenLifespan          int                    `json:"refreshTokenLifespan,omitempty"`
	SMTPHost                      string                 `json:"smtpHost,omitempty"`
	SMTPPort                      int                    `json:"smtpPort,omitempty"`
	SMTPUser                      string                 `json:"smtpUser,omitempty"`
	SMTPPassword                 string                 `json:"smtpPassword,omitempty"`
	SMTPFrom                      string                 `json:"smtpFrom,omitempty"`
	SMTPSecure                    *bool                  `json:"smtpSecure,omitempty"`
	PasswordMinLength             int                    `json:"passwordMinLength,omitempty"`
	PasswordRequireUppercase      *bool                  `json:"passwordRequireUppercase,omitempty"`
	PasswordRequireLowercase       *bool                  `json:"passwordRequireLowercase,omitempty"`
	PasswordRequireDigits          *bool                  `json:"passwordRequireDigits,omitempty"`
	PasswordRequireSpecialChars    *bool                  `json:"passwordRequireSpecialChars,omitempty"`
	PasswordHistoryCount           int                    `json:"passwordHistoryCount,omitempty"`
	PasswordMaxAgeDays             int                    `json:"passwordMaxAgeDays,omitempty"`
	BruteForceEnabled              *bool                  `json:"bruteForceEnabled,omitempty"`
	MaxLoginFailures               int                    `json:"maxLoginFailures,omitempty"`
	LockoutDuration                int                    `json:"lockoutDuration,omitempty"`
	FailureResetTime               int                    `json:"failureResetTime,omitempty"`
	PermanentLockoutAfter          int                    `json:"permanentLockoutAfter,omitempty"`
	RegistrationAllowed           *bool                  `json:"registrationAllowed,omitempty"`
	RequireEmailVerification       *bool                  `json:"requireEmailVerification,omitempty"`
	MFARequired                   *bool                  `json:"mfaRequired,omitempty"`
	OfflineTokenLifespan           int                    `json:"offlineTokenLifespan,omitempty"`
	EventsEnabled                 *bool                  `json:"eventsEnabled,omitempty"`
	EventsExpiration               int                    `json:"eventsExpiration,omitempty"`
	AdminEventsEnabled            *bool                  `json:"adminEventsEnabled,omitempty"`
	// Rate limiting
	RateLimitEnabled        *bool `json:"rateLimitEnabled,omitempty"`
	ClientRateLimitPerMinute int  `json:"clientRateLimitPerMinute,omitempty"`
	ClientRateLimitPerHour   int  `json:"clientRateLimitPerHour,omitempty"`
	UserRateLimitPerMinute   int  `json:"userRateLimitPerMinute,omitempty"`
	UserRateLimitPerHour     int  `json:"userRateLimitPerHour,omitempty"`
	IPRateLimitPerMinute     int  `json:"ipRateLimitPerMinute,omitempty"`
	IPRateLimitPerHour       int  `json:"ipRateLimitPerHour,omitempty"`
	// Session management
	MaxSessionsPerUser int `json:"maxSessionsPerUser,omitempty"`
	// Theming
	ThemeName    string                  `json:"themeName,omitempty"`
	Theme        map[string]interface{} `json:"theme,omitempty"`
	LoginTheme   string                  `json:"loginTheme,omitempty"`
	AccountTheme string                  `json:"accountTheme,omitempty"`
	EmailTheme   string                  `json:"emailTheme,omitempty"`
	// Impersonation
	ImpersonationEnabled    *bool `json:"impersonationEnabled,omitempty"`
	ImpersonationMaxDuration int  `json:"impersonationMaxDuration,omitempty"`
	// WebAuthn / passkeys
	WebAuthnEnabled *bool  `json:"webAuthnEnabled,omitempty"`
	WebAuthnRpName  string `json:"webAuthnRpName,omitempty"`
	WebAuthnRpID    string `json:"webAuthnRpId,omitempty"`
	// Adaptive authentication
	AdaptiveAuthEnabled *bool `json:"adaptiveAuthEnabled,omitempty"`
	RiskThresholdStepUp  int   `json:"riskThresholdStepUp,omitempty"`
	RiskThresholdBlock    int   `json:"riskThresholdBlock,omitempty"`
	// Localisation
	DefaultLocale    string   `json:"defaultLocale,omitempty"`
	SupportedLocales []string `json:"supportedLocales,omitempty"`
	// Legal / registration controls
	TermsOfServiceURL             string   `json:"termsOfServiceUrl,omitempty"`
	RegistrationApprovalRequired *bool    `json:"registrationApprovalRequired,omitempty"`
	AllowedEmailDomains           []string `json:"allowedEmailDomains,omitempty"`
}

// UpdateRealmRequest represents the request body for updating a realm
type UpdateRealmRequest struct {
	DisplayName                   string                 `json:"displayName,omitempty"`
	Enabled                       *bool                  `json:"enabled,omitempty"`
	AccessTokenLifespan           int                    `json:"accessTokenLifespan,omitempty"`
	RefreshTokenLifespan          int                    `json:"refreshTokenLifespan,omitempty"`
	SMTPHost                      string                 `json:"smtpHost,omitempty"`
	SMTPPort                      int                    `json:"smtpPort,omitempty"`
	SMTPUser                      string                 `json:"smtpUser,omitempty"`
	SMTPPassword                 string                 `json:"smtpPassword,omitempty"`
	SMTPFrom                      string                 `json:"smtpFrom,omitempty"`
	SMTPSecure                    *bool                  `json:"smtpSecure,omitempty"`
	PasswordMinLength             int                    `json:"passwordMinLength,omitempty"`
	PasswordRequireUppercase      *bool                  `json:"passwordRequireUppercase,omitempty"`
	PasswordRequireLowercase       *bool                  `json:"passwordRequireLowercase,omitempty"`
	PasswordRequireDigits          *bool                  `json:"passwordRequireDigits,omitempty"`
	PasswordRequireSpecialChars    *bool                  `json:"passwordRequireSpecialChars,omitempty"`
	PasswordHistoryCount           int                    `json:"passwordHistoryCount,omitempty"`
	PasswordMaxAgeDays             int                    `json:"passwordMaxAgeDays,omitempty"`
	BruteForceEnabled              *bool                  `json:"bruteForceEnabled,omitempty"`
	MaxLoginFailures               int                    `json:"maxLoginFailures,omitempty"`
	LockoutDuration                int                    `json:"lockoutDuration,omitempty"`
	FailureResetTime               int                    `json:"failureResetTime,omitempty"`
	PermanentLockoutAfter          int                    `json:"permanentLockoutAfter,omitempty"`
	RegistrationAllowed           *bool                  `json:"registrationAllowed,omitempty"`
	RequireEmailVerification       *bool                  `json:"requireEmailVerification,omitempty"`
	MFARequired                   *bool                  `json:"mfaRequired,omitempty"`
	OfflineTokenLifespan           int                    `json:"offlineTokenLifespan,omitempty"`
	EventsEnabled                 *bool                  `json:"eventsEnabled,omitempty"`
	EventsExpiration               int                    `json:"eventsExpiration,omitempty"`
	AdminEventsEnabled            *bool                  `json:"adminEventsEnabled,omitempty"`
	// Rate limiting
	RateLimitEnabled        *bool `json:"rateLimitEnabled,omitempty"`
	ClientRateLimitPerMinute int  `json:"clientRateLimitPerMinute,omitempty"`
	ClientRateLimitPerHour   int  `json:"clientRateLimitPerHour,omitempty"`
	UserRateLimitPerMinute   int  `json:"userRateLimitPerMinute,omitempty"`
	UserRateLimitPerHour     int  `json:"userRateLimitPerHour,omitempty"`
	IPRateLimitPerMinute     int  `json:"ipRateLimitPerMinute,omitempty"`
	IPRateLimitPerHour       int  `json:"ipRateLimitPerHour,omitempty"`
	// Session management
	MaxSessionsPerUser int `json:"maxSessionsPerUser,omitempty"`
	// Theming
	ThemeName    string                  `json:"themeName,omitempty"`
	Theme        map[string]interface{} `json:"theme,omitempty"`
	LoginTheme   string                  `json:"loginTheme,omitempty"`
	AccountTheme string                  `json:"accountTheme,omitempty"`
	EmailTheme   string                  `json:"emailTheme,omitempty"`
	// Impersonation
	ImpersonationEnabled    *bool `json:"impersonationEnabled,omitempty"`
	ImpersonationMaxDuration int  `json:"impersonationMaxDuration,omitempty"`
	// WebAuthn / passkeys
	WebAuthnEnabled *bool  `json:"webAuthnEnabled,omitempty"`
	WebAuthnRpName  string `json:"webAuthnRpName,omitempty"`
	WebAuthnRpID    string `json:"webAuthnRpId,omitempty"`
	// Adaptive authentication
	AdaptiveAuthEnabled *bool `json:"adaptiveAuthEnabled,omitempty"`
	RiskThresholdStepUp  int   `json:"riskThresholdStepUp,omitempty"`
	RiskThresholdBlock    int   `json:"riskThresholdBlock,omitempty"`
	// Localisation
	DefaultLocale    string   `json:"defaultLocale,omitempty"`
	SupportedLocales []string `json:"supportedLocales,omitempty"`
	// Legal / registration controls
	TermsOfServiceURL             string   `json:"termsOfServiceUrl,omitempty"`
	RegistrationApprovalRequired *bool    `json:"registrationApprovalRequired,omitempty"`
	AllowedEmailDomains           []string `json:"allowedEmailDomains,omitempty"`
}

// Theme represents an available theme
type Theme struct {
	Name        string `json:"name"`
	DisplayName string `json:"displayName,omitempty"`
	Description string `json:"description,omitempty"`
}

// ExportRealmOptions contains options for realm export
type ExportRealmOptions struct {
	IncludeUsers   bool
	IncludeSecrets bool
}

// ImportRealmOptions contains options for realm import
type ImportRealmOptions struct {
	Overwrite bool
}

// SendTestEmailRequest represents the request body for sending a test email
type SendTestEmailRequest struct {
	To string `json:"to"`
}

// RealmsClient provides methods for interacting with Idenplane realms API
type RealmsClient struct {
	httpClient *HTTPClient
}

// NewRealmsClient creates a new RealmsClient
func NewRealmsClient(httpClient *HTTPClient) *RealmsClient {
	return &RealmsClient{
		httpClient: httpClient,
	}
}

// CreateRealm creates a new realm
func (c *RealmsClient) CreateRealm(ctx context.Context, req CreateRealmRequest) (*Realm, error) {
	var realm Realm
	err := c.httpClient.PostJSON(ctx, "/admin/realms", req, nil, &realm)
	if err != nil {
		return nil, fmt.Errorf("failed to create realm: %w", err)
	}
	return &realm, nil
}

// ListRealms returns all realms
func (c *RealmsClient) ListRealms(ctx context.Context) ([]Realm, error) {
	var realms []Realm
	err := c.httpClient.GetJSON(ctx, "/admin/realms", nil, nil, &realms)
	if err != nil {
		return nil, fmt.Errorf("failed to list realms: %w", err)
	}
	return realms, nil
}

// GetRealm returns a realm by name
func (c *RealmsClient) GetRealm(ctx context.Context, realmName string) (*Realm, error) {
	var realm Realm
	path := fmt.Sprintf("/admin/realms/%s", realmName)
	err := c.httpClient.GetJSON(ctx, path, nil, nil, &realm)
	if err != nil {
		return nil, fmt.Errorf("failed to get realm %s: %w", realmName, err)
	}
	return &realm, nil
}

// UpdateRealm updates a realm
func (c *RealmsClient) UpdateRealm(ctx context.Context, realmName string, req UpdateRealmRequest) (*Realm, error) {
	var realm Realm
	path := fmt.Sprintf("/admin/realms/%s", realmName)
	err := c.httpClient.PutJSON(ctx, path, req, &realm)
	if err != nil {
		return nil, fmt.Errorf("failed to update realm %s: %w", realmName, err)
	}
	return &realm, nil
}

// DeleteRealm deletes a realm
func (c *RealmsClient) DeleteRealm(ctx context.Context, realmName string) error {
	path := fmt.Sprintf("/admin/realms/%s", realmName)
	_, err := c.httpClient.Delete(ctx, path, nil)
	if err != nil {
		return fmt.Errorf("failed to delete realm %s: %w", realmName, err)
	}
	return nil
}

// GetThemes returns all available themes
func (c *RealmsClient) GetThemes(ctx context.Context) ([]Theme, error) {
	var themes []Theme
	err := c.httpClient.GetJSON(ctx, "/admin/realms/themes", nil, nil, &themes)
	if err != nil {
		return nil, fmt.Errorf("failed to get themes: %w", err)
	}
	return themes, nil
}

// ExportRealm exports a realm
func (c *RealmsClient) ExportRealm(ctx context.Context, realmName string, opts ExportRealmOptions) (map[string]interface{}, error) {
	query := map[string]string{}
	if opts.IncludeUsers {
		query["includeUsers"] = "true"
	}
	if opts.IncludeSecrets {
		query["includeSecrets"] = "true"
	}

	var exportData map[string]interface{}
	path := fmt.Sprintf("/admin/realms/%s/export", realmName)
	err := c.httpClient.GetJSON(ctx, path, query, nil, &exportData)
	if err != nil {
		return nil, fmt.Errorf("failed to export realm %s: %w", realmName, err)
	}
	return exportData, nil
}

// ImportRealm imports a realm
func (c *RealmsClient) ImportRealm(ctx context.Context, data map[string]interface{}, opts ImportRealmOptions) (*Realm, error) {
	query := map[string]string{}
	if opts.Overwrite {
		query["overwrite"] = "true"
	}

	var realm Realm
	err := c.httpClient.PostJSON(ctx, "/admin/realms/import", data, query, &realm)
	if err != nil {
		return nil, fmt.Errorf("failed to import realm: %w", err)
	}
	return &realm, nil
}

// SendTestEmail sends a test email for a realm
func (c *RealmsClient) SendTestEmail(ctx context.Context, realmName string, req SendTestEmailRequest) error {
	path := fmt.Sprintf("/admin/realms/%s/email/test", realmName)
	_, err := c.httpClient.Post(ctx, path, req, nil)
	if err != nil {
		return fmt.Errorf("failed to send test email for realm %s: %w", realmName, err)
	}
	return nil
}
