# Documentation index

## Reading order for the AI features work

1. **[`../CONTEXT.md`](../CONTEXT.md)** — the glossary. Read first; the rest of the documents assume its vocabulary, and terms like `Audit Run`, `Category Intent`, `Verdict`, `Owner Label`, and `Message Snapshot` are used precisely rather than loosely.
2. **[`adr/`](./adr/)** — the twelve accepted decisions, `0001` to `0012`. Each records what was decided and why, including the alternatives rejected and the reasons, so a decision can be revisited without re-deriving the argument.
3. **[`ai-features-roadmap.md`](./ai-features-roadmap.md)** — nine delivery slices, a risk register, and the open questions deliberately left until spec time. Contains no decisions; those live in the ADRs.
4. **[`deferred-decisions.md`](./deferred-decisions.md)** — eight things consciously not settled, each with the constraints already discovered so they can be picked up cold.
5. **[`ai-features-spec.md`](./ai-features-spec.md)** — the buildable product spec for AI adjudication, evals, observability, and the public demo. Authoritative for that work; derived from the ADRs and roadmap.

## Existing documents, and where they are now out of date

**[`product-spec.md`](./product-spec.md)** is authoritative for the app as originally built. Two parts of it are superseded:

- Its statement that raw MIME and full body text are transient in memory and never persisted is **reversed by ADR-0002**. Message snapshots are now persisted, encrypted, and retention-governed, and golden-set rows hold a frozen copy that outlives retention (ADR-0012).
- Its single-owner model, enforced in the database by the `owner_binding` singleton, still holds for production but is **relaxed in the demo variant only** by ADR-0006, via a demo-only migration and row-level security.

Everything else in it stands. The claim in the root README that there is no LLM in the sync path also still stands — adjudication is a separate audit run, by design (ADR-0001).

**[`implementation-roadmap.md`](./implementation-roadmap.md)** is the original foundation roadmap, mapping acceptance criteria AC-1 to AC-11. It is historical; it does not cover any of the AI work.

**[`operations/readiness.md`](./operations/readiness.md)** predates all of this.

## Fixture corpus caveat

The 100-message adversarial corpus (`src/server/gmail/corpus.ts`) is easier than real mail. It is constructed to exercise known matching seams and to give the demo/judge something visible to correct. It proves triage machinery, not classifier quality (ADR-0008). `APP_PROFILE=demo` or `ci` selects `DeterministicGmailFake` seeded from that corpus.

## Tracking

Deferred items D-1 through D-7 are GitHub issues [#4](https://github.com/noahpatterson/emailTriager/issues/4)–[#10](https://github.com/noahpatterson/emailTriager/issues/10). D-8 is recorded in `deferred-decisions.md` but not yet ticketed.
