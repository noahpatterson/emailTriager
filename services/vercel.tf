locals {
  app_origin = "https://${var.vercel_project_name}.vercel.app"

  allowed_cidr_list = [
    for cidr in split(",", var.allowed_cidrs) : trimspace(cidr)
    if trimspace(cidr) != ""
  ]

  is_demo = var.deployment_mode == "demo"

  # Rebuild Neon URIs as emailtriager_app (NOBYPASSRLS). Owner URIs bypass RLS and must
  # never be the Vercel runtime DATABASE_URL in demo mode.
  owner_pooler_tail = regex(
    "^[^:]+://[^@]+@(.+)$",
    trimspace(neon_project.public.connection_uri_pooler),
  )[0]
  owner_direct_tail = regex(
    "^[^:]+://[^@]+@(.+)$",
    trimspace(neon_project.public.connection_uri),
  )[0]
  demo_app_pooler_url = format(
    "postgresql://emailtriager_app:%s@%s",
    urlencode(var.demo_app_db_password),
    local.owner_pooler_tail,
  )
  demo_app_direct_url = format(
    "postgresql://emailtriager_app:%s@%s",
    urlencode(var.demo_app_db_password),
    local.owner_direct_tail,
  )

  # Spike: owner pooled URL + IP lock. Demo: app role + open inbound + APP_PROFILE=demo.
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

  demo_env = {
    APP_PROFILE             = "demo"
    DATABASE_URL            = local.demo_app_pooler_url
    DATABASE_URL_UNPOOLED   = local.demo_app_direct_url
    DATABASE_DRIVER         = "pg"
    ALLOWED_CIDRS           = ""
    GOOGLE_CLIENT_ID        = "demo-placeholder-google-client-id"
    GOOGLE_CLIENT_SECRET    = "demo-placeholder-google-client-secret"
    GOOGLE_REDIRECT_URI     = "${local.app_origin}/api/oauth/google/callback"
    TOKEN_ENCRYPTION_KEY_V1 = var.placeholder_token_encryption_key
  }

  app_env = local.is_demo ? local.demo_env : local.spike_env
}

check "allowed_cidrs_required_for_spike" {
  assert {
    condition     = local.is_demo || length(local.allowed_cidr_list) > 0
    error_message = "Spike mode requires TF_VAR_allowed_cidrs (your public IPv4/CIDR). For a public demo set TF_VAR_deployment_mode=demo instead."
  }
}

check "demo_app_password_required" {
  assert {
    condition     = !local.is_demo || length(var.demo_app_db_password) >= 16
    error_message = "Demo mode requires TF_VAR_demo_app_db_password (>=16 characters). Use the same value as CI secret DEMO_APP_DB_PASSWORD for bun run db:migrate:demo."
  }
}

resource "vercel_project" "app" {
  name                         = var.vercel_project_name
  framework                    = "nextjs"
  team_id                      = var.vercel_team_id == "" ? null : var.vercel_team_id
  preview_deployments_disabled = true
  git_fork_protection          = true

  git_repository = {
    type = "github"
    repo = var.github_repo
  }

  # Platform-level lockdown (Pro+ Trusted IPs). Hobby: rely on ALLOWED_CIDRS in proxy.
  # Never enable Trusted IPs for public demo mode.
  trusted_ips = (!local.is_demo && var.enable_vercel_trusted_ips) ? {
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

resource "vercel_project_environment_variable" "app" {
  for_each = local.app_env

  project_id = vercel_project.app.id
  team_id    = var.vercel_team_id == "" ? null : var.vercel_team_id
  key        = each.key
  value      = each.value
  target     = ["production"]
  sensitive  = true
}

# Platform Firewall: deny clients outside TF_VAR_allowed_cidrs (edge, before the app).
# Destroyed when deployment_mode=demo so the project can be public.
# This overwrites the project's firewall config — import first if you already created
# the rule in the UI: terraform import 'vercel_firewall_config.spike[0]' <project_id>
resource "vercel_firewall_config" "spike" {
  count = local.is_demo ? 0 : 1

  project_id = vercel_project.app.id
  team_id    = var.vercel_team_id == "" ? null : var.vercel_team_id
  enabled    = true

  rules {
    rule {
      name        = "Allow operator IPs only"
      description = "Deny requests whose client IP is not in TF_VAR_allowed_cidrs"
      active      = true
      condition_group = [{
        conditions = [{
          type   = "ip_address"
          op     = "ninc"
          values = local.allowed_cidr_list
        }]
      }]
      action = {
        action = "deny"
      }
    }
  }
}
