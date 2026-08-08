# Deferred decisions

Work consciously postponed during the AI-features design session, with enough context to pick up cold. Each entry states what was deferred, why, and what has to be decided when it comes back. Accepted decisions live in `docs/adr/`; this file is only for what we chose *not* to settle.

Each entry is tracked as a GitHub issue: [D-1 #4](https://github.com/noahpatterson/emailTriager/issues/4), [D-2 #5](https://github.com/noahpatterson/emailTriager/issues/5), [D-3 #6](https://github.com/noahpatterson/emailTriager/issues/6), [D-4 #7](https://github.com/noahpatterson/emailTriager/issues/7), [D-5 #8](https://github.com/noahpatterson/emailTriager/issues/8), [D-6 #9](https://github.com/noahpatterson/emailTriager/issues/9), [D-7 #10](https://github.com/noahpatterson/emailTriager/issues/10).

## D-1 — Auto-chained audit trigger

**Status:** deferred · **Relates to:** ADR-0001

An audit run is triggered manually. The intended end state is that it fires automatically once a sync run completes, so nobody has to remember. This was always framed as a setting rather than an architectural change, so the audit pipeline must not acquire any dependency on being human-initiated.

**To decide:** whether the chain fires in-process at the end of a sync run or via the scheduler; what happens when a sync run finishes `partial_failure` or `bounded_incomplete`; whether auto-apply of promotions should default on or off once nobody is watching it run.

## D-2 — Sticky owner verdicts and the closed loop

**Status:** deferred · **Relates to:** ADR-0004

Human review now records an Owner Label **and** re-files the message in Gmail. Without a pinned/sticky verdict, a later audit run can still disagree and enqueue demotion or auto-promote again. `gmail_message_state` is already shaped to hold that pin.

**To decide:** whether a pinned owner verdict suppresses future audit mutations on that message permanently, only until category intent changes, or never (accept occasional re-contest).

## D-3 — Additional observability exporters

**Status:** deferred · **Relates to:** ADR-0005

Langfuse Cloud is first because it needs nothing but an OTLP endpoint and an auth header. Phoenix and Braintrust are intended to follow to demonstrate that the exporter really is swappable.

**To decide:** whether exporters fan out simultaneously or are selected one at a time; whether score export (as opposed to trace export) is worth implementing per vendor, given each has a different score API and our own tables remain the system of record.

## D-4 — True inline judging

**Status:** deferred, leaning rejected · **Relates to:** ADR-0001

Consulting the judge inside the sync loop so an incorrect label never reaches Gmail. Rejected for now because it puts a model call in the Gmail mutation path and forfeits the bounded, fast, deterministic sync. Recorded because it was the original instinct and because it is the only way to eliminate label churn entirely.

**To decide:** whether the churn from correcting after the fact is actually annoying in daily use. Revisit only if lived experience says yes.

## D-5 — AWS deployment variant

**Status:** deferred · **Relates to:** ADR-0009

A third deployment target to demonstrate AWS competence, stood up on demand and destroyed afterwards rather than left running.

**Known constraints:** on ECS Fargate the load balancer is the cost floor, around $16/month regardless of traffic and not meaningfully scalable to zero — acceptable only under a stand-up-then-destroy model. Aurora Serverless v2 has a half-ACU floor that costs more per month than everything else combined, so keep Neon as the database rather than adopting RDS or Aurora.

**To decide:** ECS Fargate (reuses the existing Dockerfile, most transferable container skill) versus Lambda plus CloudFront via OpenNext/SST (genuinely zero at idle); whether any AWS-managed database is worth paying for purely as a skill demonstration.

## D-6 — Named model profiles

**Status:** deferred, speculative

Model configuration is a flat set of database settings. Named profiles — `local-judge`, `dev-mini` — would let a whole configuration be switched in one action and let eval runs be tagged by profile name rather than by an assembled tuple of provider, model, and prompt version.

**To decide:** whether flat settings become unwieldy in practice. Worth revisiting once there are enough eval runs to compare that the tagging is annoying.

## D-7 — Confidence-based review sampling

**Status:** deferred, speculative · **Relates to:** ADR-0004

Review sampling is stratified: every disagreement plus a fixed share of agreements. An alternative is to have the judge emit a confidence score and queue everything below a threshold. This was not chosen because a self-reported confidence score is itself unvalidated, and validating it needs the stratified sample anyway.

**To decide:** once enough owner labels exist to check whether the judge's confidence correlates with its accuracy at all. If it does, it becomes a cheaper sampling signal; if it does not, that is a finding worth writing up.

## D-8 — Move Terraform state to a remote backend

**Status:** deferred, deliberate shortcut · **Relates to:** ADR-0011 · **Not yet ticketed**

Terraform starts with local state to keep the first deployment simple. This is a known compromise, not a recommendation. Local state stores database URLs and API tokens in plaintext on one machine, offers no locking, keeps no history, and if lost leaves Terraform unable to track the resources it created — leaving them to be imported or deleted by hand.

**Production options, roughly in order of fit:**

- **HCP Terraform free tier** — remote encrypted state, locking, and run history with nothing to operate. The default answer for a project this size.
- **Terraform `pg` backend** in the public Neon project — adds no vendor, reuses Postgres already in the stack, locks via advisory locks. Slightly unusual, entirely valid.
- **S3 with DynamoDB locking** — the natural choice once the AWS and CDK work in D-5 exists, and pointless before then.

**To decide:** which backend, and whether to migrate before or after the demo goes public. Migrating is a `terraform init -migrate-state` away, so the cost of deferring is bounded — but it rises the moment more than one machine or person runs `apply`.

**Prerequisite:** `.gitignore` currently has no Terraform entries. Add `*.tfstate*`, `.terraform/`, and `*.tfvars` before the first `apply`.
