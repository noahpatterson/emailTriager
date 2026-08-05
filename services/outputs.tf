output "neon_project_id" {
  description = "Public Neon project id (not the personal project)."
  value       = neon_project.public.id
}

output "DATABASE_URL" {
  description = "Pooled connection URI for the app (DATABASE_DRIVER=pg)."
  value       = neon_project.public.connection_uri_pooler
  sensitive   = true
}

output "DATABASE_URL_UNPOOLED" {
  description = "Direct connection URI for migrations / drizzle-kit."
  value       = neon_project.public.connection_uri
  sensitive   = true
}

output "vercel_project_id" {
  value = vercel_project.app.id
}

output "health_url" {
  description = "Unauthenticated health probe after the first deploy."
  value       = "${local.app_origin}/api/health"
}
