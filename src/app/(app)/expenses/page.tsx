import Link from "next/link";
import { FilterBar } from "@/components/filter-bar";
import { Pie } from "@/components/charts";
import { TxList } from "@/components/tx-list";
import { Card, Empty, Money, PageHead } from "@/components/ui";
import { inScope, spendByCategory, spendPending, spendPosted, type EffectiveLine } from "@/lib/calc/ledger";
import { monthLabel, monthRange } from "@/lib/dates";
import { ledgerFor, pageMember, resolveFilters } from "@/lib/page";

export const metadata = { title: "Expenses" };

function isSpend(l: EffectiveLine) {
  return l.categoryKind === "expense" || (l.categoryKind === null && l.amountCents < 0);
}

export default async function Expenses({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pageMember();
  const sp = await searchParams;
  const f = await resolveFilters(ctx.userId, sp);
  const showPending = sp.pending === "1";
  const { start, end } = monthRange(f.month);
  const data = await ledgerFor(ctx.householdId, start, end);
  const lines = data.lines.filter((l) => inScope(l, f.scope, data.accountMap));
  const posted = lines.filter((l) => !l.pending && isSpend(l));
  const pending = lines.filter((l) => l.pending && isSpend(l));
  const excluded = lines.filter((l) => l.categoryKind === "transfer" || l.categoryKind === "card_payment" || l.categoryKind === "excluded");
  const byCat = spendByCategory(lines, data.categoryLites);
  const catName = new Map(data.categories.map((c) => [c.id, `${c.group} · ${c.name}`]));
  const acctName = new Map(data.accounts.map((a) => [a.id, a.name]));
  const q = (p: boolean) => `?month=${f.month}&scope=${f.scope}${p ? "&pending=1" : ""}`;

  return (
    <>
      <PageHead title="Expenses" sub={`${monthLabel(f.month)} · posted spend (transfers & card payments excluded)`}>
        <FilterBar month={f.month} scope={f.scope} />
      </PageHead>
      <div className="grid grid-kpi">
        <Card title="Posted spend">
          <div className="kpi-value">
            <Money cents={spendPosted(lines)} />
          </div>
          <p className="kpi-sub">Refunds in expense categories reduce this</p>
        </Card>
        <Card title="Bank-pending">
          <div className="kpi-value">
            <Money cents={spendPending(lines)} />
          </div>
          <p className="kpi-sub">Shown separately; not in posted totals</p>
        </Card>
        <Card title="Excluded moves">
          <div className="kpi-value">{excluded.length}</div>
          <p className="kpi-sub">Transfers / card payments not counted as spend</p>
        </Card>
      </div>
      <Card title="By category">{byCat.length ? <Pie title="Posted spend by category" data={byCat.map((c) => ({ label: c.name, cents: c.cents }))} /> : <Empty title="No posted spending" />}</Card>
      <Card
        title={showPending ? "Bank-pending charges" : "Posted charges"}
        action={
          <div className="seg" role="group" aria-label="Pending toggle">
            <Link href={q(false)} aria-current={!showPending ? "true" : undefined}>
              Posted ({posted.length})
            </Link>
            <Link href={q(true)} aria-current={showPending ? "true" : undefined}>
              Bank-pending ({pending.length})
            </Link>
          </div>
        }
      >
        <TxList lines={showPending ? pending : posted} categoryName={(id) => (id ? catName.get(id) ?? null : null)} accountName={(id) => (id ? acctName.get(id) ?? "" : "Cash")} />
      </Card>
    </>
  );
}
