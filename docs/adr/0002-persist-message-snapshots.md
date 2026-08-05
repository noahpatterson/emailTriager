# Message snapshots are persisted, reversing the transient-body rule

The original design kept raw MIME and body text strictly in memory, persisting only sender, subject, and outcome. Evaluating a change to the matching algorithm is impossible under that rule: judging whether a candidate term list beats the current one requires replaying both over the same messages, and re-fetching from Gmail is quota-bound and irreproducible, because the mailbox mutates underneath — not least because this app relabels it. So a sync run now persists a **Message Snapshot** of the parsed text, encrypted at rest under the existing versioned-key scheme and governed by the existing retention window.

## Considered Options

**Keep bodies transient; judge re-fetches from Gmail and evals maintain a separate curated corpus.** Rejected: two content paths, a live Gmail dependency inside the audit run, and the eval corpus ends up persisted anyway — so the rule is bent regardless, just less visibly.

**Persist only a derived representation** (the match corpus, or matched-term evidence, or a truncated prefix). Rejected because it bakes today's algorithm into the dataset. A corpus built from the normalized match corpus cannot evaluate a change to normalization; one built from matched-term evidence cannot surface a term not already being matched, which is the entire point. Truncation has the same failure mode, since marketing mail often carries its most discriminating signal late in the body.

## Consequences

Real message content, and therefore real PII, now sits at rest. Retention and encryption are load-bearing rather than incidental.

Snapshot width and judge prompt width are independent knobs. Store wide, prompt narrow: storage is a reversible decision, discarded evidence is not.
