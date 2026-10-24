import type { Campaign } from "@prisma/client";

/** Where an imported list goes: a new campaign (ready to start), an existing one, or nowhere yet. */
export function CampaignChoice({ campaigns, cold }: { campaigns: Pick<Campaign, "id" | "name">[]; cold: boolean }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Then</legend>
      <label className="flex items-start gap-2 text-sm">
        <input type="radio" name="campaignMode" value="new" defaultChecked className="mt-1" />
        <span>
          Put them in a new campaign, ready to start
          <span className="block text-xs text-muted">{cold ? "AI calls, texts and email go out together (cold outreach mode is on)." : "AI calls where allowed, and your team's call list. Turn on cold outreach mode in Calling rules to text and email too."}</span>
        </span>
      </label>
      {campaigns.length > 0 && (
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <input type="radio" name="campaignMode" value="existing" />
          <span>Add to</span>
          <select name="campaignId" className="field w-auto max-w-full text-sm">
            {campaigns.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="radio" name="campaignMode" value="none" /> Just save them for now
      </label>
    </fieldset>
  );
}
