# Operations readiness

## Deploy
Use Bun 1.3.14 and Node 22–26. Configure `.env.example` values in the server environment; never expose unprefixed values to the browser. Apply Drizzle migrations (`bun run db:migrate`) before deployment.

Public Vercel + Neon for the deployment spike is declared under [`services/`](../../services/README.md) (Terraform). Fill `services/.env` from `services/.env.example` before `terraform apply`. After deploy, `GET /api/health` must return `{"ok":true}` with no secrets. RLS `SET LOCAL` scoping is covered by `src/test/rls-session-probe.test.ts` when `TEST_DATABASE_URL` points at the Neon pooler.

The application routes are live and owner-authorized. They can connect or
disconnect Gmail, read message metadata and bodies for local classification,
apply configured labels, and move archive-label messages to Gmail Trash after
explicit confirmation. Use a dedicated test mailbox and trial sync until the
configuration has been verified.

## Rollback and kill switch
Before rollout, back up the database and verify the prior release reads the current schema. Migrations are additive during MVP delivery; destructive changes require a separate expand/contract release. To stop movement, disable scheduled/triggered sync and disconnect the Gmail connection. Rollback never removes destination labels. Validate checkpoints remain readable after deploying the prior compatible release.

## Incident and retention readiness
Revoke the Google grant, clear local token ciphertext, rotate the versioned encryption key through a controlled re-encryption procedure, and retain only sanitized identifiers/status/error codes. Never log tokens, raw provider responses, MIME, bodies, attachments, or configured term corpus. Define and automate retention periods before production enablement.

Run `bun run retention:run` on a daily scheduler. It removes expired OAuth
state immediately and finished run/message state older than `RETENTION_DAYS`
(default 30). Abandoned running rows also expire. Run observations cascade
with their expired runs; the normalized sender retained for run review is
bounded by the same policy.

## Optional validation
`TEST_DATABASE_URL` enables isolated database checks. `LIVE_GMAIL_TEST=1` plus dedicated credentials enables live checks only after account, unique-label, and run-marker preflight; otherwise suites must report a named skip.
