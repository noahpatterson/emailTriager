# Observability is exported, never depended on

Instrumentation is OpenTelemetry, with spans written manually around our own operations and the exporter chosen by configuration. Crucially, **Postgres is the system of record** for snapshots, verdicts, owner labels, and eval scores. Observability vendors receive exports — traces over OTLP, scores over their score APIs — and are therefore interchangeable views rather than the store.

## Considered Options

**Adopt a vendor's dataset and annotation-queue APIs as the store.** Less code, and the vendor's UI comes free. Rejected: OTLP makes *tracing* portable, but datasets, annotation queues, and scores are vendor-specific with no interop, so building on them would lock in exactly the layer we most want to keep swappable — and would make the demo depend on a live external service.

**Self-host Langfuse.** Full feature parity under MIT, but it requires Postgres plus ClickHouse plus Redis plus S3-compatible storage. Not viable on a free tier and a real operations cost for a project this size.

Langfuse Cloud is the first exporter, chosen only because it is the least work: it accepts standard OTLP HTTP, so it needs an endpoint and an auth header and no vendor SDK. Phoenix and Braintrust are intended to follow as configuration changes.

## Consequences

The demo configures no exporter at all. Nothing to mock, nothing to leak, no spend — and the in-app views still work, because they read our own tables. A visitor sees genuinely real spans from real code paths, with only the model response faked.

Spans are written by hand rather than by auto-instrumentation. This is partly hygiene and partly that OTel auto-instrumentation under Bun has been unreliable.

Every eval score must be tagged with the model, provider, and prompt version that produced it, or scores are incomparable across time. Prompts are therefore versioned append-only, matching how triage configuration is already versioned.
