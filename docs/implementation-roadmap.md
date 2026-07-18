# Implementation roadmap

`docs/product-spec.md` is authoritative. This foundation deliberately implements no Gmail/OAuth/sync side effects.

| Acceptance criteria | Planned implementation and proof |
|---|---|
| AC-1 | Owner guard, same-origin policy, singleton binding; auth/route isolation tests. |
| AC-2 | OAuth service with hashed one-use state, PKCE, encrypted versioned tokens; replay and disclosure tests. |
| AC-3 | Bounded Gmail pagination without `q`; cycle, cursor, and limit tests. |
| AC-4 | Bounded recursive MIME parser and transient corpus; malformed/charset/HTML fixtures. |
| AC-5 | NFKC normalization, Unicode boundaries, whitelist/blocklist parsing, precedence including blocked; table-driven tests. |
| AC-6 | Provider-owned atomic label adapter; sync mutation allowlist; contest-archive destination; owner trash-all via `messages.trash` only. |
| AC-7 | Transactional leases, fencing, idempotent records, snapshots, fault injection and resume tests. |
| AC-8 | Fence-first disconnect, best-effort revoke, subject-safe reconnect, rollback drill. |
| AC-9 | Typed protected routes and minimal status UI; auth, CSRF, state and disclosure tests. |
| AC-10 | Deterministic fake suite mandatory; isolated Neon/live Gmail suites named-skip without opt-in. |
| AC-11 | CI install, typecheck, lint, test, build, migration and security sentinel gates. |
