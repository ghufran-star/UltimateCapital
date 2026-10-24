import { redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/client";
import { Field } from "@/components/ui";
import { getCtx, hasAnyUser } from "@/lib/session";
import { loginAction, tryDemoAction } from "../actions/auth";
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
      {process.env.DEMO_PUBLIC !== "off" && (
        <div className="mt-5 border-t border-line pt-5 text-center">
          <ActionForm action={tryDemoAction}>
            <Submit className="btn btn-ghost w-full" pendingText="Opening the demo…">
              Try the demo
            </Submit>
          </ActionForm>
          <p className="mt-2 text-xs text-muted">A sample wholesaling business with its own demo profile. Every connection is pretend: calls, texts, email and AI all work, and nothing reaches a real person.</p>
        </div>
      )}
    </AuthCard>
  );
}
