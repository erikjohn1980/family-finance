import Link from "next/link";
import { FilterBar } from "@/components/filter-bar";
import { LimitForm } from "@/components/limit-form";
import { Card, Empty, Money, PageHead, Pill, Progress } from "@/components/ui";
import { inScope } from "@/lib/calc/ledger";
import { budgetStatus } from "@/lib/calc/planning";
import { addMonths, monthLabel, monthRange } from "@/lib/dates";
import { ledgerFor, pageMember, resolveFilters } from "@/lib/page";

export const metadata = { title: "Budget Limits" };

export default async function Budgets({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pageMember();
  const f = await resolveFilters(ctx.userId, await searchParams);
  const { start, end } = monthRange(f.month);
  const p = monthRange(addMonths(f.month, -1));
  const [data, prev] = await Promise.all([ledgerFor(ctx.householdId, start, end), ledgerFor(ctx.householdId, p.start, p.end)]);
  const lines = data.lines.filter((l) => inScope(l, f.scope, data.accountMap));
  const prevLines = prev.lines.filter((l) => inScope(l, f.scope, data.accountMap));
  const expenseCats = data.categories.filter((c) => c.kind === "expense");
  const rows = expenseCats.map((c) => ({ c, st: budgetStatus(c, lines, prevLines) }));
  const withLimit = rows.filter((r) => r.st.limitCents !== null);
  const without = rows.filter((r) => r.st.limitCents === null);

  return (
    <>
      <PageHead title="Budget Limits" sub={`${monthLabel(f.month)} · posted spend vs monthly limit per category`}>
        <FilterBar month={f.month} scope={f.scope} />
      </PageHead>
      <Card title="Limits">
        {withLimit.length ? (
          <div className="board grid">
            {withLimit.map(({ c, st }) => (
              <Link key={c.id} className="mini" href={`/budgets/${c.id}?month=${f.month}&scope=${f.scope}`}>
                <div className="mini-top">
                  <span>{c.group}</span>
                  {st.state === "over" ? <Pill tone="late">Over limit</Pill> : st.state === "near" ? <Pill tone="pend">Near limit</Pill> : <Pill tone="ok">On track</Pill>}
                </div>
                <strong>{c.name}</strong>
                <span className="mini-amount">
                  <Money cents={st.spentCents} /> <span className="small muted">/ <Money cents={st.availableCents} /></span>
                </span>
                <Progress pct={st.pct} state={st.state === "none" ? undefined : st.state} label={`${c.name} spent vs limit`} />
                <div className="mini-foot">
                  <span>{c.rollover ? `Rollover on (+${((st.carryCents ?? 0) / 100).toFixed(2)})` : "Rollover off"}</span>
                  <span>
                    <Money cents={st.remainingCents} /> left
                  </span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <Empty title="No limits set">Choose a category below and enter a monthly limit. Nothing is assumed.</Empty>
        )}
      </Card>
      <Card title="Categories without a limit">
        <ul className="list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {without.map(({ c, st }) => (
            <li key={c.id} className="row" style={{ gridTemplateColumns: "minmax(0,1fr) 120px minmax(0,2fr)" }}>
              <Link href={`/budgets/${c.id}?month=${f.month}&scope=${f.scope}`} className="cell-main">
                {c.group} · {c.name}
              </Link>
              <Money cents={st.spentCents} className="amt" />
              <LimitForm c={c} />
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
