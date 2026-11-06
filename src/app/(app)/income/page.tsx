import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { incomeExpectations } from "@/db/schema";
import { saveIncomeExpectation, toggleIncomeExpectation } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { FilterBar } from "@/components/filter-bar";
import { TxList } from "@/components/tx-list";
import { Card, Empty, Money, PageHead, Pill, Progress } from "@/components/ui";
import { accountInScope, incomeDeposited, inScope } from "@/lib/calc/ledger";
import { expectedInMonth } from "@/lib/calc/planning";
import { monthLabel, monthRange } from "@/lib/dates";
import { ledgerFor, pageMember, resolveFilters } from "@/lib/page";

export const metadata = { title: "Income" };

export default async function Income({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pageMember();
  const f = await resolveFilters(ctx.userId, await searchParams);
  const { start, end } = monthRange(f.month);
  const [data, exps] = await Promise.all([
    ledgerFor(ctx.householdId, start, end),
    getDb().select().from(incomeExpectations).where(eq(incomeExpectations.householdId, ctx.householdId)),
  ]);
  const lines = data.lines.filter((l) => inScope(l, f.scope, data.accountMap));
  const deposits = lines.filter((l) => !l.pending && l.categoryKind === "income");
  const uncategorizedInflows = lines.filter((l) => !l.pending && l.categoryId === null && l.amountCents > 0);
  const deposited = incomeDeposited(lines);
  const active = exps.filter((e) => e.active && accountInScope({ scope: e.scope, includeInHouseholdOverview: false }, f.scope));
  const incomeCats = data.categories.filter((c) => c.kind === "income");
  const catName = new Map(data.categories.map((c) => [c.id, c.name]));
  const acctName = new Map(data.accounts.map((a) => [a.id, a.name]));
  const expectedTotal = active.reduce((s, e) => s + (expectedInMonth(e, f.month) ?? 0), 0);
  const depositedByCat = (cid: string | null) => (cid ? deposits.filter((d) => d.categoryId === cid).reduce((s, d) => s + d.amountCents, 0) : null);

  return (
    <>
      <PageHead title="Income" sub={`${monthLabel(f.month)} · expected vs deposited`}>
        <FilterBar month={f.month} scope={f.scope} />
      </PageHead>
      <div className="grid grid-kpi">
        <Card title="Planned">
          <div className="kpi-value">
            <Money cents={expectedTotal} />
          </div>
          <p className="kpi-sub">From owner-entered income plans</p>
        </Card>
        <Card title="Deposited">
          <div className="kpi-value">
            <Money cents={deposited} />
          </div>
          <p className="kpi-sub">Posted rows in income categories (bank or manual)</p>
          <div style={{ marginTop: 10 }}>
            <Progress pct={expectedTotal ? deposited / expectedTotal : null} state="accent" label="Deposited vs planned" />
          </div>
        </Card>
        <Card title="Uncategorized inflows">
          <div className="kpi-value">
            <Money cents={uncategorizedInflows.reduce((s, l) => s + l.amountCents, 0)} />
          </div>
          <p className="kpi-sub">Not counted as income until categorized</p>
        </Card>
      </div>
      <p className="banner banner-info small" role="note">
        A planned line without a matching deposit means only that the deposit is not in this ledger yet. It does not mean any institution is disconnected; balances may sync separately.
      </p>
      <Card title="Planned income">
        {active.length ? (
          <div className="list">
            {active.map((e) => {
              const exp = expectedInMonth(e, f.month);
              const dep = depositedByCat(e.categoryId);
              return (
                <div key={e.id} className="row" style={{ gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) auto" }}>
                  <span className="cell-main">
                    <strong>{e.label}</strong> <span className="small muted">{e.cadence} · {e.scope}{e.categoryId ? ` · ${catName.get(e.categoryId)}` : ""}</span>
                  </span>
                  <span>{exp === null ? <Pill tone="plan">Needs pay date</Pill> : <>Planned <Money cents={exp} /></>}</span>
                  <span>
                    {dep === null ? <span className="small muted">Link a category to compare</span> : dep >= (exp ?? 0) && dep > 0 ? <Pill tone="ok">Deposited <Money cents={dep} /></Pill> : <Pill tone="due">Not yet deposited{dep ? <> · <Money cents={dep} /></> : null}</Pill>}
                  </span>
                  <ActionForm action={toggleIncomeExpectation}>
                    <input type="hidden" name="id" value={e.id} />
                    <Submit className="btn btn-sm">Deactivate</Submit>
                  </ActionForm>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty title="No income plans yet">Add the owner-approved expected amounts below. Nothing is assumed.</Empty>
        )}
        {exps.some((e) => !e.active) ? (
          <details className="details" style={{ marginTop: 10 }}>
            <summary className="small muted">Inactive plans ({exps.filter((e) => !e.active).length})</summary>
            {exps
              .filter((e) => !e.active)
              .map((e) => (
                <ActionForm key={e.id} action={toggleIncomeExpectation} className="form-actions">
                  <input type="hidden" name="id" value={e.id} />
                  <span>{e.label}</span>
                  <Submit className="btn btn-sm">Reactivate</Submit>
                </ActionForm>
              ))}
          </details>
        ) : null}
      </Card>
      <Card title="Add income plan">
        <ActionForm action={saveIncomeExpectation} resetOnSuccess aria-label="Add income plan">
          <div className="form-grid">
            <label>
              Label
              <input name="label" required placeholder="e.g. Base pay" />
            </label>
            <label>
              Amount per occurrence
              <input name="amount" inputMode="decimal" required />
            </label>
            <label>
              Cadence
              <select name="cadence" defaultValue="monthly">
                <option value="monthly">Monthly</option>
                <option value="semimonthly">Twice a month</option>
                <option value="biweekly">Every two weeks</option>
                <option value="weekly">Weekly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
              </select>
            </label>
            <label>
              Known pay date (for weekly/biweekly/quarterly/annual)
              <input type="date" name="anchorDate" />
            </label>
            <label>
              Income category
              <select name="categoryId" defaultValue="">
                <option value="">—</option>
                {incomeCats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Scope
              <select name="scope" defaultValue="household">
                <option value="household">Household</option>
                <option value="business">Business</option>
                <option value="trust">Trust</option>
              </select>
            </label>
          </div>
          <div className="form-actions" style={{ marginTop: 12 }}>
            <Submit>Add plan</Submit>
          </div>
        </ActionForm>
      </Card>
      <Card title="Deposits this month">
        <TxList lines={deposits} categoryName={(id) => (id ? catName.get(id) ?? null : null)} accountName={(id) => (id ? acctName.get(id) ?? "" : "Cash")} empty={<Empty title="No deposits categorized as income this month" />} />
      </Card>
    </>
  );
}
