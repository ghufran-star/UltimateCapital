import { ensureDefaultAgents } from "./agents";
import { db } from "./db";
import { ensurePacks } from "./eligibility";
import { activeRuleSet } from "./valuation";

// Defaults every new workspace starts with: rules, agents, a Texas State Pack draft, sample templates.

export const SAMPLE_SELLER_TEMPLATE = `SAMPLE ONLY — REPLACE WITH YOUR ATTORNEY'S CONTRACT BEFORE USE. NOT LEGAL ADVICE.

RESIDENTIAL PURCHASE AGREEMENT

Date: {{today}}

Seller: {{seller_names}}
Buyer: {{company_name}} and/or assigns

1. PROPERTY. {{property_address}}, {{property_city}}, {{property_state}} {{property_zip}}, County of {{property_county}}. Legal description: {{legal_description}}. Parcel: {{parcel_id}}.

2. PRICE. The purchase price is {{purchase_price}}, payable in cash at closing. The property is purchased in its present "as-is" condition.

3. EARNEST MONEY. Buyer will deposit {{earnest_money}} with {{title_company}} within the period required by law after the Effective Date.

4. OPTION / INSPECTION PERIOD. Buyer may terminate this agreement for any reason within {{option_days}} days after the Effective Date by written notice, and the earnest money will be refunded.

5. CLOSING. Closing will occur on or before {{closing_date}} at {{title_company}}.

6. ASSIGNMENT. Buyer may assign this agreement. {{disclosure_text}}

7. EFFECTIVE DATE. The date the last party signs.

Seller initials: [[initial:seller]]

SELLER
[[sign:seller]]

BUYER
[[sign:company]]
`;

export const SAMPLE_ASSIGNMENT_TEMPLATE = `SAMPLE ONLY — REPLACE WITH YOUR ATTORNEY'S AGREEMENT BEFORE USE. NOT LEGAL ADVICE.

ASSIGNMENT OF PURCHASE AGREEMENT

Date: {{today}}

Assignor: {{company_name}}
Assignee: {{assignee_name}}

Assignor assigns all of its rights under the purchase agreement for {{property_address}}, {{property_city}}, {{property_state}} {{property_zip}} (purchase price {{purchase_price}}) to Assignee.

Assignment fee: {{assignment_fee}}, payable to Assignor at closing through {{title_company}}.

Assignee accepts the property as-is and assumes Assignor's obligations under the purchase agreement. {{disclosure_text}}

ASSIGNEE
[[sign:buyer]]

ASSIGNOR
[[sign:company]]
`;

export async function ensureWorkspaceDefaults(ws: string) {
  await activeRuleSet(ws);
  await ensureDefaultAgents(ws);
  await ensurePacks(ws, ["TX"]);
  const t = await db.contractTemplate.count({ where: { workspaceId: ws } });
  if (!t) {
    await db.contractTemplate.createMany({
      data: [
        { workspaceId: ws, name: "Seller purchase agreement (SAMPLE — replace)", kind: "seller_purchase", body: SAMPLE_SELLER_TEMPLATE },
        { workspaceId: ws, name: "Assignment agreement (SAMPLE — replace)", kind: "assignment", body: SAMPLE_ASSIGNMENT_TEMPLATE },
      ],
    });
  }
}
