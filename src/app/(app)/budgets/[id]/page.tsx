import Link from "next/link";
import { notFound } from "next/navigation";
import { FilterBar } from "@/components/filter-bar";
import { LimitForm } from "@/components/limit-form";
import { TxList } from "@/components/tx-list";
import { Card, Empty, Money, PageHead, Pill, Progress } from "@/components/ui";
import { inScope } from "@/lib/calc/ledger";
import { budgetStatus } from "@/lib/calc/planning";
import { addMonths, monthLabel, monthRange } from "@/lib/dates";
import { ledgerFor, pageMember, resolveFilters } from "@/lib/page";

export const metadata = { title: "Budget limit" };

export default async function BudgetDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const ctx = await pageMember();
  const f = await resolveFilters(ctx.userId, await searchParams);
  const { start, end } = monthRange(f.month);
  const p = monthRange(addMonths(f.month, -1));
  const [data, prev] = await Promise.all([ledgerFor(ctx.householdId, start, end), ledgerFor(ctx.householdId, p.start, p.end)]);
  const c = data.categories.find((x) => x.id === id);
  if (!c) notFound();
  const lines = data.lines.filter((l) => l.categoryId === id && inScope(l, f.scope, data.accountMap));
  const prevLines = prev.lines.filter((l) => l.categoryId === id && inScope(l, f.scope, data.accountMap));
  const st = budgetStatus(c, lines, prevLines);
  const merchants = new Map<string, number>();
  for (const l of lines.filter((x) => !x.pending)) merchants.set(l.merchant, (merchants.get(l.merchant) ?? 0) - l.amountCents);
  const topMerchants = [...merchants.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const acctName = new Map(data.accounts.map((a) => [a.id, a.name]));

  return (
    <>
      <PageHead title={`${c.name}`} sub={`${c.group} · ${monthLabel(f.month)}`}>
        <Link className="btn" href={`/budgets?month=${f.month}`}>
          All limits
        </Link>
        <FilterBar month={f.month} scope={f.scope} />
      </PageHead>
      <div className="grid grid-kpi">
        <Card title="Posted spend">
          <div className="kpi-value">
            <Money cents={st.spentCents} />
          </div>
          <p className="kpi-sub">Bank-pending is not counted</p>
        </Card>
        <Card title="Plan">
          <div className="kpi-value">{st.limitCents === null ? <span className="muted">No limit</span> : <Money cents={st.availableCents} />}</div>
          <p className="kpi-sub">
            {st.limitCents === null ? "Set a limit below" : <>Limit <Money cents={st.limitCents} />{c.rollover ? <> + rollover <Money cents={st.carryCents} /></> : " · rollover off"}</>}
          </p>
          {st.limitCents !== null ? (
            <div style={{ marginTop: 10 }}>
              <Progress pct={st.pct} state={st.state === "none" ? undefined : st.state} label="Spent vs plan" />
            </div>
          ) : null}
        </Card>
        <Card title="Remaining">
          <div className="kpi-value">{st.remainingCents === null ? "—" : <Money cents={st.remainingCents} />}</div>
          <p className="kpi-sub">{st.state === "over" ? <Pill tone="late">Over limit</Pill> : st.state === "near" ? <Pill tone="pend">Near limit</Pill> : st.state === "ok" ? <Pill tone="ok">On track</Pill> : null}</p>
        </Card>
      </div>
      <Card title="Limit settings">
        <LimitForm c={c} />
      </Card>
      <div className="grid grid-2">
        <Card title="Top merchants">
          {topMerchants.length ? (
            <ul className="legend" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {topMerchants.map(([m, cents]) => (
                <li key={m} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span className="cell-main">{m}</span>
                  <Money cents={cents} />
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No spending in this category" />
          )}
        </Card>
        <Card title="Recent transactions">
          <TxList lines={lines.slice(0, 25)} categoryName={() => c.name} accountName={(aid) => (aid ? acctName.get(aid) ?? "" : "Cash")} empty={<Empty title="No transactions this month" />} />
        </Card>
      </div>
    </>
  );
}
