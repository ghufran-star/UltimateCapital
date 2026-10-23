# UltimateCapital

The operating system for an AI-operated real estate wholesaling business: buyer and seller acquisition, underwriting, negotiation, matching, contracts, title and closing, in one app with shared memory and owner-controlled rules.

**Status:** specification. Build has not started.

## Specification
1. [Master Blueprint v1.0](docs/01-master-blueprint.md): the business and product definition.
2. [Addendum A](docs/02-blueprint-addendum.md): requirements agreed since v1.0 (multi-state, Deal Rules engine, pre-contract demand, e-signature, DNC automation, title and closing, accounts, calling, agent prompting). Where they differ, the addendum wins.
3. [Build phases](docs/03-build-phases.md): the nine-phase plan.

## Planned stack
Next.js and TypeScript, Postgres, deployed on Railway from this repo. Calling via Retell and Twilio; Claude for AI analysis and agents.
