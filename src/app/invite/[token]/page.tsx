import { ActionForm, Submit } from "@/components/client";
import { Field } from "@/components/ui";
import { db } from "@/lib/db";
import { ROLE_LABELS, Role } from "@/lib/session";
import { registerAction } from "../../actions/auth";
import AuthCard from "../../auth-card";

export const dynamic = "force-dynamic";

export default async function Invite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await db.invite.findUnique({ where: { token }, include: { workspace: true } }).catch(() => null);
  if (!inv || inv.usedAt || inv.expiresAt < new Date()) {
    return (
      <AuthCard title="Invite not valid" sub="This link has expired or was already used. Ask for a new one.">
        <a href="/login" className="btn btn-ghost w-full">Sign in instead</a>
      </AuthCard>
    );
  }
  return (
    <AuthCard title={`Join ${inv.workspace.name}`} sub={`You're invited as ${ROLE_LABELS[inv.role as Role] || inv.role}.`}>
      <ActionForm action={registerAction}>
        <input type="hidden" name="token" value={token} />
        <Field label="Your name"><input name="name" className="field" required /></Field>
        <Field label="Email"><input name="email" type="email" className="field" defaultValue={inv.email || ""} readOnly={Boolean(inv.email)} required /></Field>
        <Field label="Mobile"><input name="phone" className="field" /></Field>
        <Field label="Password (8+ characters)" hint="Already have an account? Use its password."><input name="password" type="password" className="field" required /></Field>
        <Submit className="btn btn-primary w-full">Join</Submit>
      </ActionForm>
    </AuthCard>
  );
}
