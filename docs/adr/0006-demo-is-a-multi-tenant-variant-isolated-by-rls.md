# The demo is a multi-tenant variant, isolated by row-level security

A public demo must let many strangers use it at once, but the production app is single-owner enforced in the database: `owner_binding` has a boolean primary key with a `CHECK` constraining it to true, so exactly one row can ever exist, and `gmail_connection` hangs off it by primary key. Rather than weaken that, the demo gets **one extra migration** of its own that drops the singleton primary key and check. Application code is unaffected, because every query already filters by `auth_user_id` and behaves identically whether one row is possible or many. Production keeps its guarantee; divergence is a single auditable file.

Each visitor is issued a crypto-random, httpOnly session cookie mapped to a synthetic owner id. Isolation between visitors is enforced by **Postgres row-level security**, with policies keyed to a session variable set per request.

## Considered Options

**Relax the singleton in the shared schema.** Simplest, but it trades a database-level security control for application-level intent in production, where the control actually matters.

**A Postgres schema per demo session.** The strongest isolation, and it preserves the singleton exactly. Rejected as more operational machinery than a demo warrants — per-session migration runs and a schema-reaping job.

**Application-layer scoping alone.** Rejected: tenant scoping enforced by remembering to write `where owner_id = ?` fails silently and identically every time — one missed clause leaks another visitor's records with no error. RLS inverts the failure mode, so a forgotten filter returns nothing instead of everything.

## Consequences

The demo must run `DATABASE_DRIVER=pg`. RLS session variables need a session to live in, and `neon-http` issues every query as an independent stateless HTTP request.

Mock OAuth must mint a distinct fake Google subject per session, because `gmail_connection.google_subject` carries a global `UNIQUE` and the second visitor to connect would otherwise hit a constraint violation.

Demo sessions need a cap and a time-to-live. Nothing costs money — Gmail and the model are both faked — but unbounded session creation is still unbounded rows.
