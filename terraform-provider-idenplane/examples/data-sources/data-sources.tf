# Reading existing objects rather than creating them — useful when Idenplane is
# managed elsewhere and you only need to reference what is already there.

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
  type    = string
  default = "http://localhost:3000"
}

variable "idenplane_api_key" {
  type      = string
  sensitive = true
}

data "idenplane_realm" "existing" {
  name = "example"
}

data "idenplane_client" "existing" {
  client_id = "example-web-app"
}

data "idenplane_role" "admin" {
  realm_id = data.idenplane_realm.existing.name
  name     = "admin"
}

data "idenplane_group" "engineering" {
  realm_id = data.idenplane_realm.existing.name
}

data "idenplane_user" "alice" {
  realm_id = data.idenplane_realm.existing.name
  username = "alice"
}

data "idenplane_auth_flow" "browser" {
  realm_id = data.idenplane_realm.existing.name
  alias    = "browser"
}

# Identity providers are readable but not manageable from Terraform — there is a
# data source and no matching resource. Configure them in the admin console or
# over the Admin API; see /guides/authentication#identity-providers.
data "idenplane_identity_provider" "okta" {
  realm_id = data.idenplane_realm.existing.name
  alias    = "okta"
}

data "idenplane_organization" "acme" {
  realm_id = data.idenplane_realm.existing.name
  slug     = "acme"
}

output "realm_display_name" {
  value = data.idenplane_realm.existing.display_name
}

output "client_redirect_uris" {
  value = data.idenplane_client.existing.redirect_uris
}
