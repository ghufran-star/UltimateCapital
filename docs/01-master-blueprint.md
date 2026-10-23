# AI WHOLESALING — MASTER BUSINESS & PRODUCT BLUEPRINT

Version 1.0 · United States · Houston & San Antonio, Texas

1. Product vision

Build a fully integrated, AI-operated real estate wholesaling business that identifies potential property sellers, builds relationships with cash buyers, evaluates acquisition opportunities, negotiates transactions, matches properties to investors and coordinates the closing process.

The system operates from a single application, with persistent business memory, automated workflows, configurable campaigns and centralized oversight.

The goal: Run the maximum possible portion of the wholesaling operation autonomously, while ensuring financial decisions, communications, contracts and legal obligations remain within approved rules.

The application is not simply a CRM or an AI calling platform. It is the operating system for the entire business.

2. End-to-end business architecture

Business Command Centre

Markets · Campaigns · Acquisition Rules · Budgets · Approvals · Analytics

Cash Buyer Acquisition

Identify, contact, qualify and maintain investor relationships and buy boxes.

Seller Acquisition

Source properties, contact owners, qualify opportunities and collect property evidence.

Property Intelligence & Underwriting

Comparable sales · ARV · Repairs · Risk · Buyer Economics · Offer Limits

Seller Negotiation

Offers, counters, terms, approvals and contracting.

Buyer Disposition

Buyer matching, property presentations and commitments.

Contract & Closing Operations

Signatures · Title · Escrow · Assignment · Deadlines · Settlement

Analytics & Continuous Improvement

Conversion · Margins · Buyer Behaviour · Campaign Efficiency · Risk

All modules share one database, conversation history, task engine and business rules.

3. Cash buyer acquisition and management

Purpose: Build a continuously updated network of qualified investors whose buying criteria are sufficiently understood to match them with suitable properties.

Investor acquisition sequence

* Lead intake: Import or identify prospective investors, deduplicate records and establish lawful outreach eligibility.
* Initial contact: Establish whether they purchase investment properties, their target markets and current activity.
* Qualification: Discover investment strategy, geographic preferences, property types, price ranges, renovation tolerance and expected returns.
* Buy box creation: Store one or more structured buy boxes per investor.
* Capacity verification: Establish financing method, proof-of-funds status where relevant, purchasing capacity and closing requirements.
* Activation: Make eligible investors available for property matching.
* Relationship management: Maintain conversation history, contact preferences, objections, deal feedback and agreed follow-ups.
* Requalification: Update criteria and capacity as investor circumstances change.

Buy box data structure

Category	Required information
Investor	Identity, company, role, contact details
Markets	Cities, ZIP codes, neighbourhoods, exclusions
Properties	Types, beds/baths, area, construction age
Strategy	Flip, rental, BRRRR, redevelopment
Budget	Preferred range, maximum price, financing
Condition	Renovation tolerance and unacceptable defects
Economics	Required profit, yield, return or acquisition discount
Execution	Funding verification, closing speed, current capacity
Preferences	Communication channels, frequency, deal presentation
History	Calls, texts, properties pitched, offers, rejections, purchases

An investor can have multiple independent buy boxes.

Example: A buyer may target Houston flips under $180,000 and San Antonio rentals under $250,000. Those criteria must remain separate.

Investor statuses

NEW → ELIGIBLE → CONTACTED → ENGAGED → QUALIFYING → QUALIFIED → ACTIVE

Additional independent states include dormant, capacity unverified, temporarily unavailable and do not contact.

The app must distinguish relationship status, outreach eligibility, funding verification and interest in individual deals.

Buyer conversation rules

Conversations are natural and progressive, not scripted questionnaires.

The AI collects information over multiple interactions, remembers previous answers, avoids unnecessary repetition and records contradictions.

Each interaction generates a summary, structured facts, profile changes, commitments, unresolved questions and next actions.

A buyer’s rejection of one property must not automatically become a permanent buy-box exclusion.

4. Seller acquisition and property sourcing

Purpose: Convert eligible property leads into researched, financially viable and contract-ready acquisition opportunities.

Campaign configuration

Each campaign defines:

* Market, ZIP codes and geographic boundaries.
* Property types, age, size, estimated values and other filters.
* Owner segments, such as absentee or long-term owners.
* Lead sources and data verification requirements.
* Outreach eligibility, contact methods, calling windows and retry rules.
* Conversation objectives and follow-up policies.
* Valuation methodology, offer limits and approval thresholds.
* Campaign budgets and success metrics.

Campaigns are independently configurable and version-controlled.

Seller acquisition sequence

* Property lead intake: Import property records and identify likely owners.
* Verification: Confirm property identity, available ownership information, contact sources and outreach eligibility.
* Initial outreach: Contact the appropriate owner, identify the business and establish possible selling interest.
* Seller qualification: Determine motivation, timing, asking price, decision-makers and transaction preferences.
* Property discovery: Collect property characteristics, condition, renovations, damages, occupancy, financial issues and access information.
* Research: Verify available property facts, comparable sales, repair assumptions, ownership and transaction risks.
* Underwriting: Calculate value ranges, acquisition economics and maximum authorized offer.
* Offer preparation: Establish opening price, target price, ceiling and permitted terms.
* Offer presentation: Communicate the approved offer through a permitted channel.
* Negotiation: Handle objections, counteroffers, changed terms and additional information.
* Contract readiness: Confirm ownership authority, agreed terms, title considerations and document requirements.
* Contract execution: Coordinate approved agreements, signatures and effective-date confirmation.
* Handoff: Transfer the effective contract and supporting records into disposition and closing.

Seller and property information

Seller data	Property data
Identity and contact details	Address, parcel and legal description
Ownership relationship	Property type, size, age and layout
Motivation and timeline	Roof, foundation, HVAC, plumbing, electrical
Asking price and flexibility	Interior, exterior, renovations and damage
Decision-makers	Occupancy, leases and access
Preferred closing terms	Photos, inspections and supporting documents
Communication preferences	Taxes, liens, mortgages and title flags
Negotiation history	As-is value, ARV, repair estimates
Follow-up commitments	Comparable sales and valuation history
Contact permissions	Offer and contract history

One seller may own several properties. One property may have several owners. The database must support both.

Seller opportunity statuses

NEW → ELIGIBLE → OUTREACH → ENGAGED → QUALIFIED → PROPERTY DISCOVERY → UNDERWRITING → OFFER READY → NEGOTIATION → CONTRACT PREPARATION → UNDER CONTRACT

Exception states include callback scheduled, awaiting documents, valuation blocked, approval required, declined, withdrawn, ownership dispute, contract failed and do not contact.

5. AI conversation intelligence

Purpose: Convert every communication into reliable business memory and actionable tasks.

The app supports calls, texts, emails, callbacks and other approved communication channels.

Every interaction creates six outputs:

Output	Description
Transcript	Original conversation or message record
Summary	Concise explanation of what happened
Structured facts	Extracted information with source and confidence
Profile updates	Changes to buyer, seller, property or opportunity records
Commitments	Agreements, requested callbacks, promised documents or responses
Next actions	Tasks with trigger, deadline, permitted channel and completion condition

Memory rules

* Never overwrite historical information without retaining previous versions.
* Distinguish reported facts, verified facts, estimates and AI inferences.
* Link important extracted facts to their source interaction.
* Record when information was last confirmed.
* Detect contradictions and request clarification where necessary.
* Preserve complete negotiation and offer histories.
* Share relevant context across agents and campaigns.
* Respect privacy, retention and access restrictions.

Conversation interface

Each contact or property record displays:

Current situation → Latest summary → Important facts → Outstanding questions → Next action → Full timeline.

Users can expand summaries into transcripts, messages, documents and the evidence behind individual fields.

6. Follow-up and task automation

Purpose: Ensure every appropriate commitment or business event produces the correct next action.

Tasks must contain a unique ID, linked record, reason, trigger, priority, due time, responsible agent or person, permitted channel, current status and cancellation conditions.

Event	System response
Callback requested	Schedule agreed contact
No answer	Apply permitted retry policy
Seller requests an offer	Start or resume valuation
Property details change	Recalculate affected underwriting
Seller counters	Reassess economics and negotiation authority
Buyer changes criteria	Update buy box and rerun matching
Matching opportunity becomes available	Check eligibility and initiate approved presentation
Seller or buyer sends documents	Validate, attach and update workflow
Contract becomes effective	Activate closing and disposition obligations
Deadline approaches	Escalate outstanding requirements
Opt-out received	Suppress prohibited outreach and cancel affected tasks

Tasks are event-driven, deduplicated and automatically updated when circumstances change.

No agent should make a redundant call because another agent has already completed the relevant task.

7. Property research and valuation

Purpose: Determine whether a property represents a financially viable acquisition and establish defensible offer limits.

Research inputs

* Verified property characteristics and ownership information.
* Recent comparable sales, with source, date and adjustments.
* As-is market value.
* After-repair value (ARV).
* Estimated renovation scope and cost range.
* Holding, financing, closing and other relevant costs.
* Title, occupancy, access and property-condition risks.
* Qualified investor demand and likely exit price.
* Confidence levels and missing evidence.

Offer calculation

A simplified flip-oriented model:

```
MAO = (ARV × r) − R − C − F
```

Where:

* r: approved acquisition factor.
* R: estimated renovation cost.
* C: applicable costs.
* F: target assignment fee or margin.

The formula is configurable, not universally fixed at 70%.

The system produces:

* Estimated as-is and after-repair values.
* Opening offer.
* Target acquisition price.
* Maximum allowable offer.
* Estimated investor exit price.
* Expected assignment margin.
* Downside scenario and confidence assessment.

All calculations are deterministic, auditable and tied to the applicable rule version.

Insufficient evidence blocks unsupported firm valuations.

8. Negotiation and offer management

Purpose: Reach economically acceptable terms without exceeding authorized limits or misrepresenting the transaction.

The negotiation agent receives the full relationship history, property evidence, seller preferences, current valuation and approved negotiating range.

It can:

* Present authorized offers.
* Explain the commercial rationale accurately.
* Capture seller objections and counteroffers.
* Evaluate permitted concessions.
* Request additional evidence.
* Propose authorized revised terms.
* Schedule agreed decision callbacks.
* Escalate offers exceeding its authority.

Offer ledger

Every offer version stores the proposed price, terms, party, date, underlying valuation, authority, response and resulting next action.

Hard rule: The AI cannot exceed the maximum authorized offer, make unauthorized commitments, invent competing offers or misrepresent funding.

A verbal acceptance moves the opportunity into contract preparation. It does not establish an effective contract by itself.

9. Buyer matching and deal disposition

Purpose: Find investors whose actual criteria and purchasing ability fit a specific opportunity, then progress eligible interest toward a transaction.

Matching logic

Property Opportunity

Location · Type · Condition · Price · Returns · Terms

Hard Eligibility Filters

Buy box · Budget · Exclusions · Capacity · Contact Permission

Investor Ranking

Economic Fit · Purchasing Reliability · Activity · Preferences

Authorized Deal Presentation

Verified Details · Calls / Texts · Feedback · Buyer Commitment

Disposition sequence

* Confirm the business has the required legal interest and authority to market the opportunity.
* Create a verified property presentation.
* Identify and rank eligible investors.
* Contact investors through permitted channels.
* Explain the opportunity using verified property information.
* Capture interest, objections, proposed prices and requested documents.
* Send approved property details and supporting materials.
* Coordinate inspections, access and due diligence where authorized.
* Verify funding, buyer terms and seriousness of commitment.
* Coordinate approved assignment or other legally permitted transaction documents.
* Record executed agreements and initiate closing obligations.

Deal presentation data

Property address or authorized location disclosure, property type, size, beds/baths, occupancy, condition, price, ARV and repair estimates with sources, photos, access, relevant terms, deadlines and known uncertainties.

The system must not present unsupported figures as verified facts.

Buyer interest states

MATCHED → CONTACT ELIGIBLE → PRESENTED → INTERESTED → DUE DILIGENCE → OFFER SUBMITTED → TERMS AGREED → AGREEMENT EXECUTED → CLOSING → COMPLETED

Alternative states include rejected, no response, financing unverified, withdrawn and deal unavailable.

Buyer interest is not equivalent to a binding commitment.

10. Contract and closing coordination

Purpose: Progress valid transactions from effective agreements through assignment or another approved exit and settlement.

The system tracks:

* Seller contract and actual effective date.
* Legal description and verified parties.
* Purchase price, earnest money and contingencies.
* Inspection, financing and closing deadlines.
* Assignment permissions and required disclosures.
* Buyer agreement and assignment consideration.
* Title, liens, taxes, ownership and document requirements.
* Escrow and deposit confirmation.
* Signatures and document completion.
* Closing statements and settlement confirmation.
* Actual fees, expenses and net proceeds.

Closing workflow

CONTRACT EFFECTIVE → TITLE OPENED → DUE DILIGENCE → BUYER AGREEMENT → CONDITIONS SATISFIED → CLOSING SCHEDULED → FUNDS CONFIRMED → CLOSED → FINANCIAL RECONCILIATION

The system coordinates with the appropriate title company, attorney, escrow provider and transaction participants.

It may prepare and route approved documents, monitor obligations and send permitted communications. Binding legal actions require the necessary authority, and recording, escrow and fund disbursement remain with authorized parties.

If a contract expires, terminates or becomes unassignable, the system must stop any disposition activities dependent on that contract.

11. Central business database

Purpose: Maintain one consistent source of truth for the entire operation.

Entity	Main responsibility
Campaign	Targeting, rules, budgets and performance
Contact	Buyer, seller or other participant identity
Contact eligibility	Permissions, restrictions and channel controls
Property	Physical property and identifying details
Ownership	Relationships between people, entities and properties
Buy box	Investor acquisition criteria
Opportunity	Potential acquisition or disposition
Interaction	Conversations, messages and outcomes
Evidence	Documents, photos, reports and verification
Valuation	Calculations, assumptions and model versions
Offer	Seller or buyer proposals and responses
Task	Pending work, triggers and deadlines
Contract	Executed agreements and obligations
Transaction	Closing workflow and settlement
Financial record	Costs, deposits, fees and realized margins
Audit event	Historical changes, authorizations and actions

Database principles

All records have stable identifiers, timestamps, relationships and appropriate version histories.

A single interaction can update multiple linked entities. For example, a seller mentioning a new roof problem can update property evidence, invalidate an earlier valuation, create a research task and temporarily suspend an offer.

All updates must be traceable to their source.

12. AI agents and functional responsibilities

These are logical roles, not necessarily separate AI models or software services.

Function	Responsibility
Campaign Manager	Executes approved campaign targeting and operational rules
Buyer Acquisition Agent	Engages investors and develops buy boxes
Buyer Relationship Agent	Maintains investor history, preferences and agreed follow-ups
Seller Acquisition Agent	Engages owners and qualifies selling opportunities
Property Discovery Agent	Collects property characteristics, condition and evidence
Research Agent	Assembles property facts, comps and valuation evidence
Underwriting Engine	Performs approved calculations and risk checks
Negotiation Agent	Presents authorized offers and handles counteroffers
Matching Engine	Filters and ranks suitable buyers
Disposition Agent	Presents eligible opportunities and manages buyer responses
Transaction Coordinator	Tracks contracts, documents, title and closing tasks
Compliance Controller	Enforces outreach, authority, disclosure and workflow restrictions
Operations Supervisor	Detects exceptions, conflicts, failures and unresolved decisions

Every function works from shared records and must respect the same permissions, state transitions and audit requirements.

13. App UI and customer journeys

The application has six principal workspaces.

1. Command Centre

Business-wide performance, pipeline, campaign activity, financial forecasts, urgent deadlines, blocked actions and approval requests.

2. Campaign Studio

Create, configure, launch, pause and evaluate buyer or seller campaigns, including targeting, data inputs, communication policies and business rules.

3. Buyers

Investor profiles, buy boxes, capacity, qualification, conversation intelligence, matching opportunities and relationship history.

4. Properties & Sellers

Property records, ownership, condition, evidence, seller motivations, valuations, offers, negotiations and follow-ups.

5. Deals & Closings

Opportunity pipeline, buyer matching, contracts, deadlines, title coordination, closing progress and settlement accounting.

6. AI Operations

Agent activity, conversation reviews, workflow history, exceptions, approvals, model decisions, errors and compliance monitoring.

User experience principles

The app should be exception-driven: routine work progresses automatically; the user sees decisions, opportunities and problems requiring attention.

Every buyer, seller, property and transaction opens into a unified record with its current status, concise summary, important data, history, outstanding issues and next actions.

From a single record, the user can inspect the evidence behind any valuation, conversation summary, profile change, offer or automated decision.

14. Workflow and autonomy rules

The system operates through events and explicit state transitions.

Every workflow defines:

* Entry conditions.
* Required data.
* Authorized actions.
* Decision rules.
* Completion evidence.
* Next permitted state.
* Failure and exception handling.

Autonomy levels

Level	Examples
Fully automated	Eligible data intake, deduplication, permitted routine communication, extraction, scheduling and matching
Rule-constrained	Valuations, offers, counteroffers, investor ranking and document preparation
Approval-gated	Exceptional pricing, binding commitments, disputed ownership, unusual contract terms and high-risk decisions
External-party controlled	Signatures by authorized parties, title decisions, escrow, fund transfers and recording

No agent can bypass hard restrictions, silently increase its authority or change the business rules governing its own decisions.

Failed actions are retried only when safe. Duplicate events must not create duplicate calls, offers, contracts or payments.

15. Compliance and risk management

The application must incorporate legal and operational safeguards from the beginning.

Outreach: Apply applicable federal and state restrictions to AI-generated voice calls, texts, telemarketing, consent, do-not-call requests, calling hours, identification and recording.

Wholesaling: Confirm the business’s legal interest, assignment rights, required disclosures and licensing boundaries for the actual transaction. Texas requirements should be reviewed by qualified counsel before launch.

Representations: Never invent ownership, available funding, property condition, competing offers, deadlines, ARV, repairs or buyer commitments.

Data: Protect personal information, enforce role-based access, maintain retention policies and preserve audit evidence.

Transactions: Use legally reviewed documents, verified signatory authority and appropriate professional oversight.

Financial risk: Enforce offer ceilings, margin requirements, risk thresholds and approval limits.

System safety: Monitor failed tasks, inconsistent records, unauthorized actions, duplicated communication and stale information.

16. Performance and business intelligence

The application should measure the entire business funnel.

Business area	Key metrics
Buyer acquisition	Contact rate, qualification rate, verified buyers, acquisition cost
Seller acquisition	Engagement, qualified opportunities, offers and contract conversion
Underwriting	ARV accuracy, repair estimate accuracy, valuation uncertainty
Negotiation	Acceptance rate, counteroffer patterns, discount achieved
Matching	Match acceptance, buyer response, offers per opportunity
Disposition	Time to committed buyer, buyer reliability, assignment conversion
Closing	Contract-to-close rate, delays, failed transactions
Financial	Cost per closed deal, assignment fees, expenses, net profit
AI operations	Task completion, errors, escalations, compliance events

Continuous improvement

The system learns from actual outcomes:

* Which ZIP codes generate profitable acquisitions?
* Which seller segments produce viable contracts?
* Which buyers reliably close?
* Which buy-box criteria predict real offers?
* Which renovation assumptions are consistently inaccurate?
* Which offers succeed without destroying margins?
* Which follow-up strategies produce useful engagement?
* Which campaign spending produces the highest realized profit?

Learning improves recommendations, targeting and prioritization. Changes to binding financial or compliance rules require authorized approval.

17. Build sequence

01

Core Data & Workflow Foundation

Unified records, states, tasks, audit history, permissions and conversation memory.

02

Buyer Acquisition & Buy Boxes

Investor campaigns, qualification, multiple buy boxes, relationship management and capacity tracking.

03

Seller Acquisition & Property Discovery

Property campaigns, owner records, conversations, condition profiles and follow-up automation.

04

Research, Underwriting & Offers

Evidence collection, comparable sales, valuation rules, risk assessment and authorized negotiations.

05

Matching & Disposition

Buyer eligibility, ranking, property presentation, feedback and commitment management.

06

Contracts & Closing

Legally reviewed agreements, transaction coordination, deadlines, settlement and reconciliation.

07

Optimization & Scale

Campaign intelligence, operational analytics, quality monitoring and expansion to additional markets.

18. Final product definition

The finished application must be capable of running the following complete cycle:

Investor side: Identify eligible investors → establish contact → qualify them → build buy boxes → maintain relationships → track capacity → match relevant opportunities → manage offers and commitments.

Seller side: Identify properties → verify owner and contact eligibility → establish interest → qualify seller → assess property → research value → calculate offers → negotiate → coordinate legally approved contracts.

Transaction side: Verify contractual rights → match and approach eligible buyers → negotiate buyer terms → coordinate assignment or other approved exit → manage title and closing → reconcile proceeds.

Intelligence layer: Preserve all conversations, extract facts, update structured records, execute follow-ups, monitor every stage, learn from outcomes and surface exceptions.

Management layer: Allow you to configure markets, campaigns, valuation policies, offer authority, communication rules, operational budgets and approval thresholds without rebuilding the underlying system.

The defining architecture is:

One business. One shared memory. Multiple specialized AI functions. Deterministic rules. Event-driven workflows. Complete transaction visibility.

This is the consolidated Master Blueprint v1.0. It specifies what the business and application must accomplish, without prescribing the technologies used to build it.