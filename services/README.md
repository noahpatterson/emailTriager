# Deploy spike — Terraform (Vercel + Neon)

Declares the **public** Neon project and Vercel app for Slice 1 ([#12](https://github.com/noahpatterson/emailTriager/issues/12)).
This is a separate Neon project from any personal/dev project (ADR-0009) so branching never copies real message bodies.

State is **local** for now (D-8). `.gitignore` already covers `*.tfstate*`, `.terraform/`, `*.tfvars`, and `services/.env`.

## Prerequisites before first `terraform apply`

You must supply:

| Variable | Source |
|---|---|
| `NEON_API_KEY` | Neon Console → Account Settings → API Keys |
| `NEON_ORG_ID` | Neon Console → Account Settings → Organization |
| `VERCEL_API_TOKEN` | Vercel → Account Settings → Tokens |

Do not invent or scrape these. Copy `services/.env.example` → `services/.env` and fill them in.

Optional:

| Variable | Purpose |
|---|---|
| `VERCEL_TEAM_ID` | Required if the project lives on a Vercel team |
| `GITHUB_REPO` | Defaults to `noahpatterson/emailTriager` |
| `NEON_REGION` | Defaults to `aws-us-east-1` |
| `VERCEL_PROJECT_NAME` | Defaults to `email-triager` |

## Apply

```sh
cd services
cp .env.example .env   # then edit: API keys + TF_VAR_neon_org_id=<same as NEON_ORG_ID>
set -a && source .env && set +a
terraform init
terraform plan
terraform apply
```

`terraform apply` is blocked until those keys exist — providers authenticate from `NEON_API_KEY` / `VERCEL_API_TOKEN`, and the Neon project requires `TF_VAR_neon_org_id`.

After apply, Terraform wires Vercel env vars:

- Real `DATABASE_URL` / `DATABASE_URL_UNPOOLED` from the new Neon project (pooled + direct)
- `DATABASE_DRIVER=pg` (spike validates `pg` over the Neon pooler)
- Placeholder Google + Neon Auth values so `getServerConfig()` can boot without OAuth setup

Point CI secret `DATABASE_URL_UNPOOLED` at the Terraform output of the same name so the push-only migrate job can run.

## Prove the spike

1. Hit `GET /api/health` on the Vercel deployment — expect `{"ok":true}`.
2. With a pooled connection string: `TEST_DATABASE_URL=<pooled> bun test src/test/rls-session-probe.test.ts`
