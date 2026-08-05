locals {
  app_origin = "https://${var.vercel_project_name}.vercel.app"

  allowed_cidr_list = [
    for cidr in split(",", var.allowed_cidrs) : trimspace(cidr)
    if trimspace(cidr) != ""
  ]

  # Spike placeholders — real DATABASE_* come from Neon; OAuth/Auth are stubs
  # so getServerConfig() boots without Google Console work on a throwaway deploy.
  spike_env = {
    DATABASE_URL            = neon_project.public.connection_uri_pooler
    DATABASE_URL_UNPOOLED   = neon_project.public.connection_uri
    DATABASE_DRIVER         = "pg"
    ALLOWED_CIDRS           = join(",", local.allowed_cidr_list)
    GOOGLE_CLIENT_ID        = "spike-placeholder-google-client-id"
    GOOGLE_CLIENT_SECRET    = "spike-placeholder-google-client-secret"
    GOOGLE_REDIRECT_URI     = "${local.app_origin}/api/oauth/google/callback"
    NEON_AUTH_BASE_URL      = "https://spike-placeholder.neonauth.example/auth"
    NEON_AUTH_COOKIE_SECRET = var.placeholder_neon_auth_cookie_secret
    OWNER_NEON_AUTH_USER_ID = "spike-placeholder-owner"
    TOKEN_ENCRYPTION_KEY_V1 = var.placeholder_token_encryption_key
  }
}

check "allowed_cidrs_required" {
  assert {
    condition     = length(local.allowed_cidr_list) > 0
    error_message = "Set TF_VAR_allowed_cidrs to at least one IPv4/CIDR (your public IP) before apply."
  }
}

resource "vercel_project" "app" {
  name      = var.vercel_project_name
  framework = "nextjs"
  team_id   = var.vercel_team_id == "" ? null : var.vercel_team_id

  git_repository = {
    type = "github"
    repo = var.github_repo
  }

  # Platform-level lockdown (Pro+ Trusted IPs). Hobby: rely on ALLOWED_CIDRS in proxy.
  trusted_ips = var.enable_vercel_trusted_ips ? {
    deployment_type = "all_deployments"
    protection_mode = "trusted_ip_required"
    addresses = [
      for cidr in local.allowed_cidr_list : {
        value = cidr
        note  = "operator allowlist"
      }
    ]
  } : null
}

resource "vercel_project_environment_variable" "spike" {
  for_each = local.spike_env

  project_id = vercel_project.app.id
  team_id    = var.vercel_team_id == "" ? null : var.vercel_team_id
  key        = each.key
  value      = each.value
  target     = ["production", "preview"]
  sensitive  = true
}
