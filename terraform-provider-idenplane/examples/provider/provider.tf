# Provider configuration.
#
# The provider takes exactly two attributes. There is no auth_method, no admin
# username or password, and no realm at this level — realms are addressed
# per-resource through realm_id.

terraform {
  required_providers {
    idenplane = {
      source  = "idenplane/idenplane"
      version = "~> 0.1"
    }
  }
}

provider "idenplane" {
  url     = "https://auth.example.com"
  api_key = var.idenplane_api_key
}

# Keep the key out of the configuration. Either a variable fed from the
# environment as TF_VAR_idenplane_api_key, or a secrets manager.
variable "idenplane_api_key" {
  description = "Idenplane admin API key"
  type        = string
  sensitive   = true
}
