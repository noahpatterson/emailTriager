# Email Triage

Single-owner Gmail triage console. Deterministic local rules classify mail under a configured source label, apply Gmail labels, and keep a bounded sync history. See [`docs/product-spec.md`](docs/product-spec.md).

## What it is / is not

**Is**

- Owner-only workspace (one configured identity)
- Local rule-based triage (no LLM in the sync path)
- Optional post-sync **shadow audit** (`POST /api/audit`) — OpenAI judge over stored snapshots; no Gmail mutation in this path
- Optional `APP_PROFILE=demo|ci` fixture Gmail (adversarial corpus; proves machinery, not classifier quality — see `docs/README.md`)
- Bounded sync with run history and trial mode
- Gmail label mutations for triage outcomes

**Is not**

- Multi-user SaaS or team inbox product
- A send/compose client
- Multi-provider model routing — the judge talks **OpenAI only** (OpenAI HTTP API / compatible base URL) for now
- An owner UI for audit runs yet (API only; review UI comes later)
- Permanent delete by default (starred mail stays protected; dangerous purge is explicit and opt-in)
- Production-hardened infrastructure — treat it as a personal experiment

## Disclaimer

This project is vibecoded / AI-assisted. It has been reviewed to a point, but **use at your own risk**. There is **no warranty and no liability**. Never point insecure local mode, Docker experiments, or live sync at a mailbox you cannot afford to mess up.

---

## Configure Google Gmail OAuth

Required for **any** path that connects a real Gmail mailbox (local insecure Docker, Neon Docker, or Bun + Neon).

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or select a project.
2. Enable the **Gmail API** for that project (**APIs & Services → Library → Gmail API → Enable**).
3. Configure the **OAuth consent screen**:
   - User type: **External** is fine for a personal app in testing.
   - Add an app name and your email as support/developer contact.
   - Under **Scopes**, ensure the app can request:
     - `openid`
     - `https://www.googleapis.com/auth/gmail.modify`
   - Under **Test users**, add the Gmail account you will connect (required while the app is in testing).
4. Create credentials: **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   - Application type: **Web application**.
   - **Authorized redirect URIs** — add the exact URI you will put in env (no trailing slash; must match character-for-character):
     - Local / Docker on this machine: `http://localhost:3000/api/oauth/google/callback`
     - Public deploy: `https://your.public.host/api/oauth/google/callback`
5. Copy the **Client ID** and **Client secret** into your env file:

```dotenv
GOOGLE_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3000/api/oauth/google/callback
```

6. Generate a stable token-encryption key (used for Gmail refresh tokens at rest):

```sh
openssl rand -base64 32
```

```dotenv
TOKEN_ENCRYPTION_KEY_V1=<paste output>
```

Keep `TOKEN_ENCRYPTION_KEY_V1` stable. Rotating it without re-connecting Gmail makes stored refresh tokens unreadable.

**Notes**

- The app requests modify access so it can add/remove labels (and, on the explicit danger-zone path, move archive mail to Gmail Trash). It does not send mail.
- Changing the redirect URI requires updating **both** Google Console and `GOOGLE_REDIRECT_URI`.
- Prefer a dedicated test Gmail account and test labels until you trust the setup.

Official Google reference: [Using OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server).

---

## Configure OpenAI (shadow audit judge)

Sync stays rule-based. The optional **shadow audit** calls a model after a completed sync to score filings against category intent. There is **no audit UI yet** — start/resume via `POST /api/audit` and poll `GET /api/audit/:id`.

**Provider support today: OpenAI only.** The app uses the OpenAI-compatible HTTP client pointed at OpenAI (or a drop-in base URL that speaks the same API). Other vendors are not wired; leave multi-provider profiles for later.

**What the audit sends.** Each judged message sends the sender address, the subject, and up to 4000 characters of body text to `MODEL_BASE_URL`, together with your category intent and up to 2 exemplar messages per category. Snapshots are decrypted for the call. Do not enable audit against a mailbox whose content you cannot share with the configured provider.

Required only if you run audit (not needed for sync or matching eval):

```dotenv
MODEL_NAME=gpt-4.1-mini
MODEL_BASE_URL=https://api.openai.com/v1
MODEL_API_KEY=sk-...
# optional; defaults to openai-compatible
# MODEL_PROVIDER=openai-compatible
```

`MODEL_API_KEY` may be a plaintext key or an `encryptSecret` ciphertext (`v1.…`) produced with `TOKEN_ENCRYPTION_KEY_V1`.

Also required before audit: complete **category intent** on triage config for every category (priority / review / new / archive).

---

## Configure Neon (Postgres + Auth)

Required for the **Neon production Docker** path and the **Bun + Neon** path. Not required for local insecure Docker (that stack uses Compose Postgres and bypasses Neon Auth).

Docs: [Neon](https://neon.com/docs) · [Managed Better Auth overview](https://neon.com/docs/auth/overview) · [Next.js Auth guide](https://neon.com/guides/neon-auth-nextjs).

### 1. Create a Neon project and database

1. Sign in to the [Neon Console](https://console.neon.tech/) and create a project.
2. On the project **Dashboard**, copy connection strings:
   - **Pooled** → `DATABASE_URL` (app runtime; keep `sslmode=require`).
   - **Direct / unpooled** → `DATABASE_URL_UNPOOLED` (migrations; prefer this for `bun run db:migrate` / Compose migrate).
3. Set:

```dotenv
DATABASE_URL=postgresql://...@...-pooler....neon.tech/...?sslmode=require
DATABASE_URL_UNPOOLED=postgresql://...@....neon.tech/...?sslmode=require
DATABASE_DRIVER=neon-http
```

### 2. Enable Neon Auth (Managed Better Auth)

1. In the Neon Console, open your project → branch → **Auth** / **Managed Better Auth**.
2. Click **Enable** (or provision Auth for the branch).
3. Copy the **Auth URL** from Auth configuration (looks like `https://ep-….neonauth….neon.tech/…/auth`).
4. Generate a cookie secret (≥ 32 characters):

```sh
openssl rand -base64 32
```

5. Set:

```dotenv
NEON_AUTH_BASE_URL=https://ep-….neonauth….neon.tech/…/auth
NEON_AUTH_COOKIE_SECRET=<paste output>
```

6. For local development, ensure Auth **trusted domains** allow localhost (Neon Console Auth settings / trusted domains, or CLI `neon neon-auth domain …`). For a public deploy, add your production origin the same way.

### 3. Create the owner user and bind the owner id

1. Start the app (Bun or Neon Docker — see below) so `/auth/sign-in` is reachable.
2. Sign up / sign in once with the account that should own the workspace (email/password or whatever methods you enabled in Neon Auth).
3. Obtain that user’s Neon Auth **user id** (from Neon Auth user admin / CLI / your first successful session debug). Set:

```dotenv
OWNER_NEON_AUTH_USER_ID=<that user id>
```

4. Restart the app. Only that id can open the dashboard, connect Gmail, or run sync. Any other signed-in user sees “Wrong account”.

### 4. Apply migrations

```sh
bun run db:migrate
```

Or let `docker compose -f docker-compose.neon.yml up --build` run the `migrate` service against Neon.

---

## Docker setups

Complete [Google Gmail OAuth](#configure-google-gmail-oauth) first. Complete [Neon](#configure-neon-postgres--auth) only for path **2**.

| | **1. Local insecure** | **1b. Public demo** | **2. Neon production** |
|---|---|---|---|
| Compose file | `docker-compose.yml` | `docker-compose.demo.yml` | `docker-compose.neon.yml` |
| Database | Local Postgres in Compose | Local Postgres (separate volume) | Your Neon Postgres |
| Auth | Bypassed (“Continue as local owner”) | Cookie demo session | Neon Auth (real sign-in) |
| Gmail | Real OAuth | Fixture corpus | Real OAuth |
| App bind | `127.0.0.1:3000` | `127.0.0.1:3000` | `127.0.0.1:3000` (override with `APP_HOST_BIND`) |
| Use when | Trying the app without Neon | Confirming the public demo path | Running the containerized app against Neon |

### 1. Local insecure Docker build

No Neon project required. Compose starts Postgres, migrates, and runs the app with auth bypass.

1. `cp .env.example .env`
2. Fill Google vars from [Configure Google Gmail OAuth](#configure-google-gmail-oauth) (`GOOGLE_*`, `TOKEN_ENCRYPTION_KEY_V1`). Redirect URI should be `http://localhost:3000/api/oauth/google/callback`.
3. Start:

```sh
docker compose up --build
```

4. Open [http://127.0.0.1:3000](http://127.0.0.1:3000) → **Continue as local owner** → connect Gmail → configure → sync.

Compose forces `APP_PROFILE=local-compose`, `INSECURE_LOCAL_DEV=true`, `ALLOW_INSECURE_LOCAL_DEV=I_UNDERSTAND`, and `DATABASE_DRIVER=pg`. A sticky warning banner marks the mode. **Do not expose port 3000 beyond localhost.** Never use these flags on a real deployment.

**Hybrid (Compose DB + Bun on host):** publish Postgres as `127.0.0.1:5432:5432` on the `db` service, run `docker compose up db migrate`, then:

```sh
bun install --frozen-lockfile
# .env.local: APP_PROFILE=local-compose, INSECURE_LOCAL_DEV=true, ALLOW_INSECURE_LOCAL_DEV=I_UNDERSTAND,
# DATABASE_DRIVER=pg,
# DATABASE_URL=postgresql://emailtriager:emailtriager@localhost:5432/email_triager
# + Google OAuth + TOKEN_ENCRYPTION_KEY_V1
bun run dev
```

### 1b. Public demo Docker (local confirmation)

No Neon or Google account required. Compose starts Postgres, applies production migrations, then **demo-only** migrations (`db/migrations-demo/`), and runs with `APP_PROFILE=demo`. Audit / review / demotion APIs are disabled and those pages show explainers.

```sh
docker compose -f docker-compose.demo.yml up --build
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000) → **Start demo session** → **Run sync**. Use **Clear my demo data** from the account menu to wipe the visitor. Demo migrations are never applied by production `db:migrate` (use `bun run db:migrate:demo` after prod migrate when developing without Compose).

### Unlock public demo on Vercel

Confirm the demo locally with [§1b](#1b-public-demo-docker-local-confirmation) first. The IP-locked spike (`TF_VAR_deployment_mode=spike`) must **not** go public with the Neon owner `DATABASE_URL` — that role bypasses RLS and voids visitor isolation.

**Hard requirements before opening the app:**

1. Runtime `DATABASE_URL` is `emailtriager_app` with `NOBYPASSRLS` (never the Neon owner).
2. Production + demo migrations are applied (`db:migrate` then `db:migrate:demo`).
3. `APP_PROFILE=demo`, `DATABASE_DRIVER=pg`, empty `ALLOWED_CIDRS`, no Vercel Firewall allowlist, no insecure-local flags.
4. Google OAuth stays placeholder-disabled; AI/audit/review routes stay gated.

**Steps**

1. Generate a strong app-role password (≥16 chars) and store it in two places with the **same** value:
   - `services/.env`: `TF_VAR_demo_app_db_password=…`
   - GitHub Actions secret: `DEMO_APP_DB_PASSWORD`
2. Keep CI secret `DATABASE_URL_UNPOOLED` as the Neon **owner** direct URI (Terraform output `DATABASE_URL_UNPOOLED`) so migrations can create roles.
3. In `services/.env`:

   ```sh
   TF_VAR_deployment_mode=demo
   TF_VAR_demo_app_db_password=<same as DEMO_APP_DB_PASSWORD>
   # leave TF_VAR_allowed_cidrs empty or unused in demo mode
   ```

4. Apply Terraform (destroys the spike Firewall rule; rewrites Vercel env for demo):

   ```sh
   cd services
   set -a && source .env && set +a
   terraform plan   # expect: Firewall destroyed, APP_PROFILE=demo, DATABASE_URL → emailtriager_app
   terraform apply
   ```

   If this project already had spike state, move resources once if Terraform asks:

   ```sh
   terraform state mv 'vercel_project_environment_variable.spike' 'vercel_project_environment_variable.app'
   terraform state mv 'vercel_firewall_config.spike' 'vercel_firewall_config.spike[0]'
   ```

5. Push to `main` (or re-run the `migrate` workflow) so CI runs `db:migrate` then `db:migrate:demo`. Until `emailtriager_app` exists with the matching password, the app refuses to serve demo traffic (`assertDemoDatabaseRoleSafe`).
6. Schedule cleanup (required for a long-lived public demo): `DATABASE_URL_UNPOOLED=<owner URI> bun run demo:cleanup` (daily) to wipe expired visitors and prune rate-limit hits.
7. Smoke from any network:
   - `GET /api/health` → `{"ok":true}`
   - Start demo session → Run sync → fixture mailbox works
   - `POST /api/audit` (or review) → demo AI disabled / explainer
   - Second browser / private window cannot see the first visitor’s data

**Do not** unlock by only clearing `ALLOWED_CIDRS` while leaving the Neon owner URL in Vercel.

Details for Terraform variables: [`services/README.md`](services/README.md).

### 2. Neon production Docker build

Runs the same app image against **Neon Postgres + Neon Auth**. No local Postgres. Insecure local mode is forced off.

1. Finish [Configure Neon](#configure-neon-postgres--auth) and [Configure Google Gmail OAuth](#configure-google-gmail-oauth).
2. Copy env:

```sh
cp .env.example .env.neon
```

3. Fill `.env.neon` (no insecure flags):

```dotenv
DATABASE_URL=postgresql://...neon.tech/...?sslmode=require
DATABASE_URL_UNPOOLED=postgresql://...neon.tech/...?sslmode=require
DATABASE_DRIVER=neon-http
NEON_AUTH_BASE_URL=https://ep-….neonauth….neon.tech/…/auth
NEON_AUTH_COOKIE_SECRET=<at least 32 random characters>
OWNER_NEON_AUTH_USER_ID=<Neon Auth user id>
GOOGLE_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://your.public.host/api/oauth/google/callback
TOKEN_ENCRYPTION_KEY_V1=<openssl rand -base64 32>
```

For a first smoke against Neon while still on this machine, you may use `GOOGLE_REDIRECT_URI=http://localhost:3000/api/oauth/google/callback` (and the matching Google Console URI).

4. Build and run (requires `.env.neon` in the project root):

```sh
docker compose -f docker-compose.neon.yml up --build
```

5. Open [http://127.0.0.1:3000](http://127.0.0.1:3000) and **sign in as the Neon Auth owner** (not “local owner”).

`migrate` applies Drizzle migrations to Neon (prefer unpooled URL). `app` runs with `NODE_ENV=production` and `DATABASE_DRIVER=neon-http`. To publish on all interfaces (only if you understand the risk): `APP_HOST_BIND=0.0.0.0 docker compose -f docker-compose.neon.yml up --build`.

**Production checklist**

- [ ] No `INSECURE_LOCAL_DEV` / `ALLOW_INSECURE_LOCAL_DEV` in the env file
- [ ] HTTPS public URL, matching `GOOGLE_REDIRECT_URI`, and Neon Auth trusted domain
- [ ] Stable `TOKEN_ENCRYPTION_KEY_V1` and `NEON_AUTH_COOKIE_SECRET` (losing them breaks sessions/tokens)
- [ ] `OWNER_NEON_AUTH_USER_ID` matches the only Neon Auth user you intend to allow

---

## Install with Bun + Neon (no Docker)

1. Complete [Configure Neon](#configure-neon-postgres--auth) and [Configure Google Gmail OAuth](#configure-google-gmail-oauth).
2. Install and run:

```sh
bun install --frozen-lockfile
cp .env.example .env.local
# fill DATABASE_*, Neon Auth, OWNER_NEON_AUTH_USER_ID, Google OAuth, TOKEN_ENCRYPTION_KEY_V1
# optional for shadow audit: MODEL_NAME, MODEL_BASE_URL, MODEL_API_KEY (OpenAI — see above)
bun run db:migrate
bun run dev
```

3. Open [http://localhost:3000](http://localhost:3000), sign in as the configured Neon Auth owner, connect Gmail, configure triage, sync.

Use `DATABASE_DRIVER=neon-http` (default). Other identities are rejected.

### Migrations

Schema lives in `db/schema.ts`. Prefer the unpooled URL as `DATABASE_URL_UNPOOLED` for migrations when using Neon.

```sh
bun run db:check
bun run db:migrate
```

After schema edits: `bun run db:generate`, then `bun run db:migrate`.

## Local validation

```sh
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun test
bun run db:check
bun run build
```

Optional Neon / live-Gmail tests skip unless explicitly opted in. Never point tests at a production mailbox or database.

## License

MIT — see [`LICENSE`](LICENSE).
