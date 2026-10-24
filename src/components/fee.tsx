import { ActionForm, Submit } from "@/components/client";
import { feeReceivedAction } from "../app/actions/deals";

/** The money arrived: amount + date, one button. */
export function FeeReceived({ opportunityId, expected, compact = false }: { opportunityId: string; expected?: number | null; compact?: boolean }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <ActionForm action={feeReceivedAction} className={compact ? "flex flex-wrap items-center gap-2" : "space-y-2"}>
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <div className={compact ? "flex flex-1 gap-2" : "grid grid-cols-2 gap-2"}>
        <input name="amount" defaultValue={expected ?? ""} inputMode="numeric" placeholder="Amount received" className="field tnum min-w-0" required />
        <input name="date" type="date" defaultValue={today} className="field min-w-0" />
      </div>
      <Submit className={`btn btn-primary ${compact ? "" : "w-full py-3"}`}>💰 Fee received</Submit>
    </ActionForm>
  );
}
