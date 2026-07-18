# Operations readiness

## Deploy
Use Bun 1.3.14 and Node 22–26. Configure `.env.example` values in the server environment; never expose unprefixed values to the browser. Apply Drizzle migrations (`bun run db:migrate`) before deployment. The placeholder routes return 501 and cannot initiate OAuth, sync, mutation, or disconnect.

## Rollback and kill switch
Before rollout, back up the database and verify the prior release reads the current schema. Migrations are additive during MVP delivery; destructive changes require a separate expand/contract release. To stop movement, disable scheduled/triggered sync and disconnect the Gmail connection. Rollback never removes destination labels. Validate checkpoints remain readable after deploying the prior compatible release.

## Incident and retention readiness
Revoke the Google grant, clear local token ciphertext, rotate the versioned encryption key through a controlled re-encryption procedure, and retain only sanitized identifiers/status/error codes. Never log tokens, raw provider responses, MIME, bodies, attachments, or configured term corpus. Define and automate retention periods before production enablement.

## Optional validation
`TEST_DATABASE_URL` enables isolated database checks. `LIVE_GMAIL_TEST=1` plus dedicated credentials enables live checks only after account, unique-label, and run-marker preflight; otherwise suites must report a named skip.
