# Email Triage

Single-owner Gmail triage MVP described in `docs/product-spec.md`.

## Local validation

```sh
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun test
bun run db:check
bun run build
```

The optional Neon and live-Gmail tests report named skips unless their explicit opt-in environment is configured. Never point tests at a production mailbox or database.

## Google OAuth setup (user-supplied)

1. In Google Cloud Console, create/select a project, enable **Gmail API**, and configure the OAuth consent screen. For an External app in testing, add the dedicated test Gmail account as a test user.
2. Create an **OAuth client ID** of type **Web application**.
3. Add the exact authorized redirect URI `http://localhost:3000/api/oauth/google/callback` (use the exact deployed HTTPS equivalent in deployment). No wildcard or trailing-slash variant is interchangeable.
4. Copy `.env.example` to `.env.local` and supply the client ID/secret. The app requests `openid` and `https://www.googleapis.com/auth/gmail.modify`; add/approve that Gmail scope on the consent screen.
5. Generate the token-encryption secret locally, for example `openssl rand -base64 32`; keep it stable and secret. Do not commit it.

Required local values:

```dotenv
DATABASE_URL=postgresql://...neon.tech/email_triager?sslmode=require
NEON_AUTH_BASE_URL=https://your-project.neon.tech
NEON_AUTH_COOKIE_SECRET=<at least 32 random characters>
OWNER_NEON_AUTH_USER_ID=<Neon Auth user ID>
GOOGLE_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3000/api/oauth/google/callback
TOKEN_ENCRYPTION_KEY_V1=<output of openssl rand -base64 32>
```

Enable Neon Auth for the Neon project, create/sign in as the intended sole owner, and copy that user's ID to `OWNER_NEON_AUTH_USER_ID`. Set `NEON_AUTH_BASE_URL` to the Auth endpoint shown by Neon and generate a stable cookie secret of at least 32 characters. Other identities are rejected.

## Neon test database and migrations (user-supplied)

Create an isolated Neon project or branch/database for this app, copy its pooled connection string, retain `sslmode=require`, and set it as `DATABASE_URL`. Prefer the unpooled connection string as `DATABASE_URL_UNPOOLED` for migrations. For optional integration tests, create a separate disposable Neon branch/database and set its connection string as `TEST_DATABASE_URL`; never reuse production.

Schema lives in `db/schema.ts`. Generate and apply migrations with Drizzle Kit:

```sh
bun run db:check
bun run db:migrate
```

After schema edits, run `bun run db:generate` to create a new migration, then `bun run db:migrate`. Apply migrations once to an empty database (or a branch that has not already received the equivalent schema). Populate `owner_binding` and a version-1 `triage_config` through controlled setup before syncing.

## Live OAuth/mailbox verification (user-supplied, non-destructive)

Use only a dedicated test Gmail account and test labels. Start the app:

```sh
bun install --frozen-lockfile
bun run dev
```

1. Sign in as the configured Neon Auth owner and open `http://localhost:3000`.
2. Initiate Google connection through `/api/oauth/google/start`; confirm Google's consent screen names only identity and Gmail modify access, then complete the callback.
3. Verify locally without exposing secrets by querying `gmail_connection` for `owner_auth_user_id`, `google_subject`, `key_version`, and `disconnected_at` (Neon SQL Editor is fine).
4. Configure a dedicated source label and conservative bounds in `triage_config`, place non-sensitive fixture mail under that label, and invoke `POST /api/sync` from the same authenticated origin. Inspect `sync_run` and metadata-only `message_processing`; bodies are intentionally not stored.
5. Current code performs local deterministic classification primitives, but sync does **not** yet invoke classification or mutate labels. Confirm the mailbox remains unchanged.
6. Invoke `POST /api/disconnect` from the authenticated same-origin session. Confirm `select count(*) from gmail_connection;` returns zero. Remote revocation is best-effort, while local credential deletion is mandatory.

Do not curl state-changing routes without the authenticated Neon Auth browser session and correct Origin header, and do not use a real mailbox containing production mail.
