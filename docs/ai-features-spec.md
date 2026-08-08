# AI Features Product Specification

**Status:** Approved implementation baseline for AI integration, evals, observability, and public demo  
**Scope:** ADR-0001 through ADR-0012 and the nine delivery slices in `ai-features-roadmap.md`  
**Last updated:** 2026-07-28  
**Supersedes (partially):** Two statements in `product-spec.md` — see `docs/README.md`. The original MVP spec is retained for the deterministic triage foundation; this document is authoritative for everything it covers.

**Authoritative decisions:** `docs/adr/0001`–`0012`. This spec translates those decisions into buildable requirements. Where this spec and an ADR disagree, the ADR wins.

---

## Problem Statement

The existing application classifies Gmail with deterministic keyword rules. That pass is fast, bounded, and reliable, but it only approximates what the owner actually wants. Term lists drift from intent, marketing mail borrows priority vocabulary, and silent misfiles into archive are expensive errors the owner may not notice until purge time.

The owner needs an AI judge that checks filings against stated **Category Intent**, corrects mistakes with asymmetric authority, and proves its value through human-in-the-loop evaluation — without putting a model in the sync path or depending on any observability vendor as the system of record.

Separately, the project is a portfolio showcase. A stranger must be able to use the full pipeline — sync, audit, review, eval, trace viewing — with no Gmail account, no live model spend, and no risk of seeing another visitor's data.

## Solution

Add four capabilities on top of the existing deterministic foundation:

1. **Persisted evidence** — encrypted **Message Snapshots** during sync and versioned **Category Intent** alongside term lists, governed by retention.
2. **AI adjudication** — a separate, bounded, resumable **Audit Run** that reads snapshots, issues a **Verdict** per message, and may **Promote** misfiled mail automatically while requiring confirmation for **Demotions** into archive.
3. **Evaluation and review** — a **Golden Set** with frozen text, disjoint **Exemplar Pool** and **Holdout** partitions, **Eval Runs** for both matching and judge quality, and a stratified human **Review Queue** that records **Owner Labels** and re-files the chosen category in Gmail.
4. **Public demo and infrastructure** — a multi-tenant demo variant isolated by Postgres row-level security, a 100-message adversarial fixture corpus, mocked Gmail and model providers, reproducible deployment via Terraform (Vercel + Neon) and a second target (Render), with OpenTelemetry traces exported to Langfuse first and swappable later.

Delivery is sequenced in nine slices (Slice 1 before Slice 0 per current plan). Each slice ships independently and is testable before the next begins.

## User Stories

### Foundation and data

1. As an owner, I want parsed message text stored during sync, so that the judge and evals can replay classification without re-fetching from Gmail.
2. As an owner, I want stored message text encrypted at rest and expired by the existing retention policy, so that PII does not accumulate indefinitely.
3. As an owner, I want protected mail (starred, whitelisted, or unparseable sender) excluded from snapshots, so that the most sensitive mail is never persisted for AI features.
4. As an owner, I want to write prose **Category Intent** for each category, so that correctness is measured against what I mean, not against the term lists alone.
5. As an owner, I want category intent versioned alongside triage configuration, so that eval scores remain attributable to the intent that was in force.
6. As an owner, I want existing configuration versions to load with empty category intent fields, so that migration does not break my current setup.
7. As an operator, I want snapshot storage width independent of judge prompt width, so that I can narrow prompts without losing evidence for future algorithm changes.

### Sync path (unchanged behaviour)

8. As an owner, I want sync runs to remain deterministic with no model call, so that sync stays bounded, fast, and unable to fail on model timeout.
9. As an owner, I want trial mode to continue working without snapshots if that is simpler for the first slice, so that existing workflows are not regressed — *note: snapshots are captured for all non-protected processed messages once Slice 0 ships; trial mode reports outcomes as today*.
10. As an owner, I want the match corpus to remain computed in memory and never stored, so that future matching algorithms are not evaluated against evidence pre-chewed by today's normalization.

### Audit run and judge

11. As an owner, I want to trigger an audit run manually after a completed sync run, so that I control when the model is invoked.
12. As an owner, I want audit runs to read stored snapshots rather than Gmail, so that adjudication works offline and is testable without a mailbox.
13. As an owner, I want one model call per message with bounded concurrency, so that a malformed response cannot poison a batch and per-message traces stay attributable.
14. As an owner, I want audit runs bounded and resumable with the same lease and progress machinery as sync, so that serverless timeouts and slow models are handled like sync already handles them.
15. As an owner, I want verdicts persisted with the model, provider, and prompt version that produced them, so that results are comparable across time.
16. As an owner, I want the judge to receive category intent, a bounded view of the snapshot, the deterministic classification outcome, and exemplars from the exemplar pool, so that it judges against intent rather than re-implementing term matching.
17. As an owner, I want the judge to treat `blocked` and `unmatched` as distinct filing reasons even though both land in archive, so that sender-block context is visible in the verdict rationale.
18. As an owner, I want auto-apply off by default, so that I can run the judge in shadow before it mutates Gmail.
19. As an owner, I want to enable auto-apply as a setting once I trust the judge, so that promotions happen without manual confirmation.
20. As an owner, I want the judge to promote freely — out of archive or unmatched, and upward among new, review, and priority — without confirmation, so that the most valuable corrections happen automatically.
21. As an owner, I want demotions into archive to require my explicit confirmation, so that the model cannot silently queue mail for later purge.
22. As an owner, I want the judge to never touch protected mail, so that starred and whitelisted messages retain the same restraint as the deterministic pass.
23. As a portfolio visitor, I want to watch a misfiled message get corrected in the demo mailbox, so that the value of adjudication is observable.
24. As an owner, I want malformed model output counted as a first-class metric per eval run, so that model changes that break structured output are visible immediately.

### Human review

25. As an owner, I want a review queue showing disagreements and a sample of agreements, so that I measure judge quality rather than hand-file individual messages.
26. As an owner, I want every disagreement queued automatically, so that rare high-impact errors are never skipped.
27. As an owner, I want approximately ten percent of agreements sampled, so that false negatives are detectable and not only false positives.
28. As an owner, I want review to read the stored snapshot, not live Gmail, so that review works offline and reflects the evidence the judge saw.
29. As an owner, I want to record an owner label per reviewed message, so that my judgment becomes ground truth for eval.
30. As an owner, I want review to re-file the message in Gmail to my Owner Label, so that correcting a verdict also fixes the mailbox.
31. As an owner, I want keyboard-driven review flow, so that labeling a sitting of ~20 items is efficient.
32. As an owner, I want to see the deterministic outcome, verdict, snapshot excerpt, and category intents side by side while reviewing, so that I can judge whether the judge read intent correctly.

### Golden set and evaluation

33. As an owner, I want owner-labeled messages copied into the golden set with frozen text, so that eval evidence outlives snapshot retention.
34. As an owner, I want the golden set split into exemplar pool and holdout with the split recorded, so that judge eval scores are not contaminated by training examples.
35. As an owner, I want to score a candidate term list by full replay over the golden set, so that I can quantify how well terms approximate intent.
36. As an owner, I want matching eval to produce a confusion matrix, per-category precision and recall, and one cost-weighted scalar, so that term-list changes are comparable.
37. As an owner, I want priority misclassification penalized most heavily in the cost-weighted score, so that the metric reflects business impact.
38. As an owner, I want to score a candidate judge configuration against the holdout, so that prompt and model changes are measurable before auto-apply.
39. As an owner, I want judge eval to report malformed-output rate alongside accuracy metrics, so that structured-output regressions are visible.
40. As an operator, I want a 100-message adversarial fixture corpus with hand-audited labels, so that demo and CI do not depend on live Gmail or owner labor.
41. As an operator, I want roughly a quarter of fixtures deliberately misfiled by current term lists, so that AI features demonstrate visible value rather than no-op agreement.
42. As a portfolio reader, I want documentation to state that the demo corpus is easier than real mail, so that benchmark claims are not overstated.

### Observability

43. As an operator, I want OpenTelemetry spans around audit runs, model calls, and eval runs, so that latency and failure modes are visible.
44. As an operator, I want traces exported to Langfuse Cloud first via OTLP, so that observability is demonstrated with minimal integration work.
45. As an operator, I want the exporter swappable by configuration, so that Phoenix and Braintrust can be tried without rewriting instrumentation.
46. As an operator, I want Postgres to remain the system of record for snapshots, verdicts, owner labels, and eval scores, so that the app works with no exporter configured.
47. As a demo visitor, I want an in-app trace viewer reading our own tables, so that I see real spans without a live Langfuse dependency.
48. As an operator, I want manual spans only (no OTel auto-instrumentation), so that Bun/Next runtime fragility is avoided.

### Demo variant

49. As a portfolio visitor, I want to use the app without a Google account, so that I can evaluate the project immediately.
50. As a portfolio visitor, I want mock OAuth that mints a distinct fake Google subject per session, so that connection state does not collide across visitors.
51. As a portfolio visitor, I want a crypto-random httpOnly session cookie, so that my demo identity is not guessable.
52. As a portfolio visitor, I want my data isolated from every other visitor by database row-level security, so that a bug in application filtering cannot leak my records.
53. As an operator, I want the RLS session variable set with `SET LOCAL` inside an explicit transaction, so that pooled connections cannot inherit another visitor's identity.
54. As an operator, I want demo sessions capped and time-limited, so that unbounded row creation cannot be abused.
55. As a portfolio visitor, I want a control to clear my own demo data, with clear wording that my data is not shared with others, so that I can start fresh.
56. As a portfolio visitor, I want the demo to run against a mocked model via the AI SDK mock provider, so that there is no inference spend.
57. As a portfolio visitor, I want the demo mailbox seeded from the adversarial fixture corpus, so that sync and audit show interesting disagreements.
58. As an owner using production, I want the single-owner database guarantee unchanged, so that relaxing tenancy for demo does not weaken my deployment.

### Infrastructure and deployment

59. As an operator, I want the app deployed to Vercel with Neon declared in Terraform, so that the serverless path is reproducible from code.
60. As an operator, I want public environments in a separate Neon project from my personal one, so that branching never copies real message bodies into a public database.
61. As an operator, I want migrations run from CI without a `pull_request` workflow trigger, so that outside PRs never execute against our infrastructure.
62. As an operator, I want a minimal unauthenticated health route that asserts database connectivity without disclosing secrets, so that deployment spikes can validate the database path before auth is wired.
63. As an operator, I want placeholder values acceptable for Google and Neon Auth env vars during the deployment spike, so that infrastructure can be proven without OAuth setup on a throwaway deploy.
64. As an operator, I want an executable probe in Slice 1 proving `SET LOCAL` scopes correctly under Neon's pooler, so that the cross-tenant leak risk is retired before the demo ships.
65. As an operator, I want a second deployment on Render building the existing Dockerfile, so that the container definition stays honest.
66. As an operator, I want GitHub Actions scheduling against authenticated routes, so that periodic jobs work despite Vercel Hobby cron limits.
67. As an operator, I want Terraform state gitignored before first apply, so that database URLs and tokens are not committed.
68. As an operator, I want Terraform for the SaaS layer and CDK reserved for a future AWS variant, so that each IaC tool is used where it is idiomatic.

### Deferred (explicitly not in initial delivery)

69. As an owner, I want audit runs to auto-chain after sync completion — *deferred (D-1); manual trigger first*.
70. As an owner, I want a sticky owner verdict that suppresses later audit mutations on that message — *deferred (D-2); re-file on review already ships (story 30)*.
71. As an operator, I want Phoenix and Braintrust exporters alongside Langfuse — *deferred (D-3); Langfuse first*.
72. As an owner, I want inline judging inside sync — *deferred, leaning rejected (D-4)*.
73. As an operator, I want an AWS ECS/Lambda deployment via CDK — *deferred (D-5)*.
74. As an operator, I want named model profiles — *deferred (D-6)*.
75. As an owner, I want confidence-based review sampling — *deferred (D-7)*.
76. As an operator, I want remote Terraform state — *deferred (D-8); local state with gitignore first*.

## Implementation Decisions

### Testing seams

The implementation should prefer existing seams and add the fewest new ones possible. The primary seam is **application profile** (`APP_PROFILE` or equivalent), which selects at startup:

| Concern | Production | Demo / CI |
|---|---|---|
| Gmail | `GoogleGmailProvider` via OAuth | `DeterministicGmailFake` seeded from fixture corpus |
| Model | Vercel AI SDK with configured hosted or local OpenAI-compatible endpoint | AI SDK `MockLanguageModel` with deterministic verdicts |
| Auth | Neon Auth + single owner binding | Mock OAuth + synthetic owner id per session |
| Database tenancy | Singleton owner binding + owner-scoped queries | Demo migration relaxes singleton; RLS policies keyed on session variable |
| Observability exporter | Langfuse OTLP (configurable; none is valid) | None; in-app trace viewer reads Postgres |
| Schema | Standard migrations | Standard + demo-only relaxation migration |

**Highest test seams (in priority order):**

1. **`GmailProvider` interface** — already exists with `DeterministicGmailFake`; all sync, trial, and audit-mutation tests run against the fake without network.
2. **Audit run executor** — new service parallel to `MessageSyncService`; test with in-memory or test-database snapshots and mocked model, no Gmail.
3. **Model boundary** — Vercel AI SDK with injectable provider; unit tests use `MockLanguageModel`; integration tests may hit a local OpenAI-compatible server.
4. **Matching eval** — pure function over golden-set rows; no Gmail, no model.
5. **RLS session probe** — executable integration test against real `pg` pooler (Slice 1), asserting `SET LOCAL` does not leak across sequential transactions on the same pooled connection.

New code should not bypass these seams with ad-hoc `fetch` to Gmail or direct model HTTP outside the SDK boundary.

### Slice 0 — Data foundations

- Add `message_snapshot` table: owner id, message id, run id, encrypted parsed text (subject, from, body, selected headers), created timestamp. No row for protected outcomes.
- Reuse existing `encryptSecret` / `decryptSecret` versioned-key pattern from OAuth token storage.
- Govern snapshots with existing retention job; golden-set rows are exempt from retention by separate lifecycle (ADR-0012).
- Extend `triage_config` (or parallel versioned table field) with `category_intent` JSON: keys `priority`, `review`, `new`, `archive` mapping to prose strings. Validation: max length per field, required on save once AI features are enabled.
- Migration default for existing config versions: empty strings for all intent fields.
- Capture snapshot during sync after successful parse, before or after classification; store neutral parsed text, not match corpus.

### Slice 1 — Deployment spike

- Terraform: Vercel project, Neon project (separate from personal), environment variables, deploy hook or GitHub integration as appropriate.
- Add `.gitignore` entries: `*.tfstate*`, `.terraform/`, `*.tfvars`.
- Health route: `GET /api/health` returns 200 with `{ "ok": true }` only after a trivial database round-trip; no auth; no secret leakage.
- Spike runs with placeholder `GOOGLE_*` and auth env vars; real `DATABASE_URL` to the new Neon project.
- `DATABASE_DRIVER=pg` required for demo path; spike validates `pg` over Neon pooler under serverless churn.
- **RLS probe test:** open connection from pool, `BEGIN`, `SET LOCAL app.current_owner = 'A'`, read policy-gated row, `COMMIT`; repeat with `'B'` on same connection; assert no cross-read. Control case: bare `SET` without transaction must be documented as forbidden.

### Slice 2 — Corpus and runtime Gmail fake

- 100 fixtures as structured data (JSON or TypeScript module) with hand-audited owner labels and recorded exemplar/holdout split.
- Promote `DeterministicGmailFake` to runtime via profile-selected factory (replace direct `GoogleGmailProvider` construction in factory).
- Seed fake provider from fixture corpus for demo profile; messages paginate deterministically.
- Fixtures double as golden set for CI; split metadata checked into repo.

### Slice 3 — Matching eval

- `EvalRun` type `matching`: input is candidate term list + config bounds; replay classifier over golden-set frozen text; output confusion matrix, per-category precision/recall, cost-weighted scalar.
- **Cost weights (default):** diagonal correct = 0 cost; priority→archive = 100; priority→review/new = 40; review→archive = 60; new→archive = 50; archive→priority = 100; archive→review/new = 30; within {priority, review, new} confusion = 20; blocked/unmatched treated as archive for matrix purposes. Scalar = sum of cell costs / holdout size.
- Near-zero error rate on adversarial corpus triggers a hard failure in CI — corpus is not adversarial enough.

### Slice 4 — Model layer and shadow judge

- Dependencies: `ai`, `@ai-sdk/openai-compatible`, `zod` (pinned exact versions). Zod only at model boundary.
- Split config: `model_provider`, `model_name`, `model_base_url`, `model_api_key` (encrypted), `prompt_version` (append-only table).
- `AuditRun` table and service mirroring sync lease/fence/resume pattern.
- `Verdict` table: run id, message id, agrees with filing, recommended category, rationale (max 500 chars), model id, provider, prompt version, malformed flag.
- **Judge prompt assembly:** system message with all four category intents; user message with from, subject, truncated body (default 4000 chars from start of visible text), deterministic classification outcome, and up to 2 exemplars per category from exemplar pool (truncated snapshot excerpts). Prompt window width is a named config default and an eval candidate.
- **Verdict schema (zod):**

```typescript
{
  agrees_with_filing: boolean;
  recommended_category: "priority" | "review" | "new" | "archive";
  rationale: string; // max 500 chars
}
```

- Concurrency default: 5 parallel model calls per audit run.
- Auto-apply: off; no Gmail mutation from audit in this slice.
- OTel: manual spans for audit run start/finish, per-message judge call; export via OTLP to Langfuse when env vars set.

### Slice 5 — Judge eval and human review

- `EvalRun` type `judge`: score holdout only; metrics include accuracy, per-category recall, disagreement rate, malformed-output rate; tagged with model, provider, prompt version.
- Review queue API: list pending items stratified (all disagreements + 10% random agreements from last audit run).
- Review UI: snapshot excerpt, intents, deterministic outcome, verdict; owner selects category; persists `owner_label` and copies frozen text into golden set if not already present.
- Review session default page size: 20 items.
- Golden set insert on owner label: copy full frozen text into golden-set row; record exemplar vs holdout partition per fixture split rules for corpus-origin rows; owner-labeled production mail appends to holdout by default unless promoted to exemplar pool manually later (v1: all owner labels → holdout).

### Slice 6 — Mutation with asymmetric authority

- On verdict disagreeing with filing: if recommended category is higher than current (promotion), apply Gmail label change when auto-apply enabled; if demotion to archive, create pending confirmation record and surface in UI.
- Protected messages: skip in audit run entirely; no verdict row.
- Setting: `auto_apply_promotions` boolean, default false.
- Reuse existing label mutation and reconciliation paths; audit run calls same `modifyLabels` abstraction as sync.

### Slice 7 — Demo variant

- Demo-only migration: drop `owner_binding` singleton PK/check; enable RLS policies on all owner-scoped tables; policy `auth_user_id = current_setting('app.current_owner', true)`.
- Middleware: on each request, `BEGIN` → `SET LOCAL app.current_owner = <session owner id>` → handler → `COMMIT`.
- Mock OAuth flow: issues fake tokens; `google_subject` unique per session.
- Session cookie: httpOnly, Secure, SameSite=Lax, crypto-random; maps to synthetic `auth_user_id`.
- Session cap: 100 concurrent active sessions; TTL 24 hours; cleanup job deletes expired session rows and orphaned owner data.
- Demo reset copy: *"Clear my demo data removes everything associated with your session. Other visitors cannot see your messages. This cannot be undone."*
- In-app trace viewer: list spans from `audit_run` / `verdict` tables and OTel-derived timing columns if stored; no external vendor required.
- `APP_PROFILE=demo` enables all of the above; production build must not include demo migration.

### Slice 8 — Second deployment target and scheduling

- Render service from existing Dockerfile; Terraform declares service and env.
- GitHub Actions workflow: `workflow_dispatch` and cron schedule hitting authenticated sync/audit routes with stored secret.
- Both Vercel and Render point at branches of the **public** Neon project (not personal).

### Schema summary (new tables)

- `message_snapshot`
- `audit_run` (status enum parallel to sync)
- `verdict`
- `owner_label` / `golden_set_message` (frozen text, partition flag, source message id nullable for fixtures)
- `eval_run` (type, candidate descriptor, metrics json, tags)
- `prompt_version` (append-only)
- `pending_demotion` (message id, verdict id, confirmed at)
- `demo_session` (cookie hash, owner id, expires at) — demo only

Exact column types follow existing drizzle conventions in `db/schema.ts`.

### API surface (new routes, owner-gated unless noted)

- `POST /api/audit` — start or resume audit run for a sync run
- `GET /api/audit/:id` — status and progress
- `GET /api/review/queue` — stratified pending items
- `POST /api/review/:messageId` — submit owner label
- `POST /api/eval/matching` — run matching eval for candidate terms
- `POST /api/eval/judge` — run judge eval against holdout
- `GET /api/traces` — demo trace viewer data
- `POST /api/demo/reset` — demo only; clear session data
- `GET /api/health` — unauthenticated; Slice 1

### Category intent in settings UI

- Settings page adds a text area per category for intent prose, saved with triage config version bump.
- Validation mirrors term bounds: non-empty required before first audit run; max 2000 chars per category.

## Testing Decisions

**Principle:** Test external behaviour at the highest seam available. Do not assert internal call order unless it is a security or correctness invariant (e.g. RLS `SET LOCAL`).

| Area | Seam | Prior art |
|---|---|---|
| Classifier / matching | Pure functions over fixture text | `classify.test.ts` table-driven style |
| Snapshot capture | Sync integration with fake Gmail + test DB | `trial-sync.test.ts`, `oauth-sync.test.ts` |
| Matching eval | Golden-set replay, assert matrix and scalar | New; same table-driven vectors as classify tests |
| Judge structured output | MockLanguageModel returning valid/invalid JSON | New; follow `fake.test.ts` determinism |
| Audit run resume | Fake Gmail + mock model + lease timeout injection | Sync lease tests |
| Promotion vs demotion | Fake Gmail recording `modifyLabels` calls | `sync-labels.test.ts`, `ReconciliationFake` |
| RLS isolation | Real `pg` against Neon pooler or testcontainers Postgres | New; Slice 1 gate |
| Demo OAuth | Session cookie → distinct `google_subject` | `oauth-sync.test.ts` patterns |
| Health route | HTTP assertion only | New |

Malformed output: tests must include cases where model returns invalid schema and assert `malformed` flag without crashing the run.

CI must run matching eval against the adversarial corpus and fail if weighted error score is below a floor (corpus not challenging enough).

Preserve existing CI policy: no `pull_request` trigger on deploy workflows.

## Out of Scope

- Inline judging inside the sync loop (D-4, leaning rejected).
- Auto-chaining audit after sync in v1 (D-1); manual trigger only.
- Sticky owner verdicts that re-file and suppress future judge (D-2).
- Phoenix and Braintrust exporters in initial delivery (D-3); Langfuse first.
- AWS CDK deployment (D-5); design only.
- Named model profiles (D-6).
- Confidence-based review sampling (D-7).
- Remote Terraform backend (D-8); local state with gitignore until migrated.
- Migrating hand-rolled validators to zod outside the model boundary.
- Gmail search queries, ML classification inside sync, multi-owner production, attachment storage.
- Suggesting better terms automatically (well-posed later from matching eval; not v1 UI).
- Self-hosted Langfuse.
- Commercial SaaS tier upgrades (accepted Hobby gray area per ADR-0009).

## Further Notes

### Relationship to `product-spec.md`

The MVP spec remains authoritative for deterministic triage, OAuth, sync bounds, MIME parsing, matching, and owner trash controls. This spec adds AI, eval, observability, demo, and deployment layers. Where the MVP spec says bodies are never persisted or enforces strict single-owner at all times, ADR-0002 and ADR-0006 apply instead for the features this spec covers.

### Delivery order

Current plan: **Slice 1 (deployment spike) before Slice 0 (schema)**, to prove Neon pooler + Vercel before migration work. Slices 2–8 follow roadmap order. Slice 0 may overlap once Slice 1 health probe is green.

### Open question resolutions (spec time)

| Question | Decision |
|---|---|
| Cost weights | Defaults in Slice 3 section; tunable constants, not owner-facing in v1 |
| Judge prompt | Intents + truncated body + outcome + 2 exemplars/category |
| Prompt window | 4000 chars default; stored as prompt version metadata |
| Review UX | Side-by-side panel, j/k navigate, number keys for category, 20-item sittings |
| Defaults | Concurrency 5; agreement sample 10%; demo cap 100 sessions; TTL 24h |
| Intent migration | Empty strings on existing config versions |
| `unmatched` vs `blocked` | Distinct in verdict rationale; both map to archive for promotion/demotion rules |
| Demo reset copy | See Slice 7 |

### Risks (from roadmap; ownership unchanged)

R-1 (RLS `SET LOCAL`) is gated in Slice 1. R-2 (drizzle divergent migration) must be decided during Slice 0/7. R-3–R-9 mitigations unchanged from `ai-features-roadmap.md`.

### Prerequisites before first `terraform apply`

Neon API key and Vercel API token from the user. Do not guess or obtain programmatically. Gitignore Terraform artifacts first.

### Portfolio framing

Documentation and demo copy must state that the adversarial corpus proves machinery, not production classifier quality. The write-up should highlight: separate audit run, asymmetric mutation authority, RLS-isolated demo, eval with frozen evidence, OTel with swappable exporter, and IaC across Vercel/Render/Neon.
