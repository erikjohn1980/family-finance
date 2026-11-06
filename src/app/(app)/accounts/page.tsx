import Link from "next/link";
import { AccountForm } from "@/components/account-form";
import { AccountList, NoAccounts } from "@/components/account-list";
import { FilterBar } from "@/components/filter-bar";
import { Card, Empty, PageHead, Pill } from "@/components/ui";
import { accountInScope } from "@/lib/calc/ledger";
import { freshness } from "@/lib/calc/planning";
import { getProviderAdapter } from "@/lib/adapters/types";
import { balanceAccounts } from "@/lib/data/overview";
import { getDb } from "@/db";
import { BUSINESS_UNITS, cueFlowAuthorized } from "@/lib/policy";
import { ledgerFor, pageMember, resolveFilters, SCOPE_LABEL } from "@/lib/page";

export const metadata = { title: "Cards & bank" };

export default async function Accounts({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pageMember();
  const f = await resolveFilters(ctx.userId, await searchParams);
  const data = await ledgerFor(ctx.householdId);
  const health = await getProviderAdapter().health();
  const accounts = data.accounts.filter((a) => accountInScope(a, f.scope));
  const bal = new Map((await balanceAccounts(getDb(), ctx.householdId, accounts)).map((b) => [b.id, b]));
  const household = accounts.filter((a) => a.scope === "household");
  const trust = accounts.filter((a) => a.scope === "trust");
  const business = accounts.filter((a) => a.scope === "business");
  const stale = accounts.filter((a) => freshness(a.balanceAsOf, a.staleAfterHours) === "stale").length;

  return (
    <>
      <PageHead title="Cards & bank" sub={`${SCOPE_LABEL[f.scope]} · ${accounts.length} accounts${stale ? ` · ${stale} stale` : ""}`}>
        <FilterBar month={f.month} scope={f.scope} showMonth={false} />
      </PageHead>
      <Card title="Data sources">
        <div className="form-actions">
          <Pill tone="ok">CSV import: available</Pill>
          <Pill tone="plan">Bank data provider: {health.status === "not_configured" ? "not configured" : health.status}</Pill>
          <Link className="btn btn-sm" href="/settings#import">
            Import CSV
          </Link>
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          Access is read-only. This app never moves money, pays bills, issues refunds, or changes bank settings. {health.message}
        </p>
      </Card>
      {f.scope !== "business" && f.scope !== "trust" ? (
        <Card title="Household">
          <AccountList accounts={household} balances={bal} empty={<NoAccounts what="household accounts" />} />
        </Card>
      ) : null}
      {f.scope === "business" || f.scope === "all" || (f.scope === "default" && business.length) ? (
        <Card title="Business">
          {BUSINESS_UNITS.map((u) => {
            const list = business.filter((a) => a.businessUnit === u);
            return (
              <div key={u} style={{ marginBottom: 14 }}>
                <h3 style={{ marginBottom: 6 }}>
                  {u} {u === "Cue Flow" && !cueFlowAuthorized() ? <Pill tone="plan">Unread until owner authorizes</Pill> : null}
                </h3>
                <AccountList accounts={list} balances={bal} empty={<Empty title={`No ${u} accounts`}>Section intentionally empty. No revenue is assumed.</Empty>} />
              </div>
            );
          })}
          {business.some((a) => !a.businessUnit || !BUSINESS_UNITS.includes(a.businessUnit as (typeof BUSINESS_UNITS)[number])) ? (
            <>
              <h3 style={{ marginBottom: 6 }}>Other business</h3>
              <AccountList accounts={business.filter((a) => !a.businessUnit || !BUSINESS_UNITS.includes(a.businessUnit as (typeof BUSINESS_UNITS)[number]))} balances={bal} empty={null} />
            </>
          ) : null}
        </Card>
      ) : null}
      {f.scope === "trust" || f.scope === "all" ? (
        <Card title="Trust">
          <AccountList accounts={trust} balances={bal} empty={<NoAccounts what="trust accounts" />} />
        </Card>
      ) : null}
      <Card title="Add account">
        <AccountForm />
      </Card>
    </>
  );
}
