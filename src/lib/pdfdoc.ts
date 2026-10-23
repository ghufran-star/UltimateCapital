import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

// Your attorney's PDF as the contract: fields typed onto the page and signatures drawn into the
// boxes placed in Settings → Contract templates. Coordinates are PDF points, origin bottom-left.

export type Placement = { id: string; page: number; x: number; y: number; w: number; h: number; kind: "field" | "sign" | "initial" | "date_signed"; key?: string; role?: string };
type Signer = { role: string; name: string; signature: string | null; initials: string | null; signedAt: Date | null };

const ascii = (s: string) => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-").replace(/[^\x20-\x7E]/g, "");

export async function fillPdf(pdf: Uint8Array, placements: Placement[], fields: Record<string, string>) {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  for (const p of placements.filter((x) => x.kind === "field")) {
    const page = pages[p.page];
    if (!page) continue;
    const text = ascii(fields[p.key || ""] ?? "");
    if (!text) continue;
    let size = Math.min(11, p.h - 2);
    while (size > 5 && font.widthOfTextAtSize(text, size) > p.w - 4) size -= 0.5;
    page.drawText(text, { x: p.x + 2, y: p.y + (p.h - size) / 2 + 1, size, font, color: rgb(0.05, 0.05, 0.3) });
  }
  return Buffer.from(await doc.save());
}

export async function signPdf(pdf: Uint8Array, placements: Placement[], signers: Signer[]) {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.HelveticaOblique);
  const plain = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  for (const p of placements.filter((x) => x.kind !== "field")) {
    const page = pages[p.page];
    const s = signers.find((x) => x.role === p.role);
    if (!page || !s?.signedAt) continue;
    if (p.kind === "date_signed") {
      page.drawText(s.signedAt.toISOString().slice(0, 10), { x: p.x + 2, y: p.y + (p.h - 10) / 2, size: 10, font: plain, color: rgb(0.05, 0.05, 0.3) });
      continue;
    }
    if (p.kind === "initial") {
      const t = ascii(s.initials || s.name.split(" ").map((w) => w[0]).join(""));
      page.drawText(t, { x: p.x + 2, y: p.y + (p.h - 11) / 2, size: Math.min(14, p.h - 2), font, color: rgb(0.05, 0.05, 0.3) });
      continue;
    }
    if (s.signature?.startsWith("data:image/png;base64,")) {
      const img = await doc.embedPng(Buffer.from(s.signature.split(",")[1], "base64"));
      const scale = Math.min(p.w / img.width, p.h / img.height);
      page.drawImage(img, { x: p.x, y: p.y, width: img.width * scale, height: img.height * scale });
    } else if (s.signature) {
      const t = ascii(s.signature.replace(/^typed:/, ""));
      let size = Math.min(18, p.h - 2);
      while (size > 6 && font.widthOfTextAtSize(t, size) > p.w - 4) size -= 0.5;
      page.drawText(t, { x: p.x + 2, y: p.y + (p.h - size) / 2, size, font, color: rgb(0.05, 0.05, 0.3) });
    }
  }
  return Buffer.from(await doc.save());
}

export async function pageCount(pdf: Uint8Array) {
  return (await PDFDocument.load(pdf, { ignoreEncryption: true })).getPageCount();
}
