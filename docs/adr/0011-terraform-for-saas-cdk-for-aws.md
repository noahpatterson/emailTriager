# Terraform for the SaaS layer, CDK for AWS

Infrastructure is declared as code from the start, not configured through dashboards. Terraform manages the multi-vendor SaaS layer — Vercel, Render, and Neon — because a single declarative graph across unrelated providers is precisely what its provider ecosystem is for. The later AWS variant uses CDK instead, in TypeScript alongside the application, because AWS-native depth and typed constructs are the point there.

Splitting the tools is deliberate rather than incidental: each is applied where it is idiomatic, which demonstrates judgement about when to reach for which, rather than familiarity with one.

## Considered Options

**Terraform for everything, AWS included.** One tool learned more deeply and one state model to reason about, but CDK never appears.

**CDK for AWS only, leaving the real deployment configured by hand.** Rejected: the environment that actually matters would be the one that is not reproducible.

**Terraform plus a parallel CDK implementation of the same AWS stack.** An interesting side-by-side, but two definitions of one environment is a maintenance trap and they drift.

## Consequences

Terraform state will hold sensitive values, so it needs a remote encrypted backend from the outset. A local `terraform.tfstate` is a secret-leak waiting to be committed.

The public environments live in a Neon project of their own, declared in Terraform, separate from the personal project. Branching the personal project would inherit its data, which since ADR-0002 includes real message bodies. Demo and staging may be branches of that public project, since it contains only fixtures.
