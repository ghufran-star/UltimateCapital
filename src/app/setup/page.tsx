import { redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/client";
import { Field } from "@/components/ui";
import { hasAnyUser } from "@/lib/session";
import { setupAction } from "../actions/auth";
import AuthCard from "../auth-card";

export const dynamic = "force-dynamic";

export default async function Setup() {
  if (!process.env.DATABASE_URL) {
    return (
      <AuthCard title="Connect the database" sub="One step in Railway first.">
        <p className="text-sm">
          Add a PostgreSQL database to the project, then on this service set <code>DATABASE_URL</code> to <code>{"${{Postgres.DATABASE_URL}}"}</code> and reload.
        </p>
      </AuthCard>
    );
  }
  if (await hasAnyUser()) redirect("/login");
  return (
    <AuthCard title="Create the owner account" sub="You'll control the business, rules, State Packs, team and API keys.">
      <ActionForm action={setupAction}>
        <Field label="Your name"><input name="name" className="field" autoComplete="name" required /></Field>
        <Field label="Email"><input name="email" type="email" className="field" autoComplete="email" required /></Field>
        <Field label="Mobile (for warm transfers and click-to-call)"><input name="phone" className="field" placeholder="+1 713 555 0100" /></Field>
        <Field label="Company name"><input name="company" className="field" defaultValue="UltimateCapital" /></Field>
        <Field label="Password (8+ characters)"><input name="password" type="password" className="field" autoComplete="new-password" required /></Field>
        <Submit className="btn btn-primary w-full">Create account</Submit>
      </ActionForm>
    </AuthCard>
  );
}
