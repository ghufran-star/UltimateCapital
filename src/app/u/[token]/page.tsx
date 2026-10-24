import { ActionForm, Submit } from "@/components/client";
import { setting } from "@/lib/config";
import { db } from "@/lib/db";
import { readUnsubToken } from "@/lib/emails";
import { unsubscribeAction } from "../../actions/unsubscribe";

export const dynamic = "force-dynamic";
export const metadata = { title: "Unsubscribe", robots: { index: false } };

export default async function Unsubscribe({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const contactId = token === "preview" ? null : readUnsubToken(token);
  const c = contactId ? await db.contact.findUnique({ where: { id: contactId }, select: { workspaceId: true, email: true } }) : null;
  const company = c ? (await setting(c.workspaceId, "COMPANY_NAME")) || "us" : "us";
  const done = c?.email ? Boolean(await db.suppression.findFirst({ where: { workspaceId: c.workspaceId, kind: "email", value: c.email.toLowerCase() } })) : false;
  return (
    <main className="mx-auto min-h-dvh max-w-md px-4 py-12">
      {token === "preview" ? (
        <p className="text-muted">This is where people unsubscribe. Real emails carry a personal link.</p>
      ) : !c ? (
        <>
          <h1 className="text-xl font-semibold">This link isn&apos;t valid</h1>
          <p className="mt-2 text-muted">Reply to the email and ask to be removed, and we will.</p>
        </>
      ) : done ? (
        <>
          <h1 className="text-xl font-semibold">You&apos;re unsubscribed</h1>
          <p className="mt-2 text-muted">You won&apos;t get marketing emails from {company} at {c.email} any more.</p>
        </>
      ) : (
        <div className="card p-5">
          <h1 className="text-xl font-semibold">Unsubscribe from {company}?</h1>
          <p className="mt-2 text-sm text-muted">We&apos;ll stop sending marketing emails to {c.email}.</p>
          <ActionForm action={unsubscribeAction} className="mt-4">
            <input type="hidden" name="token" value={token} />
            <Submit pendingText="Unsubscribing…">Unsubscribe</Submit>
          </ActionForm>
        </div>
      )}
    </main>
  );
}
