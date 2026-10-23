# UltimateCapital

The operating system for an AI-operated real estate wholesaling business: buyer and seller acquisition, underwriting, negotiation, matching, contracts, title and closing, in one app with shared memory and owner-controlled rules.

## Specification
1. [Master Blueprint v1.0](docs/01-master-blueprint.md): the business and product definition.
2. [Addendum A](docs/02-blueprint-addendum.md): requirements agreed since v1.0. Where they differ, the addendum wins.
3. [Build phases](docs/03-build-phases.md): the nine-phase plan (all phases are built).

## What's in the app
- **Command Centre**: approvals waiting, hot deals, pipeline, deadlines, latest conversations.
- **Deals**: valuation (RentCast comps or verified ARV, repairs from seller answers + your playbook), seller offer ladder up to a locked max buy, near-agreement detection with an owner verification pack, buyer matching against buy boxes, the anonymous pre-contract demand check, the hot-deal score with an earnest-money recommendation, contracts and closing.
- **Deal Rules** (Settings → Deal rules): first/second offer, max buy, our fee, buyer rounds 1/2/3, floor price, investor net/gross margin, rentals, approvals, contact limits; variations by state, market, ZIP, property type, deal type, exit, condition, occupancy and ARV; repair playbook; live preview; hard locks; versioning with restore.
- **States**: one State Pack per state (wholesaling rules, disclosure, contract terms, calling/texting hours, consent). Outreach in a state is blocked until the owner activates its pack.
- **Contracts**: your attorney's templates with `{{fields}}` and `[[sign:role]]` markers, signing links sent by email and text, in-app signing (draw or type), company countersignature, signed PDF with a certificate of completion (IP, device, times, SHA-256).
- **Closing**: title package by email, a per-deal inbox read by AI (checklist, requests, settlement statements, wire-fraud warnings), checklist, earnest money and payments with owner approval and phone wire verification, bank CSV reconciliation.
- **Calling**: AI calls through Retell with 6-layer agent prompts and tools; your own calls through Twilio (we ring your phone, then connect the contact, recorded); inbound calls to the AI receptionist, a person or voicemail; texts with STOP handling.
- **Compliance**: every call/text checked at send time (pack active, hours, consent, DNC lists, opt-outs, caps); DNC import and automatic push updates; optional live scrub provider.
- **Accounts**: workspaces, roles (owner, admin, acquisitions, dispositions, transaction coordinator, caller, viewer), invites, a view-only demo workspace.

## Deploy on Railway
1. In Railway: **New project → Deploy from GitHub repo → ghufran-star/UltimateCapital**.
2. Add a **PostgreSQL** database to the project, then in the app service's **Variables** add `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`.
3. Optional but recommended: add `SETTINGS_SECRET` (any long random string). It encrypts the API keys you save in the app. Set it once and don't change it.
4. **Settings → Networking → Generate domain.** The first deploy creates the tables automatically.
5. Open the domain. The first screen creates the owner account and the company workspace.
6. In the app, go to **Settings** and follow the setup checklist:
   - Integrations: Public app URL (your Railway domain), Claude API key, Retell, Twilio, Resend (+ From address), RentCast, inbound email domain and webhook secret.
   - States: review the Texas draft (or add your states), have counsel check it, then activate.
   - Contract templates: replace the samples with your attorney's contracts.
   - AI agents: review persona and playbook, then Sync to Retell.
   - Phone numbers: add your Twilio numbers and paste the webhook URLs shown there into Twilio.

Webhook addresses for every provider are listed in Settings → Integrations.

## Stack
Next.js 15 (App Router) and TypeScript, Prisma with Postgres, a background worker started with the server (events, tasks, campaign dialer). Retell (AI voice), Twilio (texts, human calls), Resend (email), RentCast (comps), Claude (conversation intelligence, title email reading, research), pdf-lib (signed PDFs).

Nothing in this app is legal advice. State Packs and contract templates must be reviewed by a licensed attorney in each state before use.
