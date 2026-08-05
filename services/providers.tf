terraform {
  required_version = ">= 1.5.0"

  required_providers {
    neon = {
      source  = "kislerdm/neon"
      version = "~> 0.6"
    }
    vercel = {
      source  = "vercel/vercel"
      version = "~> 4.8"
    }
  }

  # Local state only (D-8). Migrate to a remote backend before shared apply.
}

provider "neon" {
  # Authenticates via NEON_API_KEY (services/.env).
}

provider "vercel" {
  # Authenticates via VERCEL_API_TOKEN (services/.env).
  # Optional team: set TF_VAR_vercel_team_id or leave empty for a personal account.
}
