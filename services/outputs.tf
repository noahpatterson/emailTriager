output "neon_project_id" {
  description = "Public Neon project id (not the personal project)."
  value       = neon_project.public.id
}

output "DATABASE_URL" {
  description = "Pooled connection URI wired into Vercel (owner in spike; emailtriager_app in demo)."
  value       = local.app_env.DATABASE_URL
  sensitive   = true
}

output "DATABASE_URL_UNPOOLED" {
  description = "Neon owner direct URI for migrations / drizzle-kit / demo:cleanup (always owner, never the app role)."
  value       = neon_project.public.connection_uri
  sensitive   = true
}

output "deployment_mode" {
  value = var.deployment_mode
}

output "vercel_project_id" {
  value = vercel_project.app.id
}

output "health_url" {
  description = "Unauthenticated health probe after the first deploy."
  value       = "${local.app_origin}/api/health"
}
