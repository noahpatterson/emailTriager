# Human review records ground truth and re-files in Gmail

Reviewing a verdict records an **Owner Label** into the Golden Set (holdout) **and** applies that category’s Gmail label via the same re-file path used for promotions and confirmed demotions. The owner’s button press is the authoritative filing: measurement and mailbox stay aligned.

Review remains stratified: every disagreement is queued, because they are rare and high-impact; plus a configurable share of agreements, around ten percent, so false negatives are visible. The queue still **reads** the stored snapshot (not live Gmail) for evidence, so labeling works against what the judge saw even if the live message has moved.

Starred / protected messages keep the Golden Set write but skip Gmail mutation. Open pending demotions for the same message are cancelled once the owner labels in review.

## Consequences

Owner Labels both train eval and correct the mailbox immediately. A later audit may still disagree with the human label unless durable per-message stickiness is added; that remains available later via existing durable state, but is not required for this loop.
