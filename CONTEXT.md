# Email Triage

A single-owner Gmail triage workspace. Deterministic keyword rules file incoming mail into categories, and an AI adjudication pass checks that filing against the owner's stated intent.

## Language

### Ownership and connection

**Owner**:
The single identity permitted to use the workspace. Every other authenticated identity is rejected.
_Avoid_: user, account, admin

**Source Label**:
The Gmail label that marks mail as awaiting triage. Nothing outside it is ever examined.
_Avoid_: inbox, queue, folder

### Deterministic triage

**Category**:
One of the destinations a message can be filed into: priority, review, new, or archive.
_Avoid_: folder, bucket, class, label (a Gmail label is the mechanism, not the concept)

**Term**:
A literal word or phrase the owner configures to indicate a category. Matched whole-token, never as a partial word.
_Avoid_: keyword, pattern, rule, query

**Match Corpus**:
The normalized text a message is reduced to for term matching. Specific to the current matching algorithm and never stored, so that a future algorithm is never evaluated against evidence its predecessor pre-chewed.
_Avoid_: corpus, normalized body, search text

**Classification Outcome**:
The result the deterministic pass assigns a message: a category, or `protected`, `blocked`, or `unmatched`.
_Avoid_: verdict (reserved for the judge), result, decision

**Protected**:
A message the deterministic pass refuses to touch, because the owner starred it, whitelisted the sender, or the sender could not be parsed.
_Avoid_: skipped, ignored, excluded

**Blocked**:
A message whose sender the owner has listed as never worth triaging. Distinct from `protected`: blocked mail is filed to archive, protected mail is left alone.
_Avoid_: banned, filtered, spam

**Trial Mode**:
A sync that classifies a small bounded sample and reports what it would do, without changing anything in Gmail.
_Avoid_: dry run, preview, test mode

**Sync Run**:
One bounded execution that pulls mail from the source label, classifies it, and applies Gmail labels. Deterministic; contains no model call.
_Avoid_: job, batch, scan

### Intent and adjudication

**Category Intent**:
The owner's prose definition of what a category means. The standard of correctness against which any filing is judged.
_Avoid_: description, prompt, instructions, criteria

**Audit Run**:
One execution of the AI pass over a completed sync run. Reads stored snapshots, issues a verdict per message, and may re-file messages it finds misplaced.
_Avoid_: agent sync, review run, judge run

**Verdict**:
The judge's decision on a single already-filed message: whether the filing matches category intent, which category it belongs in, and why.
_Avoid_: judgment, score, classification, outcome

**Disagreement**:
A verdict that contradicts the deterministic classification outcome for the same message.
_Avoid_: conflict, mismatch, error, override

**Promotion**:
Re-filing a message out of archive or unmatched, or upward among new, review, and priority. The judge may do this unaided.
_Avoid_: upgrade, escalation

**Demotion**:
Re-filing a message into archive. Requires human confirmation, because archive is the only category wired to a destructive action.
_Avoid_: downgrade, dismissal

**Message Snapshot**:
The stored parsed text of a message. Neutral with respect to any matching or judging algorithm, so it can serve as evidence for all of them. Operational and expiring; not captured for protected mail.
_Avoid_: body, cached message, copy

### Evaluation

**Owner Label**:
The category the owner states a message truly belongs in. The only authoritative answer in the system.
_Avoid_: ground truth, correction, human label, annotation

**Golden Set**:
The accumulated collection of messages carrying owner labels, each holding its own frozen copy of the message text so that it outlives the retention window and cannot change.
_Avoid_: dataset, training set, test set, fixtures

**Exemplar Pool**:
The partition of the golden set that may be shown to a judge as examples.
_Avoid_: few-shot set, training split

**Holdout**:
The partition of the golden set reserved for scoring, never shown to a judge. Disjoint from the exemplar pool by construction.
_Avoid_: test set, validation set, eval set

**Candidate**:
A proposed replacement for something currently in use — a term list, a prompt, or a model — being scored against what it would replace.
_Avoid_: variant, version, experiment

**Eval Run**:
One scoring pass over the holdout, producing a confusion matrix and a single cost-weighted score for the candidate under test. Distinguish the two kinds by what is under test: the judge, or the deterministic matching.
_Avoid_: experiment, benchmark, test run
