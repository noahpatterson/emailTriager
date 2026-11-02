# Personal Vercel deployment with two login gates

The personal app runs on a dedicated Vercel Hobby project and an isolated personal Neon project. Every production domain and deployment URL requires Vercel Authentication. The application then requires the configured Neon Auth owner identity. The public demo infrastructure and CI database remain separate.

## Decision

`services/personal` is an independent Terraform root. It creates an unlinked Vercel project, disables previews, enables Git fork protection, and requires authentication for all deployments. Provider 5.1.2 names that setting `vercel_authentication.deployment_type = "all_deployments"`. Vercel's API represents the same protection as `ssoProtection.deploymentType = "all"`.

The root stores only project settings and nonsecret production variables in HCP Terraform. Its CLI-driven workspace uses local execution and encrypted remote state from the outset, as ADR-0011 requires. Runtime credentials enter Vercel production through a separate operator step after protection is confirmed. No Git integration can deploy source during project setup.

The operator selects the existing isolated personal Neon project during credential setup and verifies its identity and migration suitability. Terraform does not copy or branch the demo database. Ordinary application migrations run through an explicit personal owner connection. Vercel receives a pooled connection for `emailtriager_personal_app`, which cannot administer roles, own application tables, or access private schemas. The reviewed grants cover application tables and their sequences. Future table additions require grant review.

`APP_PROFILE=personal` enables fail-closed deployment rules. Gmail writes and external AI default to disabled. Hosted preview and development environments cannot access live Gmail or external models. Local operational scripts parse only the explicitly selected environment file and print boolean results or fixed diagnostic fields without secret-bearing errors. The remote readiness step checks Vercel metadata and effective database role privileges without decrypting secrets. It reads only the profile and capability settings individually because the provider stores those nonsecret values as encrypted variables.

## Consequences

The runtime defaults to readonly Gmail with external AI disabled. The user explicitly selected Gmail writes and AI for the first deployment, represented by Terraform capability inputs and matching production settings. Enabling write access requires a capability change and fresh Google consent. External AI remains optional and can incur provider charges. Hobby's function duration limit requires bounded requests rather than a long synchronous mailbox scan.

Environment and metadata checks cannot prove that Google or Neon console settings are correct. The operator must verify the production origin and callback, then test both login gates in a browser. The deployment is prepared locally before credentials are requested. Secret values stay out of chat.

Refresh tokens and parsed snapshots are encrypted, but several metadata fields and golden set text remain plaintext. Snapshot retention requires a manual run. This decision adds no automatic deletion schedule or background worker.

## Alternatives

Reusing the demo database would mix personal mailbox data with public infrastructure and CI credentials. A branch also inherits project data and permissions. A dedicated personal project provides the intended separation.

A bespoke provisioning state machine would add maintenance beyond this single personal deployment. Terraform declares project settings, and a documented sequence handles credentials and verification. Platform authentication provides the requested outer login gate without another proxy service.

See the [deployment procedure](../operations/personal-vercel.md), [Vercel provider schema](https://registry.terraform.io/providers/vercel/vercel/5.1.2/docs/resources/project), [free production protection announcement](https://vercel.com/changelog/protect-production-deployments-for-free-on-every-plan), and [HCP state security model](https://developer.hashicorp.com/terraform/cloud-docs/architectural-details/security-model).
