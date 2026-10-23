# Master Blueprint — Addendum A

Version 1.0 · Agreed requirements added after the Master Blueprint v1.0.
Where this addendum and the Master Blueprint differ, this addendum wins.

Items marked **[Non-negotiable]** were stated by the owner as requirements that cannot be compromised.

---

## A1. Scope: multi-state from day one

The business will operate across many US states, not only Texas. Nothing may be hard-coded to one state.

### A1.1 Rule layers
Every configurable rule (pricing, outreach, contracts, compliance) resolves through layers. Each layer overrides the one above only where it differs:

```
National defaults → State → Market (metro/city) → Campaign → Individual deal
```

Every record shows **"Why these rules applied"**: which layer each value came from and which rule version was used.

### A1.2 State Packs
Each state has a **State Pack**: a versioned settings page that the app enforces automatically for every contact, deal and document in that state.

| Area | Examples of settings |
| --- | --- |
| Wholesaling | Whether and how a contract interest may be marketed, required disclosures, licensing thresholds, limits on deal counts |
| Contracts | Attorney-approved templates, assignment permitted, earnest money norms, option / inspection periods |
| Closing | Title-company vs attorney-closing state, notary and recording requirements, remote online notarisation allowed |
| Outreach | State calling hours, state do-not-call list, texting rules, AI-voice consent and disclosure rules, required call disclosures |
| Seller protections | Cancellation rights, required notices |

Rules:
- A state without an **active** State Pack is **blocked** from outreach and contracting.
- The app may pre-fill a draft State Pack from public sources, marked **"Unverified — needs legal review"**. Only the owner (or counsel acting for them) can switch a state to **active**.
- Legal contract templates are provided by the owner's attorneys. The app fills and routes them; it does not author legal terms.

---

## A2. Deal Rules engine

Owner-editable rules for every price the business offers or asks. **[Non-negotiable: must be customisable in a very easy, efficient and effective way.]**

### A2.1 What can be configured
| Rule group | Settings |
| --- | --- |
| Repair estimate | Owner's playbook cost table (roof, foundation, HVAC, plumbing, electrical, kitchen, baths, flooring, paint, $/sq ft by condition level). AI maps the seller's answers onto it and returns low / likely / high with reasoning |
| Seller offers | First offer, second offer (and further rounds if enabled), maximum buying price — each as a rule, e.g. % of ARV − repairs − costs − our margin |
| Our margin | Minimum and target assignment fee; fixed amount or % |
| Investor margin | Required profit or discount, taken from the investor's buy box; assessed on **net** and/or **gross** |
| Buyer pricing | Opening asking price, round 2, round 3 … and a minimum selling price (floor) |
| Approvals | Thresholds above/below which the owner must approve |
| Near-agreement gap | Gap (amount or %) that triggers the verification pack (A4.1) |
| Hot-deal threshold | Score and number of serious investors that trigger the earnest money recommendation (A4.3) |

### A2.2 Variables rules can be set by
Any combination of the following; the **most specific matching rule** applies:
- State, market/city, ZIP, neighbourhood
- Property type: single-family, condo/townhouse, 2–4 units, 5+ units, mobile home with land, land/lots, commercial
- Deal type: assignment, double close, novation, subject-to, seller finance, wholetail
- Exit strategy: flip or rental (rentals use rent, cash-flow, cap-rate and cash-on-cash rules instead of ARV)
- Condition tier: cosmetic, moderate, heavy, full gut
- Price band and ARV band
- Occupancy: vacant, tenant-occupied, owner-occupied
- Title complexity: probate, liens, back taxes
- Buyer demand level in the area

### A2.3 Investor profit: gross and net
- **Gross** = ARV − purchase price − repairs
- **Net** = Gross − buying closing costs − holding costs (months × (taxes + insurance + utilities + loan interest)) − loan fees/points − selling costs (agent %, seller closing costs) − contingency %

All cost assumptions are settings. The investor minimum can apply to gross, net or both (default: net).

### A2.4 Ease of use
- **Plain fields and sliders, never code or formulas.** The app builds the calculation from the settings.
- **Live preview:** a sample property (or any past deal) runs through the rules while they're being edited, showing every number: max buy, offer ladder, buyer price ladder, floor, our fee, investor gross and net profit. Changes are visible before saving.
- **Versioning:** every save creates a new rule version; every offer and price records the version that produced it.

### A2.5 Hard locks **[Non-negotiable]**
- Before any offer or price leaves the app (call, text, email, contract), the system checks it against the active rules.
- The AI is **never given the maximum buying price or the floor**. During negotiation it calls `get_offer_authority`, which returns only the next permitted step (e.g. "You may offer $106,250; if countered you may go to $116,250; above that request approval").
- Anything outside the rules becomes an approval request to the owner. Every attempt is logged.

---

## A3. Investor (buyer) rules

### A3.1 Matching **[Non-negotiable]**
A deal is offered only to investors whose buy box it actually fits: location, property type, price, condition, strategy, required margin (net/gross), and verified funds where required. Each match shows a fit score and the reasons. Presentations are framed in the investor's terms (flippers: ARV and margin; landlords: rent and yield).

### A3.2 Contact frequency and timing
- Maximum number of new deals sent per investor per week / month (global default, per-investor override).
- **Stated buying timeline** (e.g. "buying again in March") pauses deal outreach until then.
- **Buying frequency** (e.g. "2 per month") raises ranking and allowance.
- **Fatigue tracking:** after X ignored deals in a row, frequency drops and a relationship check-in task is created.
- Quiet hours and preferred channel per investor.

---

## A4. Deal flow: verification, pre-contract demand and earnest money

### A4.1 Near-agreement verification pack
When the gap between the seller's position and our authorised price falls within the configured gap:
1. The owner receives a **verification pack**: property details, photos, seller conversation summary, repair estimate, comps, every calculation, likely buyers.
2. **Simultaneously, without waiting for owner verification,** buyer-demand outreach starts at the **presumptive deal price** (close to the seller's latest position). See A4.2.
3. **The final offer, price lock and contract are only sent after the owner approves.** [Hard lock]

### A4.2 Pre-contract buyer demand campaign **[Non-negotiable]**
Before a seller contract is signed, the deal's buyer campaign must already be running by email, text and calls to matching investors.

Compliance design (to be confirmed by counsel per state):
- **Before contract:** an **anonymous demand check**: property described without address or seller details (e.g. "3/2, ~1,400 sq ft in 77088, light rehab, around $150K. Would you buy at that?"). This measures demand without marketing a specific property the business doesn't control.
- **After contract (within an option / inspection period where the state allows):** full marketing with the disclosures required by that state's State Pack (e.g. disclosing that a contract interest, not the property, is being sold).

### A4.3 Hot-deal score and earnest money
- **Hot-deal score (0–100)** from: number of interested investors and seriousness, response speed, offers or prices mentioned, each investor's closing track record.
- **Trigger (configurable):** ≥ 2 serious interested investors **and** score above threshold → deal flagged **"Hot: recommend earnest money"**.
- The owner approves with one tap. The app records the deposit, creates deadline tasks, and tracks it with title. Funds move only through the title/escrow company.

---

## A5. Contracts and e-signature (built in)

- **Templates:** owner uploads attorney-approved templates per state and deal type (purchase agreement, assignment, addenda). Fields auto-fill from the deal record.
- **Delivery:** secure, expiring link sent by **email and text**; optional AI follow-up call.
- **Signing:** opens on any phone or computer; consent to sign electronically; tap to sign and initial; owner countersigns in the app.
- **Legal record:** full audit trail (who, when, IP, device, every view and signature), tamper-evident final PDF and certificate of completion, aligned with the US ESIGN Act and UETA.
- **On signature:** deal moves to **Under contract**; option period, earnest money due date and closing date become tasks with reminders.

---

## A6. Do-not-call and consent (automated)

Every number is checked **immediately before every call and text** (not only at import) against:
- **National DNC Registry** (owner registers with the FTC; the app refreshes the lists for the campaign's area codes on the required schedule).
- **State DNC lists** where a state maintains one (automatic download where available; otherwise owner upload with reminders).
- **Internal opt-outs:** "stop", "don't call", "remove me" in any call or text blocks the person everywhere instantly.
- **FCC Reassigned Numbers Database.**
- **Known serial litigant lists** via a scrubbing provider.
- **Consent records** for AI-voice and text outreach where required (federal rules treat AI voices as artificial voice calls).

---

## A7. Title and closing

- **Title company directory:** contacts, preferred documents, fees, turnaround, notes per state.
- **"Open title" in one tap:** emails the full package (contract, assignment, IDs, entity documents, earnest money proof). Each deal gets **its own email address**; title replies land in the deal and the AI updates the checklist.
- **Title tracker:** order placed → commitment → liens/payoffs → curative items → buyer funds → settlement statement → closing scheduled → closed → paid. Overdue items are chased automatically.
- **Settlement statement check:** the app reads the statement and flags wrong fees, credits or names before signing.
- **Payments:** shows exactly what is due, when and to whom (earnest money, option fee, title fees); logs payments and receipts; can prepare transfers via the business bank's API for one-tap owner approval. **Wire instructions are always verified by phone to a known number**; the app warns on any change (wire fraud protection).
- **Virtual closing:** schedules remote online signing where the state and title company allow; tracks completion.
- **Getting paid:** bank feed connection detects the incoming assignment fee, matches it to the deal, marks it **Paid**, and updates profit reporting.

Limits: the app never signs on the owner's behalf, never moves money without approval, and recording/escrow/disbursement remain with authorised parties.

---

## A8. Accounts, workspaces and the demo account

- **Workspaces:** separate businesses or entities (e.g. one LLC per state) in one login, each with its own data, numbers, rules and State Packs.
- **Roles:** Owner, Admin, Acquisitions, Dispositions, Transaction Coordinator, Caller/VA, View-only. Each role sees and does only what it's permitted to.
- **Assignment:** campaigns, markets, states, buyers, sellers and deals can be assigned to a person or an AI agent, including rules such as round-robin of hot leads.
- **Multiple provider accounts:** several Twilio and Retell accounts, local numbers per market, sending email per workspace.
- **Demo account:** view-only, switchable from Settings, full of sample buyers, sellers, deals at every stage, calls with transcripts, contracts and a closing in progress. Never uses real API keys or contacts anyone.

---

## A9. Calling (in-app, inbound and outbound)

- **AI outbound:** campaign dialing via Retell within permitted hours, retry and concurrency rules, after DNC and consent checks.
- **Human outbound:** in-app keypad and "Call" button on every record; calls run through the app (Twilio browser calling) from the correct local number; recorded, transcribed and saved to the person's timeline.
- **Inbound:** known caller → AI answers with full context, or rings the assigned person; unknown caller → receptionist agent qualifies; missed → voicemail transcribed into a task.
- **Live hand-off:** AI warm-transfers to a human with a short whisper summary (e.g. "Mary, 3/2 in 77088, wants $160K, motivated, probate").

---

## A10. AI agents and prompting

### A10.1 Agents
Buyer Acquisition · Buyer Relationship / Disposition · Seller Acquisition · Property Discovery · Negotiation · Inbound Receptionist · Transaction Coordinator (email and text only).

### A10.2 Prompt layers (assembled fresh for every interaction)
1. **Role:** identity and goal (editable).
2. **Hard rules:** identical for every agent, not editable: identify the business, never misrepresent, never invent buyers, funding or competing offers, honour opt-outs instantly, never state numbers not provided by tools.
3. **State Pack:** that state's disclosures and calling rules (automatic).
4. **Campaign playbook:** what to learn and in what order, tone, objection handling (editable).
5. **Live context:** name, property, last summary, known facts (never re-asked), outstanding questions.
6. **Tools:** `record_fact`, `schedule_callback`, `send_text`, `get_offer_authority`, `request_approval`, `transfer_to_human`, `mark_do_not_contact` (editable which tools each agent has).

### A10.3 Agent editor
Carried over from call-campaigns: versioned agents, test calls, practice scenarios, call review and scoring.

---

## A11. Reuse from call-campaigns

UltimateCapital is a **new codebase** (Next.js, TypeScript, Postgres, Railway), not built on top of call-campaigns, because the blueprint needs a shared entity model, versioned facts, state machines and an event-driven task engine. Proven modules are ported and rewritten against the new data model:

| From call-campaigns | Becomes |
| --- | --- |
| Retell dialer (windows, retries, concurrency, webhooks) | Outreach engine |
| Agent editor, voice tests, practice scenarios | Agent setup per role |
| Call review, coach, transcripts, summaries | Conversation intelligence |
| Twilio texting and two-way messages | SMS channel |
| In-app phone (Twilio browser calling), inbound handling, warm transfer flows | In-app calling (A9) |
| DNC list and opt-outs | Contact eligibility and compliance controller |
| Meetings and callbacks | Task engine events |
| CSV/Excel importer and dedupe | Lead and property intake |
| Users, invites, push notifications | Access control and alerts |
| Business profile and learning loop | Business rules and continuous improvement |
