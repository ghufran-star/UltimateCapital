import { redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/client";
import { Field } from "@/components/ui";
import { getCtx, hasAnyUser } from "@/lib/session";
import { loginAction } from "../actions/auth";
import AuthCard from "../auth-card";

export const dynamic = "force-dynamic";

export default async function Login() {
  if (!process.env.DATABASE_URL || !(await hasAnyUser())) redirect("/setup");
  if (await getCtx()) redirect("/");
  return (
    <AuthCard title="Sign in">
      <ActionForm action={loginAction}>
        <Field label="Email"><input name="email" type="email" className="field" autoComplete="email" required /></Field>
        <Field label="Password"><input name="password" type="password" className="field" autoComplete="current-password" required /></Field>
        <Submit className="btn btn-primary w-full">Sign in</Submit>
      </ActionForm>
    </AuthCard>
  );
}
