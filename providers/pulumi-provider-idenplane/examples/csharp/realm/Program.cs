/*
 * Pulumi C# example for Idenplane Realm resource
 *
 * This example demonstrates creating and managing an Idenplane realm using Pulumi.
 * Realms are top-level containers for identity and access management configuration.
 *
 * Documentation: https://www.pulumi.com/docs/
 * Idenplane Provider: https://www.pulumi.com/registry/packages/idenplane/
 */

using System;
using System.Collections.Generic;
using Pulumi;
using Idenplane.PulumiIdenplane;

return await Deployment.RunAsync(() =>
{
    // Create a new realm for a production application
    var productionRealm = new Realm("production-realm", new RealmArgs
    {
        Name = "production",
        DisplayName = "Production Realm",
        Enabled = true,

        // Token lifespans (in seconds)
        AccessTokenLifespan = 300,       // 5 minutes
        RefreshTokenLifespan = 1800,     // 30 minutes

        // Password policies
        PasswordMinLength = 12,
        PasswordRequireUppercase = true,
        PasswordRequireLowercase = true,
        PasswordRequireDigits = true,
        PasswordRequireSpecialChars = true,
        PasswordHistoryCount = 5,
        PasswordMaxAgeDays = 90,

        // Brute force protection
        BruteForceEnabled = true,
        MaxLoginFailures = 5,
        LockoutDuration = 900,            // 15 minutes
        FailureResetTime = 600,           // 10 minutes

        // Registration settings
        RegistrationAllowed = true,
        RequireEmailVerification = true,
        RegistrationApprovalRequired = false,
        AllowedEmailDomains = new[]
        {
            "example.com",
            "company.io"
        },

        // MFA configuration
        MfaRequired = true,

        // SMTP configuration (optional)
        SmtpHost = "smtp.example.com",
        SmtpPort = 587,
        SmtpUser = "auth@example.com",
        SmtpFrom = "auth@example.com",
        SmtpSecure = true,

        // Security features
        WebauthnEnabled = true,
        WebauthnRpName = "Idenplane Production",
        WebauthnRpId = "auth.example.com",

        // Adaptive authentication (AI-powered)
        AdaptiveAuthEnabled = true,
        RiskThresholdStepUp = 70,
        RiskThresholdBlock = 90,

        // Theme configuration
        ThemeName = "idenplane",
        Theme = new RealmThemeArgs
        {
            PrimaryColor = "#0066cc",
            BackgroundColor = "#ffffff",
            LogoUrl = "https://example.com/logo.png"
        },

        // Session management
        MaxSessionsPerUser = 5,

        // Rate limiting
        RateLimitEnabled = true,
        ClientRateLimitPerMinute = 60,
        ClientRateLimitPerHour = 1000,
        UserRateLimitPerMinute = 30,
        UserRateLimitPerHour = 500,

        // Localization
        DefaultLocale = "en",
        SupportedLocales = new[]
        {
            "en", "es", "fr", "de"
        },

        // Legal
        TermsOfServiceUrl = "https://example.com/terms"
    });

    // Export realm information using Pulumi context
    ctx.Export("realmName", productionRealm.Name);
    ctx.Export("realmId", productionRealm.Id);
    ctx.Export("realmDisplayName", productionRealm.DisplayName);

    // Example: Create a development realm with relaxed settings
    var devRealm = new Realm("dev-realm", new RealmArgs
    {
        Name = "development",
        DisplayName = "Development Realm",
        Enabled = true,

        // Relaxed security for development
        PasswordMinLength = 8,
        PasswordRequireUppercase = false,
        PasswordRequireLowercase = false,
        PasswordRequireDigits = false,
        PasswordRequireSpecialChars = false,

        // Registration open for development
        RegistrationAllowed = true,
        RequireEmailVerification = false,
        MfaRequired = false,

        // Less restrictive brute force protection
        BruteForceEnabled = false,

        DefaultLocale = "en"
    });

    // Export dev realm info
    ctx.Export("devRealmName", devRealm.Name);
});