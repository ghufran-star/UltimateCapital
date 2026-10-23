import { ActionForm, Submit } from "@/components/client";
import { Card, Field, PageHeader } from "@/components/ui";
import { pageCtx } from "@/lib/session";
import { profileAction } from "../../../actions/auth";

export default async function Profile() {
  const c = await pageCtx();
  return (
    <div className="max-w-xl space-y-5">
      <PageHeader back={{ href: "/settings", label: "Settings" }} title="My profile" />
      <Card>
        <ActionForm action={profileAction}>
          <Field label="Name">
            <input name="name" defaultValue={c.user.name} className="field" />
          </Field>
          <Field label="Your mobile" hint="When you press Call, we ring this phone first and then connect you. Warm transfers from AI agents also come here.">
            <input name="phone" defaultValue={c.user.phone ?? ""} className="field" type="tel" />
          </Field>
          <Field label="Current password">
            <input name="currentPassword" type="password" className="field" autoComplete="current-password" />
          </Field>
          <Field label="New password">
            <input name="newPassword" type="password" className="field" autoComplete="new-password" />
          </Field>
          <Submit>Save</Submit>
        </ActionForm>
      </Card>
    </div>
  );
}
