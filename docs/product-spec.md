# Email Triage MVP Product Specification

**Status:** Approved implementation baseline  
**Scope:** MVP only  
**Last updated:** 2026-07-18

## 1. Purpose

Build a single-owner web application that classifies Gmail messages into deterministic triage destinations without deleting mail, marking it read, or relying on Gmail search. The implementation stack is Next.js with TypeScript, Neon Auth, and Neon Postgres.

This document is the stable product and verification contract. Behavior not stated here is out of scope unless this document is amended.

## 2. Product boundaries

### 2.1 Included

- One configured owner account authenticated through Neon Auth.
- One Gmail account connected by the owner through Google OAuth.
- Bounded, paginated synchronization from one configured Gmail source label.
- Local MIME parsing, normalization, matching, classification, and precedence resolution.
- Outcomes: **priority**, **review**, **new contest**, **blocked** (sender blocklist), **unmatched**, and **protected**.
- Configurable terms, sender whitelist, sender blocklist, source label, destination labels (including contest-archive), and sync bounds.
- Owner-only, double-confirmed move of contest-archive messages to Gmail Trash (recoverable; not permanent delete).
- Resumable, idempotent sync runs with visible run status and failure summaries.
- Minimal operational metadata required for configuration, OAuth, sync recovery, and auditability.

### 2.2 Excluded

- Multiple application owners, shared inboxes, delegated Gmail access, or multiple Gmail accounts.
- Gmail search queries or server-side content classification.
- Automatic trash, delete, archive, spam, read/unread, send, reply, or forward actions during sync or classification.
- Permanent delete, batch-delete, spam, or trash of labels other than the configured contest-archive via the owner trash-all control.
- Machine-learning classification.
- Full message-body storage, attachment storage, or a general-purpose email client.
- Background monitoring beyond explicitly scheduled or owner-triggered bounded sync runs.

## 3. Architecture and ownership

- **Web/runtime:** Next.js and strict TypeScript. Server-only code performs Gmail, database, cryptographic, and classification work.
- **Identity:** Neon Auth establishes the application session. Every protected page and route verifies the server-side Neon Auth identity.
- **Database:** Neon Postgres stores the singleton owner binding, encrypted OAuth credentials, configuration, sync checkpoints, message processing metadata, and sanitized error/audit metadata.
- **Owner binding:** On first controlled setup, one Neon Auth user ID becomes the immutable application owner. All other authenticated or unauthenticated identities are denied access to configuration, sync data, OAuth actions, and Gmail operations. Reassignment requires an explicit administrative reset outside normal MVP UI.
- **Gmail binding:** The OAuth callback verifies state and binds exactly one Google subject/account to the owner. A callback or refresh result for another subject must not silently replace it.

## 4. Gmail OAuth and security

1. Use authorization-code OAuth with an exact allowlisted redirect URI, cryptographically random single-use `state`, and PKCE where supported by the Google integration.
2. Request only the least Gmail scopes needed to list/read messages and modify labels. Do not request send, delete, or unrelated Google scopes.
3. OAuth initiation and callback require the owner’s valid Neon Auth session. State is short-lived, owner-bound, consumed once, and rejected on missing, expired, mismatched, or replayed values.
4. Access and refresh tokens are server-only. Refresh tokens are encrypted at rest with a versioned application key; tokens never enter client props, HTML, browser storage, URLs, analytics, or logs.
5. Disconnect revokes the Google grant on a best-effort basis, then removes local token material and connection state even if remote revocation fails. It preserves non-secret configuration and sanitized run history.
6. Reconnect repeats full authorization, verifies the Google subject, and resumes from durable processing state. If a different Gmail subject is presented, require explicit reset rather than merging histories.
7. State-changing routes require same-origin/CSRF protection, validated typed inputs, and owner authorization. Secrets and raw provider responses are excluded from errors returned to the browser.

## 5. Sync input and bounds

Each run snapshots its configuration and applies immutable positive limits, including:

- maximum pages per run;
- maximum messages per page (capped at Gmail’s supported maximum);
- maximum total messages per run;
- maximum decoded bytes per message and per MIME part;
- finite API timeout and retry limits.

List messages using Gmail pagination and the configured source label only. **Do not send a Gmail `q` search parameter or any Gmail search expression.** Follow `nextPageToken` until it is absent or a configured bound is reached. Persist the next token/checkpoint needed to resume a bounded or interrupted run. A run that stops at a bound is successful-but-incomplete and exposes that status; it must not pretend the mailbox was exhausted.

A pagination cycle, repeated page token, malformed response, or exceeded content bound is a safe per-run/per-message failure, never an unbounded loop.

## 6. MIME parsing and local match corpus

For each listed message, fetch the message needed for classification and parse Gmail’s recursive MIME payload locally:

- decode base64url safely, including missing padding;
- traverse nested multipart structures with depth/part/byte bounds;
- prefer decoded `text/plain`; if absent, convert `text/html` to visible text with scripts, styles, markup, and unsafe entities removed;
- include selected decoded headers needed for classification (at minimum From, Subject, and Reply-To) plus the selected visible body;
- never classify on attachment bytes, filenames alone, hidden HTML, or remote content;
- handle encoded/folded headers, declared charsets, malformed parts, absent bodies, and invalid encodings conservatively.

If a message cannot be parsed sufficiently for a successful classification, record a sanitized per-message failure and make **no label mutation**. Raw MIME, full body text, and attachment content are transient in memory and are not persisted or logged.

## 7. Normalization and matching

Configuration provides independent term sets for priority, review, and new-contest classification. On save and use:

- Unicode-normalize (NFKC), case-fold, trim, and collapse internal Unicode whitespace;
- reject empty normalized terms, deduplicate normalized equivalents, and enforce term/count/length bounds;
- apply the same normalization to the local match corpus;
- match terms with Unicode-aware boundaries: a term must not be embedded inside a larger letter/number/mark/underscore token. Multi-word terms tolerate normalized whitespace but otherwise match literally;
- escape configuration as data; terms are never executable regular expressions;
- punctuation-delimited occurrences match, while substrings such as `win` in `winner` do not.

All matching occurs in application code after listing/fetching. Configuration terms must never be translated into Gmail search.

## 8. Sender whitelist and blocklist

The configurable whitelist and blocklist contain normalized exact mailbox addresses (case-folded domain and consistently normalized address representation). Parse sender headers robustly; display-name text alone cannot establish a whitelist or blocklist match.

A whitelisted sender is protected from automated movement. Classification may be computed for diagnostic counters, but the final action is `protected`, no destination label is added, and the source label is not removed. An unparseable/ambiguous sender fails conservatively with no movement rather than bypassing protection.

A blocklisted sender (not also whitelisted) yields outcome `blocked` without term matching and is moved to the contest-archive destination. **Whitelist wins over blocklist** when the same address appears in both.

## 9. Deterministic classification

For each parseable message, choose exactly one result using this precedence:

1. **protected** — unparseable/ambiguous From, or exact whitelist match;
2. **blocked** — otherwise, exact blocklist match (skip term matching);
3. **priority** — otherwise, one or more priority terms match;
4. **review** — otherwise, one or more review terms match;
5. **new contest** — otherwise, one or more new-contest terms match;
6. **unmatched** — no configured category matches.

The result depends only on the versioned configuration snapshot and parsed message input. Store the chosen category, configuration version, Gmail message ID, and processing status. Do not store matched body excerpts. Unmatched and blocked messages are moved to the configured contest-archive label.

## 10. Conservative label movement

Movement is permitted only after parsing and classification complete successfully, the sender is not protected, and a destination is selected.

Destination mapping:

- **priority** / **review** / **new contest** → the corresponding configured destination label;
- **blocked** / **unmatched** → the configured contest-archive label;
- **protected** / **failed** → no label mutation.

Use one Gmail message label modification that adds the configured destination label ID and removes the configured source label ID. Validate at configuration/sync start that source and all four destinations exist, are distinct, and are not forbidden system-action substitutes. Sync and classification must never call trash, delete, batch-delete, spam, archive, or read/unread operations; never add/remove `TRASH`, `SPAM`, or `UNREAD` as a side effect of sync.

Do not remove the source label before or separately from adding the destination label. Treat the mutation as successful only after Gmail confirms success. On an ambiguous transport result, reconcile by fetching current label IDs before retrying. Retry only the same desired final label state. If the destination is already present and source absent, record success; if destination is present and source remains, safely retry removal through the same desired-state modification. Never compensate by removing a destination label that may predate this app.

### 10.1 Owner contest-archive trash-all

An explicit owner-only control may move messages that currently carry the configured contest-archive label into Gmail Trash via `users.messages.trash` (recoverable Trash, not permanent delete). Requirements:

- Owner session and same-origin/CSRF protection;
- Double client confirmation plus a server `confirm` token (`DELETE_CONTEST_ARCHIVE`);
- List only by the contest-archive label ID (no Gmail `q`);
- Bounded batches with a resume token when incomplete;
- Refuse while a sync lease is held;
- Never permanently delete, never trash other labels, never mark read/unread.

## 11. Resumability, idempotency, and concurrency

- A durable run has an ID, configuration version, status, cursor/page token, counters, lease metadata, timestamps, and sanitized failure summary.
- A durable per-message record is uniquely keyed by Gmail account subject and Gmail message ID, with desired outcome and processing state. Database uniqueness plus transactional state transitions prevents duplicate logical work.
- Replaying a page, message, route request, timeout, or process restart converges on the same label state and does not create duplicate records or alternate outcomes.
- Acquire a database-backed single-account sync lease before Gmail work. Concurrent start requests return the active run (or a conflict) and do not launch another worker. Leases expire and are recoverable; ownership uses compare-and-set/transactional checks so a stale worker cannot continue mutating after losing its lease.
- Persist progress only at safe boundaries. Resume from the last durable cursor and reprocess uncertain messages idempotently. Never advance past an unresolved message without recording its independent state.
- Configuration changes create a new version and affect only new runs; an active run retains its snapshot.

## 12. Failures, recovery, disconnect, and rollback

- Retry transient Gmail/Neon errors with bounded exponential backoff and jitter, respecting provider retry guidance. Do not retry permanent auth, validation, or malformed-message errors indefinitely.
- One message failure does not undo successful unrelated messages and does not stop later messages unless authentication, lease loss, configuration invalidity, or a systemic limit makes continuation unsafe.
- A refresh-token/auth failure pauses/fails the run as reconnect-required without moving unclassified messages. UI shows a safe actionable state.
- Rate limits or exhaustion of retry budget persist the cursor and a resumable partial status.
- Database failure before Gmail mutation causes no mutation. If Gmail succeeds but recording success fails, recovery reconciles Gmail labels and records the converged result.
- Disconnect prevents new sync/mutations immediately and invalidates active lease ownership. An in-flight worker rechecks connection and lease immediately before each mutation.
- **Rollback:** disabling the feature or disconnecting stops future actions; deployment rollback must retain compatible schema/checkpoints. The MVP does not automatically reverse prior label moves because it cannot prove a destination label was app-created. Any later reversal of destination labels must be explicit, owner-confirmed, and audit-recorded, and must never permanently delete or mark read. The contest-archive trash-all control (§10.1) is the only permitted trash path.

## 13. Data retention and disclosure

Persist only:

- owner and Gmail subject identifiers;
- encrypted refresh/access material and minimal expiry/scope metadata;
- normalized configuration and label IDs;
- Gmail message IDs, category/status, configuration version, retry/cursor metadata, timestamps, and sanitized error codes;
- aggregate run counters.

Do not persist raw/full message bodies, MIME payloads, attachment content, matched excerpts, OAuth authorization codes, PKCE verifier after callback completion, or unredacted provider responses. Avoid storing headers; if a minimal normalized sender address is operationally required, document and bound its retention.

Define and enforce retention jobs: transient OAuth state expires within 10 minutes; access tokens are replaced/removed when obsolete; sanitized per-message/run records have a configurable finite retention period (default 30 days) and are deleted afterward, except the smallest cursor/idempotency keys required to prevent replay, which must also have a documented bounded lifecycle. Logs and telemetry use IDs/counters and error codes only. UI/API responses never disclose tokens, raw bodies, MIME, or body excerpts.

## 14. Minimal UI and routes

Owner-only UI provides connection state, configuration editing, a sync trigger, current/recent run status, counts by outcome, sanitized failures, disconnect, and reconnect. It must clearly state that bounded runs may be incomplete. Non-owner and signed-out users see no owner, Gmail, configuration, or run data.

Routes use explicit schemas and appropriate status codes. Sync trigger is idempotent against retries. OAuth callback redirects without secrets. UI renders no email body content for this MVP.

## 15. Live-test isolation

All automated and default development tests use a fake Gmail adapter and a deterministic fake inbox. Fixtures cover pagination, nested MIME, HTML fallback, encodings, malformed content, term boundaries, whitelist parsing, precedence, retries, ambiguous mutations, and label reconciliation.

Live Gmail tests are opt-in only, gated by an explicit environment flag and dedicated test Gmail account/labels. They must create/use messages carrying a unique run marker and operate only inside a uniquely named fake-inbox source label. Before every mutation, assert both the dedicated account subject and expected test source label. Cleanup removes only test-created labels/messages when safe; it never touches unrelated mail. Tests fail closed if isolation cannot be proven.

## 16. Acceptance criteria

The MVP is accepted only when all mandatory criteria pass. Credential-dependent criteria are optional/skipped with an explicit reason when credentials are unavailable; they become mandatory in a credentialed release-validation environment.

### AC-1: Stack, authentication, and isolation

- [ ] A production build identifies Next.js/TypeScript, Neon Auth and Neon Postgres as the implemented stack; strict type checking succeeds.
- [ ] Route/service tests prove signed-out requests are rejected and a non-owner Neon Auth user cannot read or mutate any owner resource.
- [ ] Tests prove only the bound Gmail subject is accepted and account replacement requires explicit reset.
- [ ] Database queries and uniqueness constraints are owner/account scoped; cross-owner fixture attempts return no data and cause no Gmail calls.

### AC-2: OAuth and secret safety

- [ ] Unit/route tests cover valid OAuth, missing/mismatched/expired/replayed state, callback without owner session, refresh failure, disconnect, reconnect, and different-subject reconnect.
- [ ] Scope and redirect URI assertions prove least privilege and exact callback handling.
- [ ] Automated scans/assertions over rendered HTML, serialized client props, route JSON, logs, and captured telemetry find no authorization code, PKCE verifier, access/refresh token, encryption key, raw provider response, raw MIME, full body, or excerpt fixture sentinel.
- [ ] Database fixture inspection proves token ciphertext is not plaintext and prohibited body/header fields are absent.

### AC-3: Bounded listing and local-only matching

- [ ] Gmail mock contract tests assert every list call contains the configured source label and bounds but contains neither `q` nor a search expression.
- [ ] Fixtures prove 0, 1, and multiple pages; missing, repeated, and cyclic page tokens; maximum page/message/total bounds; and resume after each boundary.
- [ ] A spy proves the Gmail adapter receives no configured classification term in listing parameters, while local classifier tests find those terms in fetched MIME content.
- [ ] UI/service status distinguishes exhausted runs from successful-but-incomplete bounded runs.

### AC-4: MIME and normalization

- [ ] Unit fixtures cover base64url padding, nested multipart/alternative and multipart/mixed, encoded/folded headers, UTF-8 and another declared charset, plain-text preference, HTML-only visible-text conversion, missing body, attachment exclusion, malformed encoding, and depth/part/byte limits.
- [ ] Unit tests cover NFKC/case/whitespace normalization, empty/duplicate rejection, regex metacharacters as literals, punctuation boundaries, Unicode letters/numbers/marks, underscore boundaries, multi-word whitespace, and false positives such as `win` within `winner`.
- [ ] A malformed or over-limit message produces a sanitized failure and zero label modifications.

### AC-5: Precedence, whitelist, and blocklist

- [ ] Table-driven tests exercise every combination of priority/review/new-contest matches and prove `priority > review > new contest > unmatched` with exactly one result among term outcomes.
- [ ] Precedence tests prove invalid From / whitelist → `protected`; blocklist (after whitelist) → `blocked` skipping terms; whitelist wins when both lists contain the address.
- [ ] Sender fixtures cover display names, mixed casing, multiple/ambiguous addresses, malformed headers, and spoof-like display-name text.
- [ ] Exact whitelisted mailbox matches always yield protected/no movement even when every category matches; ambiguous/unparseable sender yields no movement.

### AC-6: Conservative Gmail mutation

- [ ] Service contract tests prove modification occurs only after successful parsing/classification and consists of destination-label add plus configured source-label removal in the same modify request.
- [ ] Tests prove `blocked` and `unmatched` mutate to contest-archive; `protected` and `failed` issue zero mutations; stale-lease, disconnected, and invalid-label cases issue zero mutations.
- [ ] Sync-path adapter tests fail if production sync code invokes permanent delete, batch-delete, spam, archive, or read/unread mutation; fixtures assert sync never changes `TRASH`, `SPAM`, or `UNREAD`.
- [ ] Owner trash-all tests prove only `users.messages.trash` against contest-archive-listed messages, require confirm token and lease absence, and never permanent-delete.
- [ ] Reconciliation tests cover timeout-before-result, already-converged labels, destination-present/source-present, and retry exhaustion without removing a pre-existing destination.

### AC-7: Idempotency, concurrency, partial failure, and recovery

- [ ] Replaying the same page/message/start request 2+ times produces one logical processing record, one deterministic outcome, and a converged label state.
- [ ] Concurrent-start tests with at least two workers prove only one lease holder can mutate. Lease expiry/takeover tests prove the stale worker is fenced before mutation.
- [ ] Fault-injection tests cover failure before mutation, Gmail-success/database-failure, database-success/Gmail-failure, rate limit, token expiry, process interruption at each durable boundary, and one malformed message among valid messages.
- [ ] Restart/resume tests prove no cursor loss, no skipped unrecorded message, bounded retry, and continuation of independent messages after a per-message failure.
- [ ] Configuration-change tests prove active-run snapshot stability and new-run version adoption.

### AC-8: Disconnect, reconnect, and rollback

- [ ] Route/service tests prove disconnect immediately blocks new runs, fences an active run before its next mutation, clears local secrets even when revocation fails, and returns only sanitized status.
- [ ] Reconnect tests prove same-subject processing resumes idempotently; different-subject connection is rejected pending reset.
- [ ] A documented rollback drill proves an older compatible deployment can start without destructive migration, existing checkpoints remain readable, and disabling/disconnecting stops movement.
- [ ] Tests prove rollback never automatically removes destination labels and never permanently deletes or marks messages read; trash remains limited to the explicit owner contest-archive control.

### AC-9: Route and UI behavior

- [ ] Route tests cover schema rejection, authorization, CSRF/same-origin rejection, status codes, idempotent sync start, sanitized errors, and absence of secret/body fields.
- [ ] UI tests cover disconnected, connected, syncing, bounded-incomplete, partial-failure, reconnect-required, and completed states; owner can edit validated configuration and trigger one run.
- [ ] UI tests prove no message body/excerpt is rendered and non-owner fixtures reveal no metadata.

### AC-10: Fake inbox, database, and live validation

- [ ] Mandatory mock/fixture suite runs without network access and verifies all behaviors above against a deterministic fake inbox.
- [ ] Fake-inbox integration test processes at least one message per outcome plus protected, blocked, unmatched (archive), malformed, and retry cases, asserting exact final labels and unchanged read state outside the owner trash-all path.
- [ ] Optional test-Neon integration (when `TEST_DATABASE_URL` is available) applies migrations to an isolated database/branch and verifies constraints, transactions, lease contention, retention, and recovery; otherwise it reports a named skip, not a pass.
- [ ] Optional live-Gmail test (when explicit opt-in and dedicated credentials are available) proves pagination, modify semantics, reconnect, and isolation inside the unique test label; otherwise it reports a named skip. It must abort before mutation if account/label/run-marker checks fail.

### AC-11: Quality gates

- [ ] `typecheck`, `lint`, production `build`, unit tests, service tests, route tests, UI tests, and fake-inbox integration tests all exit successfully in CI.
- [ ] Tests have no order dependency and mandatory suites require no live credentials or network.
- [ ] Coverage includes happy paths and error/edge paths for classifier, MIME parser, sync state transitions, OAuth routes, owner guards, and Gmail mutation adapter, meeting the repository threshold.
- [ ] A migration/rollback check and a retention-job test run in CI against the appropriate local/fake database boundary.
- [ ] Security assertions fail the build on token/body sentinel disclosure.

## 17. Definition of done

Implementation is complete only when the mandatory acceptance criteria are automated, passing, and linked from the repository’s test commands; migrations and deployment configuration are documented; optional credentialed checks either pass in the intended environment or are explicitly reported as unavailable. No implementation shortcut may weaken owner isolation, local-only matching, conservative mutation, or non-disclosure requirements.
