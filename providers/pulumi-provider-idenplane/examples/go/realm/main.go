package main

/**
 * Pulumi Go example for AuthMe Realm resource
 *
 * This example demonstrates creating and managing an AuthMe realm using Pulumi.
 * Realms are top-level containers for identity and access management configuration.
 *
 * Documentation: https://www.pulumi.com/docs/
 * AuthMe Provider: https://www.pulumi.com/registry/packages/authme/
 */

import (
	"github.com/authme/pulumi-authme/sdk/go/authme"
	"github.com/pulumi/pulumi/sdk/v3/go/pulumi"
)

func main() {
	pulumi.Run(func(ctx *pulumi.Context) error {
		// Create a new realm for a production application
		productionRealm, err := authme.NewRealm(ctx, "production-realm", &authme.RealmArgs{
			Name:        pulumi.String("production"),
			DisplayName: pulumi.String("Production Realm"),
			Enabled:     pulumi.Bool(true),

			// Token lifespans (in seconds)
			AccessTokenLifespan:  pulumi.Int(300),   // 5 minutes
			RefreshTokenLifespan: pulumi.Int(1800),  // 30 minutes

			// Password policies
			PasswordMinLength:         pulumi.Int(12),
			PasswordRequireUppercase:  pulumi.Bool(true),
			PasswordRequireLowercase:  pulumi.Bool(true),
			PasswordRequireDigits:     pulumi.Bool(true),
			PasswordRequireSpecialChars: pulumi.Bool(true),
			PasswordHistoryCount:      pulumi.Int(5),
			PasswordMaxAgeDays:        pulumi.Int(90),

			// Brute force protection
			BruteForceEnabled:  pulumi.Bool(true),
			MaxLoginFailures:    pulumi.Int(5),
			LockoutDuration:     pulumi.Int(900),  // 15 minutes
			FailureResetTime:    pulumi.Int(600), // 10 minutes

			// Registration settings
			RegistrationAllowed:        pulumi.Bool(true),
			RequireEmailVerification:    pulumi.Bool(true),
			RegistrationApprovalRequired: pulumi.Bool(false),
			AllowedEmailDomains: pulumi.StringArray{
				"example.com",
				"company.io",
			},

			// MFA configuration
			MfaRequired: pulumi.Bool(true),

			// SMTP configuration (optional)
			SmtpHost:  pulumi.String("smtp.example.com"),
			SmtpPort:  pulumi.Int(587),
			SmtpUser:  pulumi.String("auth@example.com"),
			SmtpFrom:  pulumi.String("auth@example.com"),
			SmtpSecure: pulumi.Bool(true),

			// Security features
			WebauthnEnabled: pulumi.Bool(true),
			WebauthnRpName:  pulumi.String("AuthMe Production"),
			WebauthnRpId:    pulumi.String("auth.example.com"),

			// Adaptive authentication (AI-powered)
			AdaptiveAuthEnabled: pulumi.Bool(true),
			RiskThresholdStepUp: pulumi.Int(70),
			RiskThresholdBlock:   pulumi.Int(90),

			// Theme configuration
			ThemeName: pulumi.String("authme"),
			Theme: &authme.RealmThemeArgs{
				PrimaryColor:    pulumi.String("#0066cc"),
				BackgroundColor: pulumi.String("#ffffff"),
				LogoUrl:         pulumi.String("https://example.com/logo.png"),
			},

			// Session management
			MaxSessionsPerUser: pulumi.Int(5),

			// Rate limiting
			RateLimitEnabled:        pulumi.Bool(true),
			ClientRateLimitPerMinute: pulumi.Int(60),
			ClientRateLimitPerHour:   pulumi.Int(1000),
			UserRateLimitPerMinute:   pulumi.Int(30),
			UserRateLimitPerHour:     pulumi.Int(500),

			// Localization
			DefaultLocale:     pulumi.String("en"),
			SupportedLocales: pulumi.StringArray{
				"en", "es", "fr", "de",
			},

			// Legal
			TermsOfServiceUrl: pulumi.String("https://example.com/terms"),
		})
		if err != nil {
			return err
		}

		// Export realm information
		ctx.Export("realmName", productionRealm.Name)
		ctx.Export("realmId", productionRealm.ID())
		ctx.Export("realmDisplayName", productionRealm.DisplayName)

		// Example: Create a development realm with relaxed settings
		devRealm, err := authme.NewRealm(ctx, "dev-realm", &authme.RealmArgs{
			Name:        pulumi.String("development"),
			DisplayName: pulumi.String("Development Realm"),
			Enabled:     pulumi.Bool(true),

			// Relaxed security for development
			PasswordMinLength:         pulumi.Int(8),
			PasswordRequireUppercase:  pulumi.Bool(false),
			PasswordRequireLowercase:  pulumi.Bool(false),
			PasswordRequireDigits:     pulumi.Bool(false),
			PasswordRequireSpecialChars: pulumi.Bool(false),

			// Registration open for development
			RegistrationAllowed:     pulumi.Bool(true),
			RequireEmailVerification: pulumi.Bool(false),
			MfaRequired:              pulumi.Bool(false),

			// Less restrictive brute force protection
			BruteForceEnabled: pulumi.Bool(false),

			DefaultLocale: pulumi.String("en"),
		})
		if err != nil {
			return err
		}

		// Export dev realm info
		ctx.Export("devRealmName", devRealm.Name)

		return nil
	})
}