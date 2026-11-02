variable "project_name" {
  type    = string
  default = "email-triager-personal"
}

variable "team_id" {
  type    = string
  default = ""
}

variable "gmail_writes_enabled" {
  type    = bool
  default = false
}

variable "external_ai_enabled" {
  type    = bool
  default = false
}

resource "vercel_project" "personal" {
  name                         = var.project_name
  framework                    = "nextjs"
  team_id                      = var.team_id == "" ? null : var.team_id
  preview_deployments_disabled = true
  git_fork_protection          = true
  vercel_authentication = {
    deployment_type = "all_deployments"
  }
}

locals {
  nonsecret_environment = {
    APP_PROFILE                   = "personal"
    DATABASE_DRIVER               = "neon-http"
    PERSONAL_GMAIL_WRITES_ENABLED = tostring(var.gmail_writes_enabled)
    PERSONAL_EXTERNAL_AI_ENABLED  = tostring(var.external_ai_enabled)
    RETENTION_DAYS                = "30"
  }
}

resource "vercel_project_environment_variable" "settings" {
  for_each   = local.nonsecret_environment
  project_id = vercel_project.personal.id
  team_id    = var.team_id == "" ? null : var.team_id
  key        = each.key
  value      = each.value
  target     = each.key == "APP_PROFILE" ? ["production", "preview", "development"] : ["production"]
  sensitive  = false
}

output "project_id" {
  value = vercel_project.personal.id
}
