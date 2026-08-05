# Two deployment targets: Vercel for the demo, Render for containers

The public demo runs on Vercel Hobby, the canonical real-world path for a Next.js app, which brings per-PR preview deployments and fast cold starts at no cost. A parallel deploy on Render's free tier builds the existing Dockerfile, which keeps the container definition honest — unused Dockerfiles rot silently. Both use Neon in a **separate Neon project** from the personal one — not a branch of it. Neon branches inherit parent data, and since ADR-0002 the production database holds real message bodies, so branching it into a public demo would copy real email content into a public environment. Scheduling comes from GitHub Actions hitting authenticated routes, because Vercel Hobby's built-in cron is capped at once per day.

## Considered Options

**Render alone.** The only no-credit-card free tier and it uses the Dockerfile, but free services sleep after fifteen minutes and cold-start in thirty to sixty seconds. Its own free Postgres also hard-expires after 30–90 days and is then deleted, so Neon is used regardless.

**Fly.io.** Technically the best fit — Docker-native, sub-second wake from zero — but its free tier ended in 2024, so roughly three dollars a month.

## Consequences

Two pipelines to keep green.

Vercel Hobby is restricted to non-commercial personal use. A job-hunting portfolio is the ordinary case, but the clause nominally covers financial gain of anyone involved, so this is a gray area accepted knowingly rather than a blessing.

Because the demo runs on pooled serverless connections, the row-level-security session variable must be set with `SET LOCAL` inside an explicit transaction. A plain `SET` persists on the pooled connection after the request ends, and the next request to reuse it inherits the previous visitor's identity — reintroducing the exact cross-tenant leak that RLS was chosen to prevent.
