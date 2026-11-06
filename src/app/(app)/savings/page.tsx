import { AccountForm } from "@/components/account-form";
import { AccountList, NoAccounts } from "@/components/account-list";
import { Card, Money, PageHead } from "@/components/ui";
import { accountInScope } from "@/lib/calc/ledger";
import { FilterBar } from "@/components/filter-bar";
import { ledgerFor, pageMember, resolveFilters } from "@/lib/page";

export const metadata = { title: "Savings" };

export default async function Savings({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pageMember();
  const f = await resolveFilters(ctx.userId, await searchParams);
  const data = await ledgerFor(ctx.householdId);
  const accts = data.accounts.filter((a) => a.kind === "savings" && accountInScope(a, f.scope));
  const total = accts.reduce((s, a) => s + (a.balanceCents ?? 0), 0);
  const missing = accts.filter((a) => a.balanceCents === null).length;
  return (
    <>
      <PageHead title="Savings" sub="Cash savings balances from import or owner entry. No projected growth is shown.">
        <FilterBar month={f.month} scope={f.scope} showMonth={false} />
      </PageHead>
      <Card title="Total savings">
        <div className="kpi-value">
          <Money cents={total} />
        </div>
        <p className="kpi-sub">{missing ? `${missing} account(s) have no balance yet and are not counted` : "Sum of reported balances"}</p>
      </Card>
      <Card title="Savings accounts">
        <AccountList accounts={accts} empty={<NoAccounts what="savings accounts" />} allowedKinds={["savings"]} />
      </Card>
      <Card title="Add savings account">
        <AccountForm defaultKind="savings" allowedKinds={["savings"]} />
      </Card>
    </>
  );
}
