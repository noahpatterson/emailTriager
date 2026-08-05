# AI adjudication is a separate Audit Run, not part of the sync path

The product was deliberately built with no model call in the sync path, which is what makes a sync run bounded, fast, and unable to fail on a model timeout. Rather than give that up, AI adjudication is a distinct **Audit Run** that operates on an already-completed sync run: it reads stored snapshots, issues a verdict per message, and re-files the ones it finds misplaced. The sync path stays deterministic.

## Considered Options

**Inline per message** — consult the judge inside the sync loop so a wrong label never reaches Gmail. Rejected: it puts a network call to a model inside the Gmail mutation loop, forfeits the bounded-and-fast property, and nests every trace inside a sync run.

**Post-hoc audit run** — chosen.

**Shadow only** — never mutate, queue every correction for a human. Rejected as the end state; it is the behaviour you get anyway by leaving auto-apply off.

## Consequences

An incorrect label genuinely lands in Gmail and is then corrected, costing two mutations on every corrected message and producing visible label churn in the mailbox. In a demo this is an asset, because the correction is observable.

Because the audit run reads stored snapshots rather than Gmail, it needs no Gmail connection and no network, which is what makes it testable and demonstrable offline.

Whether an audit run is triggered by hand or automatically once a sync run completes is a setting, not an architectural property. Manual first; automatic is the intended end state so that no one has to remember.

An audit run is bounded and resumable, reusing the lease, fence token, and recorded-progress machinery that sync already has. At a hundred messages per run and a second or two per verdict on a local model, an unbounded run would exceed a serverless function ceiling; reusing the existing pattern makes timeouts, slow models, and partial failure the same already-solved problem.

Each message gets its own model call rather than sharing a batched one. Batching would cut wall-clock time and call volume, but one malformed response would poison a whole batch, per-verdict trace attribution would blur exactly where it is most useful, and messages judged together contaminate each other — a batch of obvious junk biases the model against the one legitimate message in it. Concurrency is bounded and configurable instead, since the right degree depends entirely on whether the serving stack batches internally.
