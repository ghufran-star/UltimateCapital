"use server";

import { headers } from "next/headers";
import type { ActionState } from "@/components/client";
import { submitLeadForm } from "@/lib/leadform";

export async function leadFormAction(_: ActionState, fd: FormData): Promise<ActionState> {
  // Bots fill the hidden field or submit instantly; people don't.
  if (String(fd.get("website") || "") || Date.now() - Number(fd.get("t") || 0) < 2500) return { ok: true, message: "Thanks! We'll be in touch shortly." };
  const s = (k: string) => String(fd.get(k) || "").trim().slice(0, 200);
  const h = await headers();
  try {
    const r = await submitLeadForm(s("ws"), {
      firstName: s("firstName"),
      lastName: s("lastName"),
      phone: s("phone"),
      email: s("email"),
      address: s("address"),
      city: s("city"),
      state: s("state").toUpperCase().slice(0, 2),
      zip: s("zip").replace(/\D/g, "").slice(0, 5),
      askingPrice: Math.round(Number(s("askingPrice").replace(/[$,\s]/g, ""))) || null,
      timeline: s("timeline"),
      condition: s("condition"),
      consent: fd.get("consent") === "on",
      page: s("page") || h.get("referer") || "",
      ip: (h.get("x-forwarded-for") || "").split(",")[0].trim(),
      userAgent: h.get("user-agent") || "",
    });
    return { ok: true, message: `Thanks! ${r.company} will be in touch shortly with your offer.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Something went wrong. Please try again." };
  }
}
