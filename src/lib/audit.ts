import { Prisma } from "@prisma/client";
import { db } from "./db";

export const json = (v: unknown) => v as Prisma.InputJsonValue;

/** Append-only audit trail: who did what, to which record, before and after. */
export async function audit(
  workspaceId: string,
  actor: string,
  action: string,
  entity?: { type: string; id: string },
  change?: { before?: unknown; after?: unknown; meta?: unknown }
) {
  await db.auditEvent
    .create({
      data: {
        workspaceId,
        actor,
        action,
        entityType: entity?.type,
        entityId: entity?.id,
        before: change?.before === undefined ? undefined : json(change.before),
        after: change?.after === undefined ? undefined : json(change.after),
        meta: change?.meta === undefined ? undefined : json(change.meta),
      },
    })
    .catch((e) => console.error("[audit]", e));
}

export async function notify(workspaceId: string, title: string, body: string, href?: string, userId?: string) {
  await db.notification.create({ data: { workspaceId, title, body, href, userId } }).catch(() => null);
  // Phone / desktop alerts for people who turned them on (never blocks the caller).
  void import("./push")
    .then((m) => m.pushNotification(workspaceId, { title, body, href, userId }))
    .catch((e) => console.error("[push]", e instanceof Error ? e.message : e));
}
