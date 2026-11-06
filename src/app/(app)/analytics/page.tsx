import Link from "next/link";
import { Bars, Pie } from "@/components/charts";
import { FilterBar } from "@/components/filter-bar";
import { Card, Empty, Money, PageHead } from "@/components/ui";
import { incomeDeposited, inScope, spendByCategory, spendPosted } from "@/lib/calc/ledger";
import { addMonths, monthKey, todayIso } from "@/lib/dates";
import { ledgerFor, pageMember, resolveFilters, SCOPE_LABEL } from "@/lib/page";

export const metadata = { title: "Analytics" };
const RANGES = [
  ["3", "3 months"],
  ["6", "6 months"],
  ["12", "12 months"],
  ["all", "All"],
] as const;

export default async function Analytics({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pageMember();
  const sp = await searchParams;
  const f = await resolveFilters(ctx.userId, sp);
  const range = RANGES.some(([r]) => r === sp.range) ? (sp.range as string) : "6";
  const data = await ledgerFor(ctx.householdId);
  const all = data.lines.filter((l) => inScope(l, f.scope, data.accountMap));
  const present = [...new Set(all.map((l) => l.date.slice(0, 7)))].sort();
  const endMonth = monthKey(todayIso()) > (present.at(-1) ?? "") ? monthKey(todayIso()) : present.at(-1)!;
  let months: string[];
  if (range === "all") {
    months = [];
    if (present.length) for (let m = present[0]; m <= endMonth; m = addMonths(m, 1)) months.push(m);
  } else {
    const n = Number(range);
    months = Array.from({ length: n }, (_, i) => addMonths(endMonth, i - n + 1));
  }
  const inRange = all.filter((l) => months.includes(l.date.slice(0, 7)));
  const per = months.map((m) => {
    const ls = inRange.filter((l) => l.date.startsWith(m));
    const spend = spendPosted(ls);
    const income = incomeDeposited(ls);
    return { m, spend, income, net: income - spend };
  });
  const hasData = inRange.length > 0;
  const labels = months.map((m) => new Date(m + "-01T00:00:00Z").toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }));
  const totals = per.reduce((a, p) => ({ spend: a.spend + p.spend, income: a.income + p.income }), { spend: 0, income: 0 });

  return (
    <>
      <PageHead title="Analytics" sub={`Spend, income and net trends · ${SCOPE_LABEL[f.scope]}`}>
        <div className="seg" role="group" aria-label="Range">
          {RANGES.map(([r, l]) => (
            <Link key={r} href={`/analytics?range=${r}&scope=${f.scope}`} aria-current={r === range ? "true" : undefined}>
              {l}
            </Link>
          ))}
        </div>
        <FilterBar month={f.month} scope={f.scope} showMonth={false} />
      </PageHead>
      {hasData ? (
        <>
          <div className="grid grid-kpi">
            <Card title="Posted spend">
              <div className="kpi-value">
                <Money cents={totals.spend} whole />
              </div>
              <p className="kpi-sub">{months.length} months</p>
            </Card>
            <Card title="Deposited income">
              <div className="kpi-value">
                <Money cents={totals.income} whole />
              </div>
            </Card>
            <Card title="Net">
              <div className="kpi-value">
                <Money cents={totals.income - totals.spend} whole />
              </div>
              <p className="kpi-sub">Income − posted spend (transfers excluded)</p>
            </Card>
          </div>
          <Card title="Monthly trend">
            <Bars
              title="Monthly posted spend, deposited income and net"
              labels={labels}
              series={[
                { label: "Spend", color: "var(--series-2)", values: per.map((p) => p.spend) },
                { label: "Income", color: "var(--series-1)", values: per.map((p) => p.income) },
                { label: "Net", color: "var(--series-3)", values: per.map((p) => p.net) },
              ]}
            />
          </Card>
          <Card title="Spend by category (range)">
            <Pie title="Spend by category in range" data={spendByCategory(inRange, data.categoryLites).map((c) => ({ label: c.name, cents: c.cents }))} />
          </Card>
        </>
      ) : (
        <Empty title="No months with data in this range">Import a CSV or add transactions to see trends.</Empty>
      )}
    </>
  );
}
