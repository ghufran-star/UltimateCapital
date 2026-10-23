import { audit, json, notify } from "./audit";
import { claudeJson } from "./claude";
import { db } from "./db";
import { emit } from "./engine";
import { activeRuleSet } from "./valuation";

// Repair estimate from photos: Claude looks at the deal's photos and rates each item in your repair
// playbook. It fills items the seller hasn't described and notes where the photos disagree.

const VISION = /^image\/(png|jpe?g|gif|webp)$/;

export async function repairsFromPhotos(ws: string, opportunityId: string) {
  const opp = await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, include: { property: true } });
  const files = await db.fileObject.findMany({ where: { workspaceId: ws, entityType: "opportunity", entityId: opportunityId, kind: "photo" }, orderBy: { createdAt: "desc" }, take: 20 });
  let budget = 18 * 1024 * 1024;
  const photos = files.filter((f) => VISION.test(f.mime)).filter((f) => (budget -= f.size) >= 0).slice(0, 10);
  if (!photos.length) return "No photos Claude can read (JPEG, PNG, GIF or WebP)";
  const rs = await activeRuleSet(ws);
  const items = rs.data.playbook.map((i) => `${i.key} (${i.label})`).join(", ");
  const out = await claudeJson<{ items: { item: string; tier: "none" | "cosmetic" | "moderate" | "heavy" | "gut"; seen: string; confidence: number }[]; overall: "cosmetic" | "moderate" | "heavy" | "gut"; notes: string }>(ws, {
    kind: "analysis",
    documents: photos.map((p) => ({ mime: p.mime, data: Buffer.from(p.data).toString("base64"), name: p.name })),
    prompt: `These are photos of ${opp.property.address} (${opp.property.beds ?? "?"} bd, ${opp.property.baths ?? "?"} ba, ${opp.property.sqft ?? "?"} sq ft, built ${opp.property.yearBuilt ?? "?"}).
Rate each repair item you can actually see on: none (fine), cosmetic, moderate, heavy, gut (replace). Items: ${items}.
Only rate items visible in the photos; say what you saw. Confidence 0-1. Give an overall condition tier.`,
    schema: {
      type: "object",
      properties: {
        items: { type: "array", items: { type: "object", properties: { item: { type: "string" }, tier: { type: "string", enum: ["none", "cosmetic", "moderate", "heavy", "gut"] }, seen: { type: "string" }, confidence: { type: "number" } }, required: ["item", "tier", "seen", "confidence"] } },
        overall: { type: "string", enum: ["cosmetic", "moderate", "heavy", "gut"] },
        notes: { type: "string" },
      },
      required: ["items", "overall", "notes"],
    },
  });
  const cond = ((opp.property.condition || {}) as { items?: Record<string, { tier: string; reason?: string; source?: string }> }) || {};
  const current = { ...(cond.items || {}) };
  const keys = new Set(rs.data.playbook.map((i) => i.key));
  const disagree: string[] = [];
  let filled = 0;
  for (const r of out.items.filter((x) => keys.has(x.item) && x.confidence >= 0.5)) {
    const had = current[r.item];
    if (!had) {
      current[r.item] = { tier: r.tier, reason: `Photos: ${r.seen}`, source: "photos" };
      filled++;
    } else if (had.tier !== r.tier && had.source !== "photos") disagree.push(`${r.item}: seller/notes say ${had.tier}, photos look ${r.tier} (${r.seen})`);
    else if (had.source === "photos") current[r.item] = { tier: r.tier, reason: `Photos: ${r.seen}`, source: "photos" };
  }
  await db.property.update({ where: { id: opp.propertyId }, data: { condition: json({ ...cond, items: current, photoNotes: out.notes }), conditionTier: opp.property.conditionTier || out.overall } });
  await audit(ws, "agent:photos", "repairs_from_photos", { type: "opportunity", id: opportunityId }, { meta: { photos: photos.length, filled, disagree } });
  if (disagree.length) await notify(ws, "Photos disagree with what we were told", `${opp.property.address}: ${disagree.join("; ")}`, `/deals/${opportunityId}?tab=numbers`);
  await emit(ws, "property.changed", { type: "property", id: opp.propertyId });
  return `Rated ${out.items.length} items from ${photos.length} photos (${filled} new${disagree.length ? `, ${disagree.length} disagree` : ""})`;
}
