# Portfolio synopsis — Email Triage

Copy and shot list for a personal project website. Prefer a clean demo mailbox or `APP_PROFILE=demo` corpus so subjects aren’t embarrassing. Blur sender addresses if needed.

---

## One-liner

**Email Triage** is a single-owner Gmail console that files mail with deterministic rules, then runs a separate AI audit against your stated category intent—without putting a model in the sync path.

---

## Short synopsis (project card / about blurb)

Most “AI email” tools put a model between you and every message. Email Triage does the opposite: a fast, bounded, local classifier applies your terms and sender lists to a Gmail source label; an optional shadow audit later judges those filings against prose **category intent**, can promote misfiles, and requires confirmation before anything is demoted into archive.

Built for one owner, one mailbox. Sync stays predictable; AI stays measurable. Human review and demotion queues turn disagreements into ground truth—not a second inbox to manage.

---

## Medium case study

### Problem

Keyword triage is reliable but drifts from what you actually mean. Marketing copy borrows priority language; silent archive misfiles are expensive. Putting an LLM on every sync makes latency, cost, and failure modes worse.

### Approach

1. **Deterministic sync** — Pull from one source label, parse MIME locally, match whole-token terms, apply whitelist / blocklist / starred protection, write Gmail labels. Bounded, resumable, trial mode available.
2. **Encrypted snapshots** — Store evidence for later judgment (not for re-searching Gmail).
3. **Separate audit run** — OpenAI judge scores filings against category intent; promotions can auto-apply; demotions need confirmation.
4. **Measurement loop** — Stratified review queue, owner labels, golden-set / eval machinery so judge and term-list quality are scored, not assumed.

### Why it’s interesting

Architecture over vibes: **rules for action, models for adjudication**, asymmetric authority so the model can’t quietly queue mail for purge, and an owner-only security model (Neon Auth + encrypted OAuth tokens).

### Stack

Next.js · TypeScript · Neon Postgres · Neon Auth · Gmail API · OpenAI (audit only) · Bun · Docker

---

## Feature bullets

Pick 4–6 for a project card:

- Owner-only Gmail triage with OAuth, encrypted tokens, and label mutations (no send/compose)
- Deterministic classification: priority / review / new / archive, plus protected & blocked
- Trial sync that shows outcomes without touching Gmail
- Category intent + shadow AI audit with promote-vs-confirm-demote asymmetry
- Keyboard-friendly review queue for judge disagreements (and sampled agreements)
- Demotion confirmation queue before archive
- Bounded, resumable sync/audit runs with run history

---

## Ultra-short card copy

**Email Triage** — Personal Gmail triage with deterministic filing and a separate AI audit against your category intent. Sync stays rule-based; the judge promotes misfiles and asks before demoting to archive.

---

## Honest constraints (footer / notes)

Single-owner personal experiment · not multi-user SaaS · AI is OpenAI-only on the audit path · MIT, use at your own risk.

---

## Suggested screenshots

Capture on desktop (~1440px wide). Prefer light mode. Hide the insecure-local banner if possible.

| # | Shot | Where | What to show | Caption idea |
|---|------|--------|--------------|--------------|
| **1** | Hero / dashboard | `/` after connect + config | Brand, connect/sync controls, recent runs, Gmail label jump links | “Owner console: sync, trial, and run history” |
| **2** | Trial results | Dashboard after **Trial** sync | Outcome list with reasons (matched term, protected, blocked…) | “Dry-run classification before any label write” |
| **3** | Configuration — terms | `/configuration` | Priority / review / new term lists + source/destination labels | “Whole-token terms and Gmail label mapping” |
| **4** | Configuration — intent | Same page, scroll to **category intent** | Prose definitions for each category | “Intent is the standard of correctness—not the term list alone” |
| **5** | Review queue | `/review` with a disagreement open | Deterministic outcome vs verdict vs snapshot excerpt side by side | “Human review measures the judge; it doesn’t replace triage” |
| **6** | Demotion queue | `/demotion` with ≥1 pending item | Confirm/reject demotion into archive | “The model may promote freely; demotion needs you” |
| **7** | Run detail | `/runs/[id]` with mixed outcomes | Per-message results + status (completed / bounded incomplete) | “Every sync is bounded and auditable” |
| **8** | Settings (optional) | `/settings` | Connection status + archive trash as a clearly labeled danger zone | “Destructive actions are explicit and opt-in” |

### Priority if you only take four

**1 → 4 → 5 → 6** (dashboard, intent, review, demotion). That sequence tells the whole story: rules → intent → measure → safety.

### Framing tips

- Fill the review queue with a **visible disagreement** (e.g. archive → priority)—that’s the money shot.
- On config, crop so **intent + one term list** are both readable without a giant scroll collage.
- Avoid raw API/JSON screens; the UI is the portfolio surface.
- Optional diagram (not a screenshot): Sync → Snapshots → Audit → Review/Demotion — one horizontal flow.

---

## Related docs

- [`product-spec.md`](./product-spec.md) — deterministic MVP contract
- [`ai-features-spec.md`](./ai-features-spec.md) — audit, review, eval, demo
- [`../CONTEXT.md`](../CONTEXT.md) — glossary (outcome vs verdict, promote vs demote, etc.)
- [`../README.md`](../README.md) — setup and boundaries
