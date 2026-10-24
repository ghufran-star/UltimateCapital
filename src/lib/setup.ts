import { loadSettings } from "./config";
import { db } from "./db";

// The first-time setup checklist, in the order a new business needs it.

export type Step = { done: boolean; title: string; why: string; href: string };

export async function setupSteps(ws: string, userPhone: string | null): Promise<Step[]> {
  const s = await loadSettings(ws);
  const [packs, templates, numbers, sellers] = await Promise.all([
    db.statePack.count({ where: { workspaceId: ws, status: "active" } }),
    db.contractTemplate.findMany({ where: { workspaceId: ws, active: true }, select: { body: true } }),
    db.phoneNumber.count({ where: { workspaceId: ws } }),
    db.contact.count({ where: { workspaceId: ws, kind: "seller" } }),
  ]);
  return [
    { done: !!(s.COMPANY_NAME && s.PUBLIC_URL), title: "Name your business and app address", why: "Shown on offers and contracts; needed for signing links.", href: "/settings/integrations" },
    { done: !!(s.TWILIO_ACCOUNT_SID && s.TWILIO_AUTH_TOKEN), title: "Connect your phone line (Twilio)", why: "For texts and calls you make from the app.", href: "/settings/integrations" },
    { done: numbers > 0, title: "Add a phone number", why: "The number sellers see and call back.", href: "/settings/phones" },
    { done: !!userPhone, title: "Add your mobile", why: "So the AI can hand hot sellers to you.", href: "/settings/profile" },
    { done: !!s.RETELL_API_KEY, title: "Connect AI calling (Retell)", why: "Lets the AI agents call sellers and buyers.", href: "/settings/integrations" },
    { done: !!s.ANTHROPIC_API_KEY, title: "Connect the AI brain (Claude)", why: "Reads every conversation and saves the facts.", href: "/settings/integrations" },
    { done: !!(s.RESEND_API_KEY && s.EMAIL_FROM), title: "Connect email", why: "Sends offers, contracts and title emails.", href: "/settings/integrations" },
    { done: packs > 0, title: "Turn on a state", why: "Nothing is called or texted in a state until you turn it on.", href: "/settings/states" },
    { done: templates.length > 0 && !templates.some((t) => t.body.startsWith("SAMPLE ONLY")), title: "Add your attorney's contracts", why: "Replace the sample contracts.", href: "/settings/templates" },
    { done: sellers > 0, title: "Add your first sellers", why: "Import a list or pull one from your data provider.", href: "/properties/import" },
  ];
}
