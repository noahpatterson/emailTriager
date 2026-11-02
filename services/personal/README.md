# Personal deployment infrastructure

Follow [the personal Vercel deployment guide](../../docs/operations/personal-vercel.md).

This independent root creates only a protected Vercel project and nonsecret production settings. It uses the HCP Terraform workspace `email-triager-personal`. Supply `TF_CLOUD_ORGANIZATION` through your local shell and select Local execution mode before applying. Runtime secrets and Neon resources are outside this Terraform state.

For credential-free schema validation, run `terraform init -backend=false` and `terraform validate` in this directory. Backend initialization and reviewed apply happen during the later setup checkpoint.
