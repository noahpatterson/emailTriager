# The demo corpus is adversarial by design

The hundred fixture messages are not a neutral sample of marketing mail. Roughly a quarter are deliberately constructed so the configured term lists misfile them, because a corpus the deterministic rules handle cleanly makes every AI feature render as a no-op: the judge agrees with everything, the review queue is empty, and the matching eval reports nothing to improve. A visitor would watch a spinner and see nothing happen.

The cases target known seams in the matching logic. Whole-token matching means a term of `winner` does not match `winners`. Marketing mail routinely borrows priority vocabulary for junk, so a subject like `URGENT: 50% off ends tonight` misfiles upward. First-match-wins across priority, review, and new means a message matching two categories always takes the earlier one regardless of intent. Some messages carry their only discriminating signal late in the body. And most valuable of all: mail matching no term at all, which falls through to archive while intent says priority — the silent, expensive error the judge exists to catch.

Fixtures are drafted with a model for speed, but every ground-truth label is hand-audited. The corpus is simultaneously the demo's mailbox, the golden set with its recorded exemplar and holdout split, and a test fixture set, so a wrong answer key would silently corrupt every metric computed from it, permanently and undetectably.

## Consequences

Because the messages are generated to fit categories, they are an easier test than real mail. The demo proves the machinery works, not that the classifier is good, and the write-up should say so rather than imply a benchmark result.
