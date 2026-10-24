import type { Prisma } from "@prisma/client";

export const dealInclude = {
  property: { include: { ownerships: { include: { contact: true } } } },
  valuations: { orderBy: { createdAt: "desc" }, take: 1 },
  offers: { orderBy: { createdAt: "asc" }, omit: { pdf: true } },
  interests: { include: { contact: { include: { buyBoxes: true } } }, orderBy: [{ serious: "desc" }, { fitScore: "desc" }] },
  contracts: { include: { signers: { orderBy: { order: "asc" } } }, omit: { finalPdf: true, sourcePdf: true }, orderBy: { createdAt: "desc" } },
  transaction: { include: { titleCompany: true } },
} satisfies Prisma.OpportunityInclude;

export type Deal = Prisma.OpportunityGetPayload<{ include: typeof dealInclude }>;
