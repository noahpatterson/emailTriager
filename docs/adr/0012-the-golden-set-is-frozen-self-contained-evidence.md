# The golden set is frozen, self-contained evidence

When a message is given an owner label, its text is **copied into the golden-set row** rather than referenced from the message snapshot. The golden set therefore owns its own evidence and outlives the retention window that governs snapshots.

Without this, retention silently destroys the answer key. Snapshots expire after `RETENTION_DAYS`, which defaults to thirty. Thirty days after a message is carefully hand-labelled, the text it refers to is deleted and that row drops out of the matching eval. The failure is gradual rather than loud: the numbers keep computing while the corpus shrinks underneath them, so the metric appears healthy while measuring less and less.

Copying also makes the evidence immutable, which is what reproducible evaluation actually requires. An operational table subject to retention, re-sync, and recovery is not frozen, and a candidate term list scored against evidence that can change is not being compared to anything stable.

## Considered Options

**Exempt referenced snapshots from retention.** Avoids duplicated text, but makes a curated long-lived artifact depend on an operational table it does not control, and quietly turns retention into a conditional rule with a join in it.

**Accept a rolling window.** The golden set would only ever cover the last thirty days, which defeats the purpose of accumulating owner labels over time.

## Consequences

Message text exists in two places with deliberately different lifecycles: snapshots are operational and expire, golden-set rows are curated and do not. The golden set needs its own explicit deletion path, since retention will never reclaim it.

Messages classified `protected` are not snapshotted at all. The judge may never touch them and they are already excluded from scoring, so storing their text buys nothing — and starred mail is the most sensitive content in the mailbox, since starring is how the owner marks what matters.
