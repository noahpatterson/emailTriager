# Human review produces ground truth and never touches Gmail

Reviewing a verdict records an **Owner Label** and scores the judge. It does not re-file the message. The owner already has a perfectly good tool for moving one email by hand, and the remediation channel for a systematic error is improving category intent and term lists — not hand-holding individual messages.

Review is stratified: every disagreement is queued, because they are rare, high-impact, and each has already mutated the mailbox; plus a configurable share of agreements, around ten percent, because that is the only thing capable of surfacing what the judge waves through incorrectly. Reviewing disagreements alone would measure false positives precisely and stay permanently blind to false negatives.

## Consequences

A closed loop where the owner's verdict re-files the message would need a sticky per-message verdict to stop the next audit run overriding the human again. Durable per-message state is already shaped to hold that, so the loop stays available later — but it is deliberately not built now.

Review reads the stored snapshot, not live Gmail, because by review time the message may have been hand-moved, relabeled, or trashed. This also means the review queue works with no network at all.
