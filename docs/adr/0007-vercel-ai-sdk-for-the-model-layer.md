# The Vercel AI SDK is the model layer

Models reach the app through the Vercel AI SDK, using `@ai-sdk/openai-compatible` for the internal local LLM and a hosted provider for development. Structured verdicts come from schema-constrained generation with automatic repair, and the SDK's mock language model is what the demo runs against.

This is a deliberate deviation from the house style, which is otherwise aggressively minimal — nine runtime dependencies, hand-rolled HTTP retry, hand-rolled AES with versioned keys, and interface-plus-adapter seams with deterministic fakes beside them. A thin `ModelProvider` interface mirroring `GmailProvider` would have matched that style in about a hundred lines, since every local runtime worth using already speaks OpenAI-compatible HTTP, so provider swapping is a base URL and a model name.

The SDK wins on the part that actually breaks when you swap models: structured output. Strict JSON-schema and tool-calling support varies enormously between a hosted frontier-mini model and a local one, and schema enforcement with validate-and-repair is the fiddly, easy-to-get-subtly-wrong code we would otherwise own. It also emits OpenTelemetry spans natively and ships a mock provider, which covers the demo requirement on a supported path rather than a bespoke one.

## Consequences

Zod arrives as a dependency, so the codebase now has two validation idioms alongside the hand-rolled `triage-validate.ts` and `owner-preferences-validate.ts`. Zod is confined strictly to the model boundary; the existing validators are deliberately left alone rather than half-migrated.

Versions are pinned exactly, as the rest of `package.json` does. This SDK has broken across major versions more than once.

Malformed-output rate per model is tracked as a first-class metric per eval run, because it is the thing that regresses when the model changes and it is invisible unless measured.
