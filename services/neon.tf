# Public Neon project — never a branch of the personal project (ADR-0009 / R-8).
resource "neon_project" "public" {
  name       = var.neon_project_name
  org_id     = var.neon_org_id
  region_id  = var.neon_region
  pg_version = 16

  # Free-plan max PITR window.
  history_retention_seconds = 21600

  branch {
    name          = "production"
    database_name = "email_triager"
    role_name     = "email_triager_owner"
  }

  default_endpoint_settings {
    autoscaling_limit_min_cu = 0.25
    autoscaling_limit_max_cu = 1.0
  }
}
