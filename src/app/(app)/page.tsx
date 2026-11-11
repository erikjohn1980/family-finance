import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { incomeExpectations, recurringBills } from "@/db/schema";
import { Pie } from "@/components/charts";
import { FilterBar } from "@/components/filter-bar";
import { BillPill, Card, Empty, Money, PageHead, Pill, Progress } from "@/components/ui";
import { Icon } from "@/components/icons";
import { accountInScope, bankPendingCount, incomeDeposited, inScope, needsCategory, spendByGroup, spendPending, spendPosted } from "@/lib/calc/ledger";
import { billStatus, budgetStatus, cashView, expectedInMonth, freshness, netWorth } from "@/lib/calc/planning";
import { addMonths, monthLabel, monthRange, shortDate, todayIso } from "@/lib/dates";
import { balanceAccounts, manualAssets } from "@/lib/data/overview";
import { ledgerFor, pageMember, resolveFilters, SCOPE_LABEL } from "@/lib/page";

export const metadata = { title: "Overview" };

export default async function Overview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pageMember();
  const f = await resolveFilters(ctx.userId, await searchParams);
  const db = getDb();
  const { start, end } = monthRange(f.month);
  const prev = monthRange(addMonths(f.month, -1));
  const [data, prevData, all, expectations, bills, assets] = await Promise.all([
    ledgerFor(ctx.householdId, start, end),
    ledgerFor(ctx.householdId, prev.start, prev.end),
    ledgerFor(ctx.householdId),
    db.select().from(incomeExpectations).where(and(eq(incomeExpectations.householdId, ctx.householdId), eq(incomeExpectations.active, true))),
    db.select().from(recurringBills).where(and(eq(recurringBills.householdId, ctx.householdId), eq(recurringBills.active, true))),
    manualAssets(db, ctx.householdId),
  ]);
  const lines = data.lines.filter((l) => inScope(l, f.scope, data.accountMap));
  const prevLines = prevData.lines.filter((l) => inScope(l, f.scope, data.accountMap));
  const accounts = data.accounts.filter((a) => accountInScope(a, f.scope));
  const bal = await balanceAccounts(db, ctx.householdId, accounts);
  const cash = cashView(bal);
  const nw = netWorth(bal, f.scope === "business" ? [] : assets);
  const posted = spendPosted(lines);
  const pendingSpend = spendPending(lines);
  const deposited = incomeDeposited(lines);
  const expScoped = expectations.filter((e) => accountInScope({ scope: e.scope, includeInHouseholdOverview: false }, f.scope));
  const expectedParts = expScoped.map((e) => expectedInMonth(e, f.month));
  const expected = expectedParts.reduce<number>((s, v) => s + (v ?? 0), 0);
  const needs = needsCategory(all.lines.filter((l) => inScope(l, f.scope, data.accountMap)));
  const pendingCount = bankPendingCount(lines);
  const groups = spendByGroup(lines, data.categoryLites);
  const today = todayIso();
  const billStates = bills.map((b) => ({ b, st: billStatus(b, lines, f.month, today) }));
  const limits = data.categories
    .filter((c) => c.monthlyLimitCents !== null)
    .map((c) => ({ c, st: budgetStatus(c, lines, prevLines) }))
    .sort((a, b) => (b.st.pct ?? 0) - (a.st.pct ?? 0))
    .slice(0, 4);
  const stale = accounts.filter((a) => freshness(a.balanceAsOf, a.staleAfterHours) === "stale").length;

  return (
    <>
      <PageHead title="Financial overview" sub={`${monthLabel(f.month)} · ${SCOPE_LABEL[f.scope]}`}>
        <FilterBar month={f.month} scope={f.scope} />
      </PageHead>

      <div className="grid grid-kpi">
        <Card title="Cash" icon={<span className="dot" style={{ background: "var(--series-3)" }} />} action={<Link className="small" href="/accounts">Accounts</Link>}>
          <div className="kpi-value" data-testid="kpi-cash">
            <Money cents={cash.cashCents} whole />
          </div>
          <p className="kpi-sub">Checking + savings now. Kept separate from net worth.</p>
          {cash.missing.length ? <p className="small muted">No balance yet: {cash.missing.join(", ")}</p> : null}
        </Card>
        <Card title="Net worth" icon={<span className="dot" style={{ background: "var(--series-1)" }} />}>
          <div className="kpi-value" data-testid="kpi-networth">
            <Money cents={nw.netCents} whole />
          </div>
          <p className="kpi-sub">
            Assets <Money cents={nw.assetsCents} whole /> − liabilities <Money cents={nw.liabilitiesCents} whole />
          </p>
          {nw.missing.length ? <p className="small muted">Not counted (no value entered): {nw.missing.join(", ")}</p> : null}
        </Card>
        <Card title="Income" icon={<span className="dot" style={{ background: "var(--series-4)" }} />} action={<Link className="small" href="/income">Details</Link>}>
          <div className="kpi-value">
            <Money cents={deposited} whole />
          </div>
          <p className="kpi-sub">
            deposited · <Money cents={expected} whole /> planned
            {expectedParts.some((v) => v === null) ? " (some plans need a pay date)" : ""}
          </p>
          <div style={{ marginTop: 10 }}>
            <Progress pct={expected ? deposited / expected : null} state="accent" label="Income deposited vs planned" />
          </div>
        </Card>
        <Card title="Spending (posted)" icon={<span className="dot" style={{ background: "var(--series-2)" }} />} action={<Link className="small" href="/expenses">Details</Link>}>
          <div className="kpi-value" data-testid="kpi-spend">
            <Money cents={posted} whole />
          </div>
          <p className="kpi-sub">
            {deposited > 0 ? `${Math.round((posted / deposited) * 100)}% of deposited income · ` : ""}
            <Pill tone="pend">
              <Money cents={pendingSpend} whole /> bank-pending
            </Pill>
          </p>
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="Spend by group" icon={<Icon name="analytics" />} action={<Link className="small" href="/analytics">Analytics</Link>}>
          {groups.length ? <Pie title="Posted spend by group" data={groups.map((g) => ({ label: g.group, cents: g.cents }))} /> : <Empty title="No posted spending this month">Import a CSV or add a transaction.</Empty>}
        </Card>
        <Card
          title="Needs category"
          icon={<Icon name="tag" />}
          action={
            <Link className="btn btn-sm" href="/needs-category">
              Open queue ({needs.length})
            </Link>
          }
        >
          <p className="small muted" style={{ marginBottom: 10 }}>
            {needs.length} item{needs.length === 1 ? "" : "s"} await a household category. Separate from bank-pending settlement ({pendingCount} pending this month).
          </p>
          {needs.length ? (
            <div className="list">
              {needs.slice(0, 5).map((n) => (
                <Link key={n.txId} className="row row-tx" style={{ gridTemplateColumns: "100px minmax(0,1fr) auto" }} href={`/transactions/${n.source}/${n.txId}`}>
                  <span className="small muted">{shortDate(n.date)}</span>
                  <span className="cell-main">
                    {n.merchant} {n.pending ? <Pill tone="pend">Bank-pending</Pill> : null}
                  </span>
                  <Money className="amt" cents={n.amountCents} />
                </Link>
              ))}
            </div>
          ) : (
            <Empty title="All caught up">Every transaction has a category.</Empty>
          )}
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="Budget limits" icon={<Icon name="limit" />} action={<Link className="small" href="/budgets">All limits</Link>}>
          {limits.length ? (
            <div className="list" style={{ gap: 12 }}>
              {limits.map(({ c, st }) => (
                <Link key={c.id} href={`/budgets/${c.id}?month=${f.month}`} style={{ textDecoration: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span>{c.name}</span>
                    <span className="num small">
                      <Money cents={st.spentCents} whole /> / <Money cents={st.availableCents} whole />
                    </span>
                  </span>
                  <Progress pct={st.pct} state={st.state === "none" ? undefined : st.state} label={`${c.name} spent vs limit`} />
                </Link>
              ))}
            </div>
          ) : (
            <Empty title="No limits set">Set monthly limits on the Budget Limits screen.</Empty>
          )}
        </Card>
        <Card title="Recurring bills" icon={<Icon name="calendar" />} action={<Link className="small" href="/recurring">All bills</Link>}>
          {billStates.length ? (
            <div className="list">
              {billStates.slice(0, 5).map(({ b, st }) => (
                <div key={b.id} className="row" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
                  <span className="cell-main">{b.label}</span>
                  <BillPill status={st.status} />
                </div>
              ))}
            </div>
          ) : (
            <Empty title="No verified bills yet">Track a bill from a matched charge on the Recurring bills screen.</Empty>
          )}
          {stale ? <p className="small" style={{ marginTop: 10, color: "var(--late)" }}>{stale} account balance{stale === 1 ? " is" : "s are"} stale.</p> : null}
        </Card>
      </div>
    </>
  );
}
