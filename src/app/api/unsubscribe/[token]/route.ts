import { NextRequest } from "next/server";
import { readUnsubToken, unsubscribe } from "@/lib/emails";

export const dynamic = "force-dynamic";

/** One-click unsubscribe (RFC 8058): mail apps POST here from the List-Unsubscribe header. */
export async function POST(_: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const id = readUnsubToken((await params).token);
  if (id) await unsubscribe(id, "one-click");
  return new Response("Unsubscribed", { status: 200 });
}
