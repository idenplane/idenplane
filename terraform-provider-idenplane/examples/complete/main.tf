# A realm with a client, roles, a group and a user — enough to sign someone in.
#
# Every attribute here exists in the provider's schema. Anything not shown is
# either computed or simply not implemented yet; the schema in
# provider/resource_*.go is the authority.

terraform {
  required_providers {
    idenplane = {
      source  = "idenplane/idenplane"
      version = "~> 0.1"
    }
  }
}

provider "idenplane" {
  url     = var.idenplane_url
  api_key = var.idenplane_api_key
}

variable "idenplane_url" {
  description = "Idenplane server URL"
  type        = string
  default     = "http://localhost:3000"
}

variable "idenplane_api_key" {
  description = "Idenplane admin API key"
  type        = string
  sensitive   = true
}

# ─── Realm ────────────────────────────────────────────────────────────────────
# `name` is the only required attribute; everything else has a server-side
# default. Shown here are the settings most deployments end up changing.

resource "idenplane_realm" "example" {
  name         = "example"
  display_name = "Example"
  enabled      = true

  # Tokens
  access_token_lifespan  = 300
  refresh_token_lifespan = 1800

  # Password policy
  password_min_length            = 12
  password_require_uppercase     = true
  password_require_lowercase     = true
  password_require_digits        = true
  password_require_special       = true
  password_history_count         = 5
  password_max_age_days          = 90

  # Brute-force protection
  brute_force_enabled = true
  max_login_failures  = 5
  lockout_duration    = 900
  failure_reset_time  = 3600

  # Registration
  registration_allowed           = true
  require_email_verification     = true
  registration_approval_required = false

  # Events
  events_enabled       = true
  events_expiration    = 604800
  admin_events_enabled = true

  # Locale
  default_locale = "en"
}

# ─── Client ───────────────────────────────────────────────────────────────────
# A browser application: public, so it authenticates with PKCE rather than a
# secret. redirect_uris is matched exactly and is a security boundary — anything
# listed can receive an authorization code.

resource "idenplane_client" "web_app" {
  realm_id    = idenplane_realm.example.name
  client_id   = "example-web-app"
  name        = "Example Web App"
  description = "Browser application using the authorization code flow"
  enabled     = true

  client_type = "public"
  grant_types = ["authorization_code", "refresh_token"]

  redirect_uris = ["https://app.example.com/callback"]
  web_origins   = ["https://app.example.com"]

  require_consent = false
}

# A confidential client, for a backend that can hold a secret. client_secret is
# computed — the server issues it, so do not set it here.

resource "idenplane_client" "backend" {
  realm_id  = idenplane_realm.example.name
  client_id = "example-backend"
  name      = "Example Backend"
  enabled   = true

  client_type = "confidential"
  grant_types = ["client_credentials"]
}

# ─── Roles ────────────────────────────────────────────────────────────────────

resource "idenplane_role" "admin" {
  realm_id    = idenplane_realm.example.name
  name        = "admin"
  description = "Full administrative access within the realm"
}

resource "idenplane_role" "viewer" {
  realm_id    = idenplane_realm.example.name
  name        = "viewer"
  description = "Read-only access"
}

# A client role rather than a realm role: scoped to one application. Setting
# client_id is what makes it one — client_role is computed from that, so it is
# read back rather than declared.

resource "idenplane_role" "app_editor" {
  realm_id    = idenplane_realm.example.name
  name        = "editor"
  description = "Can edit content in the web app"
  client_id   = idenplane_client.web_app.client_id
}

# ─── Groups ───────────────────────────────────────────────────────────────────

resource "idenplane_group" "engineering" {
  realm_id    = idenplane_realm.example.name
  name        = "engineering"
  description = "Engineering department"
}

resource "idenplane_group" "platform" {
  realm_id    = idenplane_realm.example.name
  name        = "platform"
  description = "Platform team"
  parent_id   = idenplane_group.engineering.id
}

# ─── User ─────────────────────────────────────────────────────────────────────
# `password` is write-only from Terraform's point of view — it is sent on create
# and never read back, so keep it out of version control.

resource "idenplane_user" "alice" {
  realm_id       = idenplane_realm.example.name
  username       = "alice"
  email          = "alice@example.com"
  first_name     = "Alice"
  last_name      = "Example"
  email_verified = true
  enabled        = true
  password       = var.alice_password
}

variable "alice_password" {
  description = "Initial password for the example user"
  type        = string
  sensitive   = true
}

# ─── Outputs ──────────────────────────────────────────────────────────────────

output "realm_name" {
  description = "Name of the created realm"
  value       = idenplane_realm.example.name
}

output "web_client_id" {
  description = "Client ID to configure in the frontend SDK"
  value       = idenplane_client.web_app.client_id
}

output "backend_client_secret" {
  description = "Secret issued for the confidential client"
  value       = idenplane_client.backend.client_secret
  sensitive   = true
}
