import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { can, pageCtx } from "@/lib/session";
import { TitleProfileForm } from "../form";

export default async function NewTitleCompany() {
  const c = await pageCtx();
  const ro = !can(c.role, "closing");
  return (
    <div className="max-w-5xl space-y-5">
      <PageHeader back={{ href: "/closing/title", label: "Title companies" }} title="Add a title company" sub={<>Or pick a licensed agency from the <Link href="/closing/title/directory" className="underline">free state directory</Link> to start with its licence details filled in.</>} />
      <Card>
        <TitleProfileForm ro={ro} />
      </Card>
    </div>
  );
}
