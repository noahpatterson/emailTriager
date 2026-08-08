# Deploy — Terraform (Vercel + Neon)

Declares the **public** Neon project and Vercel app for Slice 1 ([#12](https://github.com/noahpatterson/emailTriager/issues/12)).
This is a separate Neon project from any personal/dev project (ADR-0009) so branching never copies real message bodies.

Two modes (`TF_VAR_deployment_mode`):

| Mode | Audience | `DATABASE_URL` role | IP lock |
| --- | --- | --- | --- |
| `spike` (default) | Operator only | Neon owner (BYPASSRLS) | Required (`TF_VAR_allowed_cidrs` + Firewall) |
| `demo` | Public visitors | `emailtriager_app` (NOBYPASSRLS) | Cleared; `APP_PROFILE=demo` |

State is **local** for now (D-8). `.gitignore` already covers `*.tfstate`*, `.terraform/`, `*.tfvars`, and `services/.env`.

### Terraform install

1. `brew tap hashicorp/tap`
2. `brew install hashicorp/tap/terraform`

## Prerequisites before first `terraform apply`

You must supply:

| Variable               | Source                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEON_API_KEY`         | Neon Console → Account Settings → API Keys                                                                                                        |
| `NEON_ORG_ID`          | Neon Console → Account Settings → Organization                                                                                                    |
| `VERCEL_API_TOKEN`     | Vercel → Account Settings → Tokens                                                                                                                |
| `TF_VAR_neon_org_id`   | Same as `NEON_ORG_ID`                                                                                                                             |

**Spike mode** also requires `TF_VAR_allowed_cidrs` (your public IPv4). Check with `curl -sS https://api.ipify.org`.

**Demo mode** also requires `TF_VAR_demo_app_db_password` (≥16 chars). Use the **same** value as GitHub Actions secret `DEMO_APP_DB_PASSWORD` so `bun run db:migrate:demo` can create/rotate `emailtriager_app`.

Do not invent or scrape these. Copy `services/.env.example` → `services/.env` and fill them in.

Optional:

| Variable                                   | Purpose                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `TF_VAR_deployment_mode`                   | `spike` (default) or `demo`                                                                             |
| `TF_VAR_demo_app_db_password`              | Required for `demo` — password for `emailtriager_app`                                                   |
| `TF_VAR_enable_vercel_trusted_ips`         | `true` to also enable Vercel platform Trusted IPs (plan entitlement; ignored in demo)                   |
| `VERCEL_TEAM_ID` / `TF_VAR_vercel_team_id` | Required if the project lives on a Vercel team                                                          |
| `GITHUB_REPO`                              | Defaults to `noahpatterson/emailTriager`                                                                |
| `NEON_REGION`                              | Defaults to `aws-us-east-1`                                                                             |
| `VERCEL_PROJECT_NAME`                      | Defaults to `email-triager`                                                                             |

### IP lockdown notes (spike)

- **Vercel Firewall (edge):** `vercel_firewall_config` denies client IPs not in `TF_VAR_allowed_cidrs`. Destroyed when switching to `demo`.
- **App allowlist:** `proxy.ts` also enforces `ALLOWED_CIDRS` (Hobby-safe). Empty in demo mode.
- **Neon IP Allow:** Leave Neon open to the network; protect with credentials + inbound allowlist (spike) or RLS + app role (demo).

## Apply (spike)

```sh
cd services
cp .env.example .env   # API keys + TF_VAR_neon_org_id + TF_VAR_allowed_cidrs
set -a && source .env && set +a
terraform init
terraform plan
terraform apply
```

## Unlock public demo

See the root [README — Unlock public demo on Vercel](../README.md#unlock-public-demo-on-vercel). Short version:

1. Set `TF_VAR_deployment_mode=demo` and a strong `TF_VAR_demo_app_db_password`.
2. `terraform apply` (clears Firewall / `ALLOWED_CIDRS`, sets `APP_PROFILE=demo`, points `DATABASE_URL` at `emailtriager_app`).
3. Ensure CI secrets `DATABASE_URL_UNPOOLED` (Neon **owner**) and `DEMO_APP_DB_PASSWORD` (same as Terraform) are set, then push so migrate + `db:migrate:demo` run.
4. Smoke: `/api/health`, start demo session, sync; confirm `/api/audit` returns demo-disabled.

After apply, Terraform wires Vercel env from the selected mode. Point CI `DATABASE_URL_UNPOOLED` at the Terraform output of the same name (always the Neon **owner** URI for migrations).

## Prove the spike

1. Hit `GET /api/health` on the Vercel deployment — expect `{"ok":true}`.
2. With a pooled connection string: `TEST_DATABASE_URL=<pooled> bun test src/test/rls-session-probe.test.ts`
   (The Terraform owner role has `BYPASSRLS`; the probe creates a temporary `NOBYPASSRLS` role so policies actually fire.)
