variable "neon_org_id" {
  type        = string
  description = "Neon organization id (NEON_ORG_ID). Required so the public project is not created in the wrong org."
}

variable "neon_project_name" {
  type        = string
  description = "Name of the public Neon project (separate from any personal project)."
  default     = "email-triager-public"
}

variable "neon_region" {
  type        = string
  description = "Neon region id."
  default     = "aws-us-east-1"
}

variable "vercel_project_name" {
  type        = string
  description = "Vercel project name."
  default     = "email-triager"
}

variable "vercel_team_id" {
  type        = string
  description = "Optional Vercel team id. Empty means personal account."
  default     = ""
}

variable "github_repo" {
  type        = string
  description = "GitHub repo connected to Vercel (owner/name)."
  default     = "noahpatterson/emailTriager"
}

variable "placeholder_token_encryption_key" {
  type        = string
  description = "Placeholder TOKEN_ENCRYPTION_KEY_V1 for the spike (replace before real OAuth)."
  default     = "spike-placeholder-token-encryption-key-v1"
  sensitive   = true
}

variable "placeholder_neon_auth_cookie_secret" {
  type        = string
  description = "Placeholder NEON_AUTH_COOKIE_SECRET for the spike."
  default     = "spike-placeholder-neon-auth-cookie-secret-32b"
  sensitive   = true
}

variable "allowed_cidrs" {
  type        = string
  description = "Comma-separated IPv4 addresses/CIDRs allowed to reach the Vercel app (pages + /api). Example: 203.0.113.10 or 203.0.113.0/24"
  default     = ""
}

variable "enable_vercel_trusted_ips" {
  type        = bool
  description = "Also enable Vercel platform Trusted IPs (requires a plan that includes Trusted IPs). App-level ALLOWED_CIDRS still applies."
  default     = false
}
