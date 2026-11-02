terraform {
  required_version = ">= 1.5.0"
  cloud {
    workspaces {
      name = "email-triager-personal"
    }
  }
  required_providers {
    vercel = {
      source  = "vercel/vercel"
      version = "5.1.2"
    }
  }
}

# VERCEL_API_TOKEN is supplied only to the local Terraform process.
provider "vercel" {}
