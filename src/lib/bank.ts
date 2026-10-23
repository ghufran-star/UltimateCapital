import { encrypt, decrypt, loadSettings } from "./config";
import { db } from "./db";
import { reconcileRows } from "./title";

// Bank feed: incoming deposits are pulled daily and matched to the fees you're owed, so deals mark
// themselves paid. Mercury is supported directly; any bank can still use the CSV upload on Closing.

export async function syncBank(ws: string) {
  const s = await loadSettings(ws);
  const provider = (s.BANK_PROVIDER || "").toLowerCase();
  if (!provider) return "No bank connected";
  if (provider !== "mercury") return `Bank provider "${provider}" isn't supported yet: use the CSV upload`;
  const headers = { authorization: `Bearer ${s.BANK_API_KEY}`, accept: "application/json" };
  const get = async (path: string) => {
    const res = await fetch(`https://api.mercury.com/api/v1${path}`, { headers, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Mercury ${res.status}: ${(await res.text()).slice(0, 160)}`);
    return res.json() as Promise<Record<string, unknown>>;
  };
  const start = new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10);
  const accounts = ((await get("/accounts")).accounts || []) as { id: string }[];
  const rows: { amount: number; description: string }[] = [];
  const seenKey = "BANK_SEEN";
  const seenRow = await db.setting.findUnique({ where: { workspaceId_key: { workspaceId: ws, key: seenKey } } });
  const seen = new Set<string>(seenRow ? (JSON.parse(decrypt(seenRow.value) || "[]") as string[]) : []);
  for (const a of accounts) {
    const txs = ((await get(`/account/${a.id}/transactions?start=${start}&limit=500`)).transactions || []) as { id: string; amount: number; counterpartyName?: string; bankDescription?: string; status?: string }[];
    for (const t of txs) {
      if (seen.has(t.id) || t.amount <= 0 || (t.status && !["sent", "posted", "completed"].includes(String(t.status).toLowerCase()))) continue;
      seen.add(t.id);
      rows.push({ amount: Math.round(t.amount), description: `${t.counterpartyName || ""} ${t.bankDescription || ""} (Mercury ${t.id})`.trim() });
    }
  }
  const value = encrypt(JSON.stringify([...seen].slice(-2000)));
  await db.setting.upsert({ where: { workspaceId_key: { workspaceId: ws, key: seenKey } }, create: { workspaceId: ws, key: seenKey, value }, update: { value } });
  const r = await reconcileRows(ws, rows, "agent:bank");
  return `${r.rows} new deposits, ${r.matched} matched to fees`;
}
