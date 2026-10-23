# Build phases

Nine phases. Each one ends with something usable. Phases 2 and 3 can run in parallel. The demo account receives sample data for each phase as it lands.

| # | Phase | Delivers |
| --- | --- | --- |
| 0 | **Foundation** | App shell, logins, roles and workspaces, settings and encrypted keys, shared database (people, properties, ownership, opportunities), task and event engine, state machines, audit history, demo account |
| 1 | **Communications & compliance** | AI and human calling (ported from call-campaigns), texts and email, inbound handling and warm transfer; DNC, consent and opt-outs checked before every contact; State Packs; conversation intelligence (transcript, summary, facts, profile updates, commitments, next actions) |
| 2 | **Buyers** | Investor campaigns, qualification, multiple buy boxes, funding and capacity, contact frequency, buying timeline and frequency, fatigue tracking |
| 3 | **Sellers & properties** | Lead and property intake, verification, seller qualification, property condition discovery, follow-up automation |
| 4 | **Deal Rules & underwriting** | Layered rules (state, market, property type, deal type and more), repair estimator from the playbook, comps and ARV, offer ladder, gross and net investor profit, live preview, rule versions, hard locks and approvals |
| 5 | **Negotiation, matching & hot deals** | Negotiation agent with `get_offer_authority`, near-agreement verification pack, anonymous pre-contract demand campaign, buy-box matching and ranking, hot-deal score, earnest money approval |
| 6 | **Contracts & e-signature** | Templates per state and deal type, auto-fill, delivery by email and text, in-app signing, audit trail and certificate, contract deadlines as tasks |
| 7 | **Title & closing** | Title directory, per-deal title email, closing tracker, settlement statement checks, payments with approval and wire safeguards, bank feed, "Paid" reconciliation |
| 8 | **Command Centre, analytics & scale** | Business dashboard, approvals inbox, exceptions, funnel and profit analytics, learning from outcomes, expansion to new states and markets |

## Before launch (outside the code)
- Texas (and each new state) attorney review of outreach, wholesaling flow, disclosures and contract templates.
- FTC National DNC Registry registration and a do-not-call scrubbing provider.
- Twilio / Retell numbers per market; A2P 10DLC texting registration.
- Title company relationships per market.
