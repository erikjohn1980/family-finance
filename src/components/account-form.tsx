import type { FinAccount } from "@/db/schema";
import { centsToDecimalString } from "@/lib/money";
import { BUSINESS_UNITS } from "@/lib/policy";
import { ActionForm, Submit } from "./forms";
import { saveAccount } from "@/app/actions";

const KINDS: [string, string][] = [
  ["checking", "Checking"],
  ["savings", "Savings"],
  ["credit_card", "Credit card (liability)"],
  ["loan", "Loan (liability)"],
  ["brokerage", "Brokerage"],
  ["retirement", "Retirement"],
  ["real_estate", "Real estate"],
  ["vehicle", "Vehicle"],
  ["other_asset", "Other asset"],
];

export function AccountForm({ account, defaultKind = "checking", allowedKinds }: { account?: FinAccount; defaultKind?: string; allowedKinds?: string[] }) {
  const kinds = allowedKinds ? KINDS.filter(([k]) => allowedKinds.includes(k)) : KINDS;
  return (
    <ActionForm action={saveAccount} resetOnSuccess={!account} aria-label={account ? `Edit ${account.name}` : "Add account"}>
      {account ? <input type="hidden" name="id" value={account.id} /> : null}
      <div className="form-grid">
        <label>
          Name
          <input name="name" required maxLength={80} defaultValue={account?.name ?? ""} />
        </label>
        <label>
          Kind
          <select name="kind" defaultValue={account?.kind ?? defaultKind}>
            {kinds.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Last 4 (optional)
          <input name="maskLast4" inputMode="numeric" maxLength={4} pattern="\d{0,4}" defaultValue={account?.maskLast4 ?? ""} />
        </label>
        <label>
          Scope
          <select name="scope" defaultValue={account?.scope ?? "household"}>
            <option value="household">Household</option>
            <option value="business">Business</option>
            <option value="trust">Trust</option>
          </select>
        </label>
        <label>
          Business unit
          <select name="businessUnit" defaultValue={account?.businessUnit ?? ""}>
            <option value="">—</option>
            {BUSINESS_UNITS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <label>
          Balance (owner-entered){" "}
          <input name="balance" inputMode="decimal" placeholder="leave blank to keep" defaultValue={account?.balanceCents != null ? centsToDecimalString(account.balanceCents) : ""} />
        </label>
        <label>
          Available balance (sweep accounts)
          <input name="available" inputMode="decimal" defaultValue={account?.availableBalanceCents != null ? centsToDecimalString(account.availableBalanceCents) : ""} />
        </label>
        <label>
          Balance as of
          <input type="date" name="asOf" defaultValue={account?.balanceAsOf ? account.balanceAsOf.toISOString().slice(0, 10) : ""} />
        </label>
        <label>
          Stale after (hours)
          <input name="staleAfterHours" type="number" min={1} max={2160} defaultValue={account?.staleAfterHours ?? 72} />
        </label>
      </div>
      <div className="form-actions" style={{ marginTop: 10 }}>
        <label className="inline small">
          <input type="checkbox" name="isSweep" defaultChecked={account?.isSweep} /> Sweep checking (apply sweep cash rule)
        </label>
        <label className="inline small">
          <input type="checkbox" name="includeInHouseholdOverview" defaultChecked={account?.includeInHouseholdOverview} /> Business cash included in household overview
        </label>
      </div>
      <p className="small muted" style={{ marginTop: 6 }}>
        Liability balances are stored as positive amounts and subtracted from net worth. Full account numbers are never stored.
      </p>
      <div className="form-actions" style={{ marginTop: 10 }}>
        <Submit>{account ? "Save account" : "Add account"}</Submit>
      </div>
    </ActionForm>
  );
}
