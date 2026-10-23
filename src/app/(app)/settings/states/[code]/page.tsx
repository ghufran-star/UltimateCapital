import { notFound } from "next/navigation";
import { ActionButton, ActionForm, Submit } from "@/components/client";
import { Card, Field, Notice, PageHeader, StatusBadge } from "@/components/ui";
import { db } from "@/lib/db";
import { can, pageCtx } from "@/lib/session";
import { draftPack, PACK_STATUS_LABEL, stateName, type PackStatus, type StatePackData } from "@/lib/states";
import { fmtDate } from "@/lib/util";
import { saveStatePackAction, statePackStatusAction } from "../../../../actions/settings";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function StatePackPage({ params }: { params: Promise<{ code: string }> }) {
  const c = await pageCtx();
  const { code } = await params;
  const pack = await db.statePack.findUnique({ where: { workspaceId_state: { workspaceId: c.workspace.id, state: code.toUpperCase() } } });
  if (!pack) notFound();
  const base = draftPack(pack.state);
  const raw = pack.data as unknown as Partial<StatePackData>;
  const d: StatePackData = { ...base, ...raw, wholesaling: { ...base.wholesaling, ...raw.wholesaling }, contracts: { ...base.contracts, ...raw.contracts }, closing: { ...base.closing, ...raw.closing }, outreach: { ...base.outreach, ...raw.outreach }, sellerProtections: { ...base.sellerProtections, ...raw.sellerProtections } };
  const ro = c.workspace.isDemo || !can(c.role, "states");
  const isOwner = c.role === "owner";
  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader
        back={{ href: "/settings/states", label: "States" }}
        title={`${stateName(pack.state)} State Pack`}
        sub={
          <span className="flex items-center gap-2">
            <StatusBadge s={pack.status} /> {PACK_STATUS_LABEL[pack.status as PackStatus]} · v{pack.version}
            {pack.approvedAt && ` · activated ${fmtDate(pack.approvedAt)}`}
          </span>
        }
      />
      {pack.status !== "active" && <Notice>Outreach, campaigns and AI calls in {pack.state} are blocked until the owner activates this pack. Saving changes to an active pack sends it back to review.</Notice>}
      <ActionForm action={saveStatePackAction} className="space-y-5">
        <input type="hidden" name="state" value={pack.state} />
        <Card title="Wholesaling">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Marketing before a signed contract">
              <select name="marketingBeforeContract" defaultValue={d.wholesaling.marketingBeforeContract} className="field">
                <option value="anonymous_only">Anonymous demand check only (no address, no offer)</option>
                <option value="allowed">Allowed</option>
                <option value="prohibited">Not allowed</option>
              </select>
            </Field>
            <Field label="Marketing after contract">
              <select name="marketingAfterContract" defaultValue={d.wholesaling.marketingAfterContract} className="field">
                <option value="with_disclosure">Allowed with disclosure</option>
                <option value="allowed">Allowed</option>
                <option value="prohibited">Not allowed</option>
              </select>
            </Field>
            <div className="md:col-span-2">
              <Field label="Disclosure text (used in buyer marketing and contracts)">
                <textarea name="disclosureText" defaultValue={d.wholesaling.disclosureText} rows={3} className="field" />
              </Field>
            </div>
            <Field label="Licence notes">
              <textarea name="licenseNotes" defaultValue={d.wholesaling.licenseNotes} rows={2} className="field" />
            </Field>
            <Field label="Max deals / year without licence">
              <input name="maxDealsPerYearUnlicensed" defaultValue={d.wholesaling.maxDealsPerYearUnlicensed ?? ""} className="field" />
            </Field>
          </div>
        </Card>
        <Card title="Contracts & closing">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Option period (days)">
              <input name="optionPeriodDays" defaultValue={d.contracts.optionPeriodDays ?? ""} className="field" />
            </Field>
            <Field label="Earnest money due (days)">
              <input name="emdDueDays" defaultValue={d.contracts.emdDueDays} className="field" />
            </Field>
            <Field label="Typical earnest money $">
              <input name="typicalEmd" defaultValue={d.contracts.typicalEmd ?? ""} className="field" />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="assignmentAllowed" defaultChecked={d.contracts.assignmentAllowed} /> Assignment allowed
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="attorneyState" defaultChecked={d.closing.attorneyState} /> Attorney closing state
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="ronAllowed" defaultChecked={d.closing.ronAllowed} /> Remote online notary allowed
            </label>
            <Field label="Seller cancellation right (days)">
              <input name="cancellationDays" defaultValue={d.sellerProtections.cancellationDays ?? ""} className="field" />
            </Field>
            <div className="md:col-span-2">
              <Field label="Required seller notices">
                <input name="notices" defaultValue={d.sellerProtections.notices} className="field" />
              </Field>
            </div>
            <div className="md:col-span-3">
              <Field label="Contract notes">
                <textarea name="contractNotes" defaultValue={d.contracts.notes} rows={2} className="field" />
              </Field>
            </div>
            <div className="md:col-span-3">
              <Field label="Closing notes">
                <textarea name="closingNotes" defaultValue={d.closing.notes} rows={2} className="field" />
              </Field>
            </div>
          </div>
        </Card>
        <Card title="Outreach">
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Time zone">
              <input name="timezone" defaultValue={d.timezone} className="field" />
            </Field>
            <Field label="Calls from">
              <input name="callStart" type="time" defaultValue={d.outreach.callStart} className="field" />
            </Field>
            <Field label="Calls until">
              <input name="callEnd" type="time" defaultValue={d.outreach.callEnd} className="field" />
            </Field>
            <Field label="Max calls / day / person">
              <input name="maxCallsPerDayPerContact" defaultValue={d.outreach.maxCallsPerDayPerContact} className="field" />
            </Field>
            <Field label="Texts from">
              <input name="textStart" type="time" defaultValue={d.outreach.textStart} className="field" />
            </Field>
            <Field label="Texts until">
              <input name="textEnd" type="time" defaultValue={d.outreach.textEnd} className="field" />
            </Field>
            <div className="md:col-span-2">
              <span className="text-sm font-medium">Days</span>
              <div className="mt-2 flex flex-wrap gap-3 text-sm">
                {DAYS.map((x) => (
                  <label key={x} className="flex items-center gap-1">
                    <input type="checkbox" name="callDays" value={x} defaultChecked={d.outreach.callDays.includes(x)} /> {x}
                  </label>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm md:col-span-2">
              <input type="checkbox" name="requireConsentAiVoice" defaultChecked={d.outreach.requireConsentAiVoice} /> Require prior consent for AI voice calls
            </label>
            <label className="flex items-center gap-2 text-sm md:col-span-2">
              <input type="checkbox" name="requireConsentSms" defaultChecked={d.outreach.requireConsentSms} /> Require prior consent for texts
            </label>
            <label className="flex items-center gap-2 text-sm md:col-span-4">
              <input type="checkbox" name="stateDncList" defaultChecked={d.outreach.stateDncList} /> State has its own DNC list (import it in Compliance)
            </label>
            <div className="md:col-span-4">
              <Field label="AI disclosure (said at the start of AI calls)">
                <input name="aiDisclosure" defaultValue={d.outreach.aiDisclosure} className="field" />
              </Field>
            </div>
            <div className="md:col-span-4">
              <Field label="Identification line">
                <input name="identification" defaultValue={d.outreach.identification} className="field" />
              </Field>
            </div>
            <div className="md:col-span-4">
              <Field label="Outreach notes (given to agents)">
                <textarea name="outreachNotes" defaultValue={d.outreach.notes} rows={2} className="field" />
              </Field>
            </div>
          </div>
        </Card>
        <Card title="Sources">
          <textarea name="sources" defaultValue={d.sources.join("\n")} rows={3} className="field" placeholder="One statute / attorney memo / URL per line" />
        </Card>
        {!ro && <Submit>Save pack</Submit>}
      </ActionForm>
      {!ro && (
        <Card title="Status">
          {pack.status !== "active" ? (
            isOwner ? (
              <ActionForm action={statePackStatusAction}>
                <input type="hidden" name="state" value={pack.state} />
                <input type="hidden" name="status" value="active" />
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="attest" className="mt-1" /> I confirm this pack has been reviewed by counsel for {stateName(pack.state)} and I authorise outreach under it.
                </label>
                <Submit>Activate {pack.state}</Submit>
              </ActionForm>
            ) : (
              <p className="text-sm text-muted">Only the owner can activate.</p>
            )
          ) : (
            <ActionButton action={statePackStatusAction} hidden={{ state: pack.state, status: "disabled" }} className="btn btn-danger" confirm={`Stop all outreach in ${pack.state}?`}>
              Disable {pack.state}
            </ActionButton>
          )}
        </Card>
      )}
    </div>
  );
}
