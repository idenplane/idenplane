# Idenplane Terraform Provider Configuration
#
# This example demonstrates how to configure the Idenplane Terraform provider.
# Replace the values with your actual Idenplane instance configuration.
#
# Documentation: https://docs.idenplane.io/terraform-provider

terraform {
  required_version = ">= 1.0.0"

  required_providers {
    idenplane = {
      source  = "idenplane/idenplane"
      version = "~> 0.1.0"
    }
  }
}

# Provider configuration - choose one of the authentication methods below

# Option 1: Admin Credentials Authentication
# Uses the master realm admin user credentials to authenticate.
provider "idenplane" {
  base_url    = "http://localhost:3000"  # Idenplane server URL
  auth_method = "admin_credentials"      # Authentication method
  admin_user  = "admin"                 # Admin username
  admin_pass  = "your-admin-password"   # Admin password
  realm       = "master"                # Target realm
}

# Option 2: API Key Authentication
# Uses an API key for authentication (if configured in Idenplane).
# Uncomment and use this instead of admin credentials if you prefer API keys.
#
# provider "idenplane" {
#   base_url    = "http://localhost:3000"
#   auth_method = "api_key"
#   api_key     = "your-api-key"
#   realm       = "your-realm"
# }

# Option 3: OAuth Client Credentials
# Uses OAuth 2.0 client credentials for authentication.
# Uncomment and use this for service-to-service authentication.
#
# provider "idenplane" {
#   base_url       = "http://localhost:3000"
#   auth_method   = "client_credentials"
#   client_id     = "your-client-id"
#   client_secret = "your-client-secret"
#   realm         = "your-realm"
# }

# Example: Creating a Realm
resource "idenplane_realm" "example" {
  name         = "example-realm"
  display_name = "Example Realm"
  enabled      = true

  # Access token settings
  access_token_lifespan    = 300
  refresh_token_lifespan   = 1800

  # Password policy
  password_min_length              = 12
  password_require_uppercase       = true
  password_require_lowercase       = true
  password_require_digits          = true
  password_require_special_chars   = true
  password_history_count           = 5
  password_max_age_days            = 90

  # Brute force protection
  brute_force_enabled  = true
  max_login_failures    = 5
  lockout_duration      = 900

  # Registration settings
  registration_allowed              = true
  require_email_verification         = true
  registration_approval_required     = false

  # Allowed email domains (optional)
  # allowed_email_domains = ["example.com", "trusted.com"]

  # MFA settings
  mfa_required          = false
  webauthn_enabled      = false

  # Security events
  events_enabled        = true
  events_expiration     = 604800  # 7 days
  admin_events_enabled  = true

  # Theming
  theme_name    = "idenplane"
  default_locale = "en"

  # Legal
  # terms_of_service_url = "https://example.com/terms"
}

# Example: Creating an OAuth Client
resource "idenplane_client" "example" {
  realm_id  = idenplane_realm.example.name
  client_id = "example-app"
  name      = "Example Application"
  enabled   = true

  # Client configuration
  description         = "Example OAuth client application"
  direct_access       = false
  public_client       = false
  standard_flow       = true
  implicit_flow       = false
  service_accounts    = true

  # Redirect URIs for OAuth flows
  redirect_uris = [
    "http://localhost:3000/callback",
    "https://app.example.com/callback"
  ]

  # Web origins for CORS
  web_origins = [
    "http://localhost:3000",
    "https://app.example.com"
  ]

  # Token settings
  access_token_lifespan     = 300
  access_token_lifespan_for_implicit_flow = 900
  sso_session_idle_timeout  = 1800
  sso_session_max_lifespan  = 36000

  # Logout settings
  frontchannel_logout   = true
  backchannel_logout    = true
}

# Example: Creating a Role
resource "idenplane_role" "example" {
  realm_id   = idenplane_realm.example.name
  name       = "example-role"
  description = "An example role for demonstration"

  # Role attributes (optional)
  # attributes = {
  #   "department" = "engineering"
  #   "level"      = "senior"
  # }
}

# Example: Creating a Group
resource "idenplane_group" "example" {
  realm_id = idenplane_realm.example.name
  name     = "example-group"
  path     = "/example-group"
  # Optional parent group (uncomment if needed)
  # parent_id = idenplane_group.parent.name

  # Group attributes (optional)
  # attributes = {
  #   "division" = "platform"
  # }
}

# Example: Creating an Identity Provider (OIDC)
resource "idenplane_identity_provider" "google" {
  realm_id    = idenplane_realm.example.name
  alias       = "google"
  provider_id = "oidc"
  enabled     = true
  display_name = "Google"

  # OIDC Configuration
  config = {
    client_id     = "your-google-client-id"
    client_secret = "your-google-client-secret"

    # Discovery endpoint (preferred) or individual endpoints
    discovery_endpoint = "https://accounts.google.com/.well-known/openid-configuration"

    # Or specify individual endpoints:
    # issuer                    = "https://accounts.google.com"
    # authorization_url         = "https://accounts.google.com/o/oauth2/v2/auth"
    # token_url                 = "https://oauth2.googleapis.com/token"
    # userinfo_url              = "https://openidconnect.googleapis.com/v1/userinfo"
    # jwks_url                  = "https://www.googleapis.com/oauth2/v3/certs"

    # Scopes to request
    default_scopes = "openid profile email"

    # Trust email verification
    trust_email = true

    # Store tokens for offline access
    store_tokens = true
  }
}

# Example: Creating an Identity Provider (SAML)
# Uncomment when using SAML
# resource "idenplane_identity_provider" "okta" {
#   realm_id    = idenplane_realm.example.name
#   alias       = "okta"
#   provider_id = "saml"
#   enabled     = true
#   display_name = "Okta SSO"
#
#   config = {
#     entity_id          = "https://your-app.example.com/saml"
#     single_sign_on_service_url = "https://your-org.okta.com/app/..."
#     single_logout_service_url  = "https://your-org.okta.com/..."
#     want_authn_requests_signed = true
#     want_assertions_signed     = true
#     want_assertions_encrypted  = false
#
#     # X509 Certificate (base64 encoded)
#     # certificate = "MIIC..."
#
#     # Metadata URL (alternative to certificate)
#     # metadata_endpoint = "https://your-org.okta.com/.../metadata"
#
#     name_id_policy_format = "persistent"
#   }
# }

# Data sources for reading existing resources

# Example: Reading an existing realm
# data "idenplane_realm" "existing" {
#   id = "existing-realm-name"
# }

# Example: Reading an existing client
# data "idenplane_client" "existing" {
#   realm_id = idenplane_realm.example.name
#   client_id = "existing-client-id"
# }

# Example: Reading an existing role
# data "idenplane_role" "existing" {
#   realm_id = idenplane_realm.example.name
#   name     = "existing-role-name"
# }

# Example: Reading an existing group
# data "idenplane_group" "existing" {
#   realm_id = idenplane_realm.example.name
#   name     = "existing-group-name"
# }

# Example: Reading an existing identity provider
# data "idenplane_identity_provider" "existing" {
#   realm_id = idenplane_realm.example.name
#   alias    = "existing-idp-alias"
# }

# Output values for integration with other Terraform configurations
# output "realm_id" {
#   value = idenplane_realm.example.name
# }
#
# output "client_id" {
#   value = idenplane_client.example.client_id
#   sensitive = true
# }