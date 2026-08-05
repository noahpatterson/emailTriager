# AI features roadmap

Sequenced delivery plan for the decisions recorded in ADR-0001 through ADR-0011. Ordered to retire the riskiest unknowns first and to keep every slice independently shippable and testable. Nothing here is a decision — decisions live in `docs/adr/`.

## Ordering principles

Front-load the two things that cannot be discovered late: whether the serverless database path works at all, and whether the fixture corpus is genuinely adversarial. Both would otherwise surface at the very end, after everything has been built on top of them.

Build the whole AI pipeline in shadow before it is permitted to touch Gmail. Mutation is the only irreversible thing here, so it comes last among the AI slices, after the judge has been scored against real labels.

Keep the model out of the critical path for as long as possible. The corpus, the matching eval, and the fake Gmail provider all work with no model at all, which means the expensive and non-deterministic parts can be developed against a fully deterministic environment.

## Slice 0 — Data foundations

**Ships:** `Message Snapshot` capture during sync, encrypted under the existing versioned-key scheme and governed by the existing retention window. `Category Intent` as a versioned field alongside term lists, with validation and a settings surface.

**Proves:** nothing yet — this is pure additive data work with no model dependency. Everything downstream reads these two artifacts.

**Retires:** the ADR-0002 reversal, which is the only schema change that touches production behaviour.

## Slice 1 — Deployment spike

**Ships:** the existing app, unchanged in behaviour, deployed to Vercel with Neon via Terraform, in a Neon project separate from the personal one. Migrations running from CI, preserving the existing no-`pull_request`-trigger posture. No demo features and no AI.

**Proves:** that `pg` over Neon's pooler behaves under serverless connection churn, that cold starts are acceptable, and that the deployment is reproducible from code.

**Retires:** the two infrastructure risks that would otherwise surface in Slice 7, after the demo depends on them. Also establishes the Terraform skill demonstration on the environment that actually matters rather than on a side-quest.

**Two constraints from the existing code.** `getServerConfig()` calls `required()` for the Google and Neon Auth variables, so the spike runs with placeholder values for those and a real `DATABASE_URL` — the database path is the point, and placeholders mean no Google Console changes and no real secrets on a throwaway deploy. And because every existing route is owner-gated, nothing touches the database without auth, so the spike needs a minimal unauthenticated health route that asserts connectivity and discloses nothing.

**Pull one risk forward.** Include a probe proving that `SET LOCAL` inside an explicit transaction is correctly scoped under Neon's pooler, and that a bare `SET` leaks across requests. This is the single most dangerous detail in the whole plan, and proving it here costs almost nothing, where discovering it in Slice 7 costs a cross-tenant leak in a live demo.

**State is local for now**, which is a deliberate shortcut, not a recommendation — see D-8. Before the first `apply`, `.gitignore` needs `*.tfstate*`, `.terraform/`, and `*.tfvars`, none of which it currently has; with local state a stray commit publishes database URLs and tokens.

## Slice 2 — Corpus and runtime Gmail fake

**Ships:** 100 adversarial fixtures with hand-audited labels and a recorded exemplar/holdout split. `DeterministicGmailFake` promoted from a test-only class to a runtime provider selected by profile.

**Proves:** an end-to-end environment that needs no Gmail account and no model, which every later slice develops against.

**Retires:** the labelling effort, which is unglamorous, load-bearing, and would otherwise block the demo at the very end.

## Slice 3 — Matching eval

**Ships:** full-replay scoring of a candidate term list over the golden set, with a confusion matrix, per-category precision and recall, and one cost-weighted scalar. No model involved.

**Proves:** that the corpus is actually adversarial. If this reports near-zero error, Slice 2 failed its purpose and must be revisited before any AI work begins.

**Retires:** the risk of building the judge on top of a corpus that has nothing to teach it.

## Slice 4 — Model layer and the judge, in shadow

**Ships:** Vercel AI SDK with split configuration and append-only prompt versioning. Audit runs — bounded, resumable, one model call per message with bounded concurrency — producing persisted verdicts. OpenTelemetry spans exported to Langfuse. Auto-apply off; no Gmail mutation whatsoever.

**Proves:** that OpenTelemetry works under the actual runtime, and that prompts can be iterated against the corpus at zero mailbox risk.

**Retires:** the Bun and OpenTelemetry uncertainty, and the possibility of an unproven judge touching real mail.

## Slice 5 — Judge eval and human review

**Ships:** stratified review queue reading snapshots, recording owner labels. Judge scoring against the holdout, including malformed-output rate, every run tagged with model, provider, and prompt version.

**Proves:** whether the judge is any good, in numbers, before it is given authority.

**Retires:** the eval-comparability risk, by enforcing run tagging in code rather than by memory.

## Slice 6 — Mutation with asymmetric authority

**Ships:** promotions applied automatically; demotions into archive requiring confirmation; `protected` mail untouchable. Auto-apply becomes a setting that can be turned on.

**Proves:** the feature actually asked for in items 1 and 2.

## Slice 7 — Demo variant

**Ships:** demo profile, mock OAuth minting a distinct fake Google subject per session, crypto-random httpOnly session cookie, synthetic owner ids isolated by row-level security, the demo-only relaxation migration, session cap and time-to-live, documented state reset, seeded corpus, mocked model, and the in-app trace viewer.

**Proves:** the whole system to a stranger with no account, no live service, and no spend.

**Critical detail:** the RLS session variable must be set with `SET LOCAL` inside an explicit transaction. A plain `SET` persists on the pooled connection and leaks the previous visitor's identity to the next request.

## Slice 8 — Second deployment target and scheduling

**Ships:** Render deploy building the existing Dockerfile, GitHub Actions scheduling against authenticated routes, both public environments declared in Terraform in the public Neon project.

**Proves:** that the container definition still works, which unused Dockerfiles reliably stop doing.

## Risk register

| # | Risk | Where it bites | Mitigation |
|---|---|---|---|
| R-1 | RLS session variable set with bare `SET` instead of `SET LOCAL` in a transaction persists on a pooled connection and leaks the previous visitor's identity | Slice 7, publicly | Probe it in Slice 1 as an executable test, five slices before it matters |
| R-2 | The demo-only relaxation migration needs a clean drizzle-kit mechanism, not a hand-edited journal | Slice 7 | Decide the mechanism during Slice 0, while the migration set is already being touched |
| R-3 | `pg` over Neon's pooler under serverless connection churn is unproven for this app | Slice 1 | The whole point of Slice 1 |
| R-4 | OpenTelemetry under Bun and Next 16 has historically been patchy | Slice 4 | Manual spans only, no auto-instrumentation; AI SDK emits its own |
| R-5 | Hand-auditing 100 labels is unglamorous manual work that every downstream metric depends on | Slice 2 | Front-loaded deliberately; Slice 3 validates the result |
| R-6 | Vercel Hobby's non-commercial clause nominally covers "financial gain of anyone involved" | Slice 1 onward | Accepted knowingly; Render or a paid tier removes the ambiguity |
| R-7 | Eval scores are incomparable unless every run is tagged with model, provider, and prompt version | Slice 5 | Enforce tagging in code, not by discipline |
| R-8 | A Neon branch of the personal project would inherit real message bodies into a public environment | Slice 1 | Public environments live in a separate Neon project — see ADR-0009 |
| R-9 | Local Terraform state holds database URLs and tokens in plaintext with no locking | Slice 1 | Gitignore entries before first `apply`; remote backend tracked as D-8 |

## Open questions to settle at spec time

Decisions consciously left until there is code to attach them to. None of these change the architecture; all of them need answers before the relevant slice ships.

- **Cost weights for the eval metric.** The shape is agreed — confusion matrix plus one cost-weighted scalar with priority loss dominating — but the actual weights per confusion cell are not.
- **Judge prompt design.** How category intent and exemplars are assembled, how many exemplars, the verdict schema's exact fields, and whether the rationale is free text or constrained.
- **Prompt window width.** Snapshots store full text and the prompt sends a narrower view; how narrow is unsettled, and it is itself a candidate worth evaluating.
- **Review queue interaction design.** What a reviewer sees, the keyboard flow, and how many items constitute a sitting.
- **Defaults:** audit-run concurrency, the agreement sampling rate (starting point ~10%), demo session cap and time-to-live.
- **Category intent migration.** What existing `triage_config` versions get for a field that did not exist when they were written.
- **Whether `unmatched` and `blocked` are distinct to the judge**, given both currently file to archive.
- **Demo reset instructions.** The wording a visitor sees for clearing their own state.
