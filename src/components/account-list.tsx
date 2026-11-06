import type { FinAccount } from "@/db/schema";
import { freshness, isLiability, type BalanceAccount } from "@/lib/calc/planning";
import { AccountForm } from "./account-form";
import { ActionForm, Submit } from "./forms";
import { Empty, FreshBadge, Money, Pill } from "./ui";
import { archiveAccount } from "@/app/actions";

const KIND_LABEL: Record<string, string> = {
  checking: "Checking",
  savings: "Savings",
  credit_card: "Credit card",
  loan: "Loan",
  brokerage: "Brokerage",
  retirement: "Retirement",
  real_estate: "Real estate",
  vehicle: "Vehicle",
  other_asset: "Other asset",
};

export function AccountList({ accounts, balances, empty, allowedKinds }: { accounts: FinAccount[]; balances?: Map<string, BalanceAccount>; empty: React.ReactNode; allowedKinds?: string[] }) {
  if (!accounts.length) return <>{empty}</>;
  return (
    <ul className="list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {accounts.map((a) => {
        const fr = freshness(a.balanceAsOf, a.staleAfterHours);
        const b = balances?.get(a.id);
        return (
          <li key={a.id} style={{ borderBottom: "1px solid var(--border)", padding: "10px 4px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ minWidth: 0 }}>
                <strong>{a.name}</strong>
                {a.maskLast4 ? <span className="muted"> ••{a.maskLast4}</span> : null}
                <div className="small muted">
                  {KIND_LABEL[a.kind]} · {a.scope}
                  {a.businessUnit ? ` · ${a.businessUnit}` : ""}
                  {a.isSweep ? " · sweep" : ""}
                  {a.includeInHouseholdOverview ? " · in household overview" : ""}
                  {a.balanceAsOf ? ` · as of ${a.balanceAsOf.toISOString().slice(0, 10)}` : ""}
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <FreshBadge freshness={fr} source={a.source} />
                {isLiability(a.kind) ? <Pill tone="late">Liability</Pill> : null}
                <span className="num" style={{ fontWeight: 700 }}>
                  {a.balanceCents === null ? <span className="muted">No balance</span> : <Money cents={isLiability(a.kind) ? -a.balanceCents : a.balanceCents} />}
                </span>
              </div>
            </div>
            {a.isSweep && b ? (
              <p className="small muted" style={{ marginTop: 4 }}>
                Reported cash = available <Money cents={a.availableBalanceCents} /> + sweep component <Money cents={b.sweepComponentCents ?? 0} />
              </p>
            ) : null}
            <details className="details">
              <summary className="small muted">Edit</summary>
              <div style={{ padding: "8px 0" }}>
                <AccountForm account={a} allowedKinds={allowedKinds} />
                <ActionForm action={archiveAccount}>
                  <input type="hidden" name="id" value={a.id} />
                  <Submit className="btn btn-sm btn-danger">{a.archived ? "Unarchive" : "Archive account"}</Submit>
                </ActionForm>
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

export function NoAccounts({ what }: { what: string }) {
  return <Empty title={`No ${what} yet`}>Add one below, or import a balances CSV in Settings.</Empty>;
}
