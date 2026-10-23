import { NextRequest } from "next/server";
import { conditionShort, label as catLabel, OCCUPANCY, OWNER_TYPES, SITUATIONS, shortType } from "@/lib/catalog";
import { db } from "@/lib/db";
import { DEAL_COLUMNS, dealRow } from "@/lib/dealrows";
import { dealScope, errorResponse, propertyScope, requireCtx } from "@/lib/session";
import { fullName } from "@/lib/util";
import { activeRuleSet } from "@/lib/valuation";

export const dynamic = "force-dynamic";

// CSV export of any main table. Respects the member's states; demo and viewers can export too (read only).

type Row = Record<string, unknown>;
const esc = (v: unknown) => {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.join("; ") : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function csv(rows: Row[], cols?: string[]) {
  const keys = cols || [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return [keys.join(","), ...rows.map((r) => keys.map((k) => esc(r[k])).join(","))].join("\r\n");
}
const sits = (k: string[]) => k.map((x) => catLabel(SITUATIONS, x)).join("; ");

export async function GET(req: NextRequest, { params }: { params: Promise<{ table: string }> }) {
  try {
    const c = await requireCtx();
    const ws = c.workspace.id;
    const { table } = await params;
    const sp = req.nextUrl.searchParams;
    let rows: Row[] = [];
    switch (table) {
      case "deals": {
        const stages = sp.get("stage")?.split(",");
        const deals = await db.opportunity.findMany({
          where: { workspaceId: ws, ...dealScope(c), ...(stages ? { stage: { in: stages } } : {}), ...(sp.get("state") ? { property: { state: sp.get("state")! } } : {}) },
          include: { property: true, valuations: { orderBy: { createdAt: "desc" }, take: 1 }, interests: { select: { serious: true } } },
          orderBy: { updatedAt: "desc" },
          take: 20000,
        });
        const rs = await activeRuleSet(ws);
        const sellers = await db.contact.findMany({ where: { id: { in: deals.map((d) => d.sellerId).filter(Boolean) as string[] } } });
        rows = deals.map((d) => {
          const r = dealRow(d, rs.data, sellers.find((s) => s.id === d.sellerId) || null);
          const out: Row = { id: r.id, address: r.address, city_state_zip: r.place };
          for (const col of DEAL_COLUMNS) if (col.key !== "property") out[col.label] = r[col.key as keyof typeof r];
          return out;
        });
        break;
      }
      case "sellers": {
        const list = await db.contact.findMany({
          where: { workspaceId: ws, kind: { not: "buyer" }, OR: [{ kind: "seller" }, { ownerships: { some: {} } }], ...(c.states.length ? { ownerships: { some: { property: propertyScope(c) } } } : {}) },
          include: { ownerships: { include: { property: true } } },
          take: 50000,
        });
        rows = list.map((s) => ({ id: s.id, name: fullName(s), phone: s.phone, phone2: s.phone2, email: s.email, status: s.sellerStatus, do_not_contact: s.doNotContact, properties: s.ownerships.map((o) => `${o.property.address}, ${o.property.city} ${o.property.state} ${o.property.zip}`), situation: sits([...new Set(s.ownerships.flatMap((o) => o.property.situations))]), last_contact: s.lastContactAt, summary: s.summary, tags: s.tags }));
        break;
      }
      case "properties": {
        const list = await db.property.findMany({ where: { workspaceId: ws, ...propertyScope(c) }, include: { ownerships: { include: { contact: true } } }, take: 50000 });
        rows = list.map((p) => ({ id: p.id, address: p.address, city: p.city, state: p.state, zip: p.zip, county: p.county, parcel: p.parcel, type: shortType(p.propertyType), beds: p.beds, baths: p.baths, sqft: p.sqft, lot_acres: p.lotAcres, year_built: p.yearBuilt, rehab: conditionShort(p.conditionTier), occupancy: p.occupancy ? catLabel(OCCUPANCY, p.occupancy) : "", situation: sits(p.situations), owner_type: p.ownerType ? catLabel(OWNER_TYPES, p.ownerType) : "", absentee: p.absentee, est_value: p.estValue, mortgage_balance: p.loanBalance, equity: p.estValue != null ? p.estValue - (p.loanBalance || 0) : "", last_sale_price: p.lastSalePrice, last_sale_date: p.lastSaleDate, owners: p.ownerships.map((o) => fullName(o.contact)), title_issues: p.titleFlags }));
        break;
      }
      case "buyers": {
        const list = await db.contact.findMany({ where: { workspaceId: ws, kind: "buyer" }, include: { buyBoxes: true }, take: 50000 });
        rows = list.map((b) => ({ id: b.id, name: fullName(b), company: b.company, phone: b.phone, email: b.email, status: b.buyerStatus, funds_verified: b.fundsVerified, funding: b.fundingMethod, closes_in_days: b.closingSpeedDays, buys_per_month: b.buyingPerMonth, not_buying_until: b.nextBuyingAt, deals_closed: b.dealsClosed, reliability: b.reliability, do_not_contact: b.doNotContact, buy_boxes: b.buyBoxes.map((x) => `${x.name}: ${[...x.states, ...x.markets].join("/")} ${x.propertyTypes.map(shortType).join("/")} up to ${x.maxPrice ?? "?"}`) }));
        break;
      }
      case "calls":
      case "messages": {
        const list = await db.interaction.findMany({ where: { workspaceId: ws, channel: table === "calls" ? "call" : { in: ["sms", "email"] } }, include: { contact: true }, orderBy: { createdAt: "desc" }, take: 50000 });
        rows = list.map((i) => ({ id: i.id, when: i.createdAt, channel: i.channel, direction: i.direction, contact: i.contact ? fullName(i.contact) : "", from: i.fromAddr, to: i.toAddr, outcome: i.outcome, duration_sec: i.durationSec, summary: i.summary, recording: i.recordingUrl, subject: i.subject, text: i.body }));
        break;
      }
      case "payments":
        rows = (await db.payment.findMany({ where: { workspaceId: ws }, orderBy: { createdAt: "desc" } })).map((p) => ({ id: p.id, kind: p.kind, direction: p.direction, amount: p.amount, payee: p.payee, status: p.status, due: p.dueAt, wire_verified: p.wireVerifiedAt, reference: p.reference, deal: p.opportunityId, created: p.createdAt }));
        break;
      case "tasks":
        rows = (await db.task.findMany({ where: { workspaceId: ws }, orderBy: { dueAt: "desc" }, take: 50000 })).map((t) => ({ id: t.id, title: t.title, kind: t.kind, status: t.status, due: t.dueAt, assignee: t.assignee, priority: t.priority, result: t.result }));
        break;
      case "title-companies":
        rows = (await db.titleCompany.findMany({ where: { workspaceId: ws } })).map((t) => ({ ...t, contacts: t.contacts ? JSON.stringify(t.contacts) : "" }));
        break;
      case "audit":
        rows = (await db.auditEvent.findMany({ where: { workspaceId: ws }, orderBy: { createdAt: "desc" }, take: 50000 })).map((a) => ({ when: a.createdAt, actor: a.actor, action: a.action, entity: a.entityType, entity_id: a.entityId, before: a.before, after: a.after, meta: a.meta }));
        break;
      default:
        return new Response("Unknown table", { status: 404 });
    }
    const name = `${table}-${new Date().toISOString().slice(0, 10)}.csv`;
    return new Response("﻿" + csv(rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"` } });
  } catch (e) {
    return errorResponse(e);
  }
}
