import { AccountForm } from "@/components/account-form";
import { AccountList, NoAccounts } from "@/components/account-list";
import { Card, Money, PageHead } from "@/components/ui";
import { FilterBar } from "@/components/filter-bar";
import { accountInScope } from "@/lib/calc/ledger";
import { ledgerFor, pageMember, resolveFilters } from "@/lib/page";

export const metadata = { title: "Investments" };

export default async function Investments({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pageMember();
  const f = await resolveFilters(ctx.userId, await searchParams);
  const data = await ledgerFor(ctx.householdId);
  const accts = data.accounts.filter((a) => (a.kind === "brokerage" || a.kind === "retirement") && accountInScope(a, f.scope));
  const reported = accts.filter((a) => a.balanceCents !== null);
  return (
    <>
      <PageHead title="Investments" sub="Retirement and brokerage balances: imported or owner-entered, each with an as-of date. No market prices are fetched or estimated.">
        <FilterBar month={f.month} scope={f.scope} showMonth={false} />
      </PageHead>
      <Card title="Reported value">
        <div className="kpi-value">
          <Money cents={reported.reduce((s, a) => s + (a.balanceCents ?? 0), 0)} />
        </div>
        <p className="kpi-sub">
          {reported.length} of {accts.length} accounts reported{reported.length ? ` · oldest as of ${reported.map((a) => a.balanceAsOf?.toISOString().slice(0, 10) ?? "—").sort()[0]}` : ""}
        </p>
      </Card>
      <Card title="Accounts">
        <AccountList accounts={accts} empty={<NoAccounts what="investment accounts" />} allowedKinds={["brokerage", "retirement"]} />
      </Card>
      <Card title="Add investment account">
        <AccountForm defaultKind="brokerage" allowedKinds={["brokerage", "retirement"]} />
      </Card>
    </>
  );
}
