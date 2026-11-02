# Deploy your personal app on Vercel

Use this guide for a private Vercel Hobby deployment with an isolated personal Neon project. Read [ADR-0020](../adr/0020-personal-vercel-deployment.md) for the security and cost tradeoffs. Complete preparation before providing credentials. Keep secret values in a password manager or the ignored `services/personal/.env` file, never in chat. Enable multifactor authentication on the Vercel, Google, Neon, and HCP accounts. No deployment can be guaranteed 100% secure.

## Current account selection

- Vercel scope: `npsquirrel`; new project name: `email-triager-personal`.
- Neon project: `emailTriagier` (`square-base-25856382`).
- Neon branch: `production` (`br-icy-dream-aja9rw7l`).
- First deployment: Gmail writes and external AI enabled, both login gates required.
- HCP organization: `npsquirrel`; workspace: `email-triager-personal` in Local execution mode.
- Vercel project ID: `prj_X4R3SademnL8w9FEG36zJLJaAJDs`.
- Production domain: `https://email-triager-personal.vercel.app`.
- First successful deployment: `dpl_13MoB5mCY1kjm5affA1tDj6ph7kY` on 2026-10-11.

The cloud build and remote readiness checks passed. Anonymous access is blocked on both the production domain and deployment URL. Owner browser login and a live Gmail trial still require verification.

Confirm that this Neon project is dedicated to private use before migrations or permission changes. These names do not prove isolation.

For HCP setup, open [HCP Terraform](https://app.terraform.io/), create a Free organization, and create a workspace using the **CLI-driven workflow**. Name it `email-triager-personal`. In workspace Settings, select **Local** execution mode. Run `terraform login` locally and provide the organization name to the deployment operator. HCP is used because the repository requires encrypted remote Terraform state.

Create a Vercel API token in [account token settings](https://vercel.com/account/settings/tokens) with access to `npsquirrel` and a short expiry sufficient for setup. Put it in the ignored personal environment file. Google and Jev credentials also stay in that file. The operator can generate the new database password, cookie secret, and encryption key locally. No refresh token or mailbox password is needed from you.

## Prepare the protected project

1. Copy `services/personal/.env.example` to `services/personal/.env`. Restrict that file to your user with `chmod 600 services/personal/.env`.
2. Create an HCP Terraform organization on the Free plan. Create the CLI-driven workspace `email-triager-personal` and select **Local** execution mode in its settings. HCP stores encrypted state while Terraform runs on your machine. Keep the Vercel token in the local process environment, outside workspace variables.
3. Run `terraform login` to authenticate Terraform with HCP. Set `TF_CLOUD_ORGANIZATION` to your organization in your shell. Supply `VERCEL_API_TOKEN` locally. Set `TF_VAR_team_id` only when the project belongs to a team. For the requested full functionality, export `TF_VAR_gmail_writes_enabled=true` and `TF_VAR_external_ai_enabled=true` in the shell before plan/apply. The Terraform defaults remain disabled unless explicitly selected.
4. Run `terraform -chdir=services/personal init`. Review `terraform -chdir=services/personal plan` before applying. Confirm that the plan creates only the personal project and nonsecret settings. Use `terraform -chdir=services/personal apply` after that review.
5. Record the project ID, owning account ID, and optional team ID in the personal environment file. Inspect Vercel settings before supplying runtime credentials. Require **Vercel Authentication** for **All Deployments**, disabled previews, and Git fork protection. Keep the project disconnected from Git. Do not add shareable bypass links, protection exceptions, or automation bypass tokens.

The Terraform root declares protection before any source deployment. It contains no Neon resource, runtime secret, or deployment resource. [HCP Free supports up to 500 managed resources](https://developer.hashicorp.com/terraform/cloud-docs/overview). HCP [encrypts remote state at rest and uses TLS in transit](https://developer.hashicorp.com/terraform/cloud-docs/architectural-details/security-model). Do not switch this root to local state.

## Set up the independent database and identities

1. Select your existing isolated personal Neon project and confirm its project ID, database name, and purpose. It must be separate from the demo and safe for application migrations and a dedicated runtime role. Review existing tables and permissions before provisioning. Enable Neon Auth in that personal project.
2. Create your owner identity through Neon Auth's supported signup flow. Copy its exact user ID to `OWNER_NEON_AUTH_USER_ID`. Configure the final Vercel production HTTPS origin as a trusted origin in Neon Auth.
3. Store the direct owner connection as `PERSONAL_DATABASE_URL_UNPOOLED`. Keep the owner connection off Vercel and the existing CI workflow. The scripts require a direct Neon host with TLS.
4. Generate a random `PERSONAL_APP_DB_PASSWORD` of at least 32 characters. Generate `TOKEN_ENCRYPTION_KEY_V1` from 32 random bytes encoded as canonical base64. Generate a separate `NEON_AUTH_COOKIE_SECRET` of at least 32 characters. Use `openssl rand -base64 32` separately for each secret and store the results securely. Compose the pooled `DATABASE_URL` with role `emailtriager_personal_app`, its chosen password, and the same personal database before running the migration and role commands. The role is created in the next section.
5. Configure your Google OAuth client for the exact redirect URI `https://<production-host>/api/oauth/google/callback`. Add your Google account as a test user when the consent screen requires it. Populate the client credentials and redirect URI in the personal file.
6. The requested first deployment enables Gmail filing and external AI: set both personal capability flags to `true`, and supply `JEV_API_KEY` for TypeSafe classification. Gmail consent requests `gmail.modify`, allowing labels and archive actions. AI receives sender, subject, and bounded body text. Provider charges are separate from free hosting. Keep notification credentials and telemetry exporters absent. Additional audit/judge features use the optional `MODEL_*` settings.

Do not infer console configuration from environment validation. You must verify the trusted origin, owner ID, consent screen, allowed Google test account, and exact redirect URI in their consoles. Neon documents the distinction between [pooled and direct connection strings](https://neon.com/docs/cli/connection-string).

## Upload production secrets, migrate, and check readiness

1. Upload the production runtime values listed in the example file through Vercel's environment variable UI or `vercel env add <NAME> production`. Select encrypted or sensitive values and target only **Production**. Never upload the whole file. Do not upload owner credentials, role provisioning passwords, HCP credentials, or the Vercel API token.
2. Run `bun run personal:migrate --env-file services/personal/.env` from the repository root. This applies only `db/migrations` using the direct personal owner connection. It does not use demo SQL or existing CI secrets.
3. Run `bun run personal:role --env-file services/personal/.env`. This creates or rotates `emailtriager_personal_app` and grants DML on the reviewed application table list. It grants sequence usage only for those tables. It removes public schema creation and role memberships. Neon does not allow the owner to switch to this role with `SET ROLE`, so the transaction inspects the target role by name. Existing elevated privilege attributes cause rollback rather than being silently changed. The later remote readiness check connects with the actual runtime credentials and verifies the same restrictions. Rerun after migrations that add application tables, after reviewing the list in `scripts/personal-operations.ts`.
4. Upload the prepared pooled connection for `emailtriager_personal_app` as `DATABASE_URL` to Vercel production. Include `sslmode=require` or `sslmode=verify-full`. Confirm that the runtime and owner connections target the same selected personal database.
5. Run `bun run personal:check --env-file services/personal/.env`. Expect boolean checks and `ready: true`. Role provisioning failures print a fixed phase, SQLSTATE, and boolean checks without exposing SQL or passwords. A failure returns exit code 1 without printing secret values or database errors.
6. Run `bun run personal:check --env-file services/personal/.env --remote`. This reads the selected Vercel project and account, checks Hobby billing metadata, protection, previews, fork protection, and production secret metadata. It runs a readonly role query through the pooled runtime connection. Require every check to pass before deploying source.

The local check reads only the explicitly selected file. The remote check lists credential metadata without decrypting secrets. Because Terraform stores even nonsecret settings as encrypted variables, it reads only the three allowlisted profile and capability settings individually to verify their values. It confirms metadata and effective database role properties, not that the uploaded secret values equal your local file. It cannot prove project independence, console OAuth registration, or successful browser login. Review those separately. Private schema access or inherited permissions cause the database role check to fail. Investigate those permissions before deployment instead of weakening the check.

## Deploy and verify both logins

1. Run `bunx vercel login`, then `bunx vercel link` and select the personal project and account. Confirm the project and account IDs before continuing.
2. Run `bunx vercel deploy --prod` from the repository root. Inspect `.vercelignore` before upload. Deploy only after protection, secret setup, migrations, role provisioning, and both readiness checks.
3. Open the production domain in a browser with no Vercel session. Confirm that Vercel requires login. Repeat for the deployment URL and direct API URLs.
4. Sign in to Vercel with the authorized account. Confirm that the app requires Neon Auth login before showing mailbox data.
5. Sign in with the configured owner identity. Verify that a different Neon identity cannot read or mutate mailbox data. Connect Gmail with the read and modify permission. Save the source label in Configuration and the contest destination labels in the dashboard, then run a contest trial before applying labels or archive actions. Review the proposed changes.
6. Confirm a trial makes no Gmail changes, then run a small filing batch and inspect the labels and archive result in Gmail. Contest scans handle at most three messages plus one interrupted-message recovery. Keep the browser open until each request completes. If either capability is disabled for recovery, verify its calls are rejected; with AI disabled the dashboard offers deterministic five-message trials.

Vercel [makes All Deployments authentication available on every plan](https://vercel.com/changelog/protect-production-deployments-for-free-on-every-plan). Hobby Fluid functions have a [300 second maximum duration](https://vercel.com/docs/functions/configuring-functions/duration). Keep work within the app's bounded batch limits. Database or network delays can still interrupt a request. This setup does not provide a durable job queue, background worker, or scheduled scan.

## Enable optional capabilities deliberately

To enable Gmail filing, set `PERSONAL_GMAIL_WRITES_ENABLED=true` in production, update the local personal file, and redeploy. Disconnect Gmail, revoke the old grant if needed, and reconnect to consent to the expanded write scope. Review a trial before applying labels or archive actions.

To enable external AI, review which message text the provider receives and its pricing. Supply the selected model configuration and provider credential to production only, set `PERSONAL_EXTERNAL_AI_ENABLED=true`, and redeploy. Model usage may cost money even when hosting uses free plans. Notifications and exported telemetry remain disabled for personal deployments in this release. Enabling them requires a reviewed code change.

## Manage retained data and rollback

Gmail refresh tokens and parsed message snapshots use encryption. Message subjects, sender metadata, verdict rationale, contest metadata, and golden set message text can remain plaintext in the database. Golden set evidence is retained separately from snapshot retention. Avoid adding sensitive examples to the golden set unless you intend to retain them.

`RETENTION_DAYS=30` configures the snapshot retention window. Deletion still requires a manual retention run. This setup does not schedule automatic deletion. Review the retention command and its target connection before running it against the personal project. Disconnecting Gmail does not delete retained records.

To stop mailbox access, disconnect Gmail in the app and revoke the app's Google grant. Set both capability flags to `false` and redeploy. If needed, remove the production runtime credentials or disable the runtime database role through the personal owner connection. Keep Vercel protection enabled throughout recovery.

To roll back code, promote a previously verified protected production deployment. Confirm that its database schema and environment are compatible. Avoid reverting migrations that drop data. Preserve the encryption key while existing encrypted records need to remain readable. Treat Terraform destroy and Neon project deletion as separate destructive actions that need explicit review.
