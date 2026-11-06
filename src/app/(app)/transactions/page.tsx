import Link from "next/link";
import { FilterBar } from "@/components/filter-bar";
import { TxList } from "@/components/tx-list";
import { Card, Money, PageHead } from "@/components/ui";
import { spendPending, spendPosted } from "@/lib/calc/ledger";
import { monthLabel } from "@/lib/dates";
import { applyTxFilter, parseTxFilter } from "@/lib/data/txfilter";
import { ledgerFor, pageMember, resolveFilters } from "@/lib/page";

export const metadata = { title: "All transactions" };

export default async function Transactions({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pageMember();
  const sp = await searchParams;
  const base = await resolveFilters(ctx.userId, sp);
  const f = parseTxFilter(sp, base);
  const data = await ledgerFor(ctx.householdId);
  const lines = applyTxFilter(data, f);
  const catName = new Map(data.categories.map((c) => [c.id, `${c.group} · ${c.name}`]));
  const acctName = new Map(data.accounts.map((a) => [a.id, a.name]));
  const exportParams = new URLSearchParams();
  for (const [k, v] of Object.entries({ month: f.month === "all" ? "" : f.month, scope: f.scope, account: f.account, category: f.category, q: f.q, status: f.status === "all" ? "" : f.status, allMonths: f.month === "all" ? "1" : "" })) if (v) exportParams.set(k, v);

  return (
    <>
      <PageHead title="All transactions" sub={`${f.month === "all" ? "All months" : monthLabel(f.month)} · ${lines.length} rows · imported bank rows are read-only; categories are stored as overrides`}>
        <a className="btn" href={`/api/household/export?${exportParams}`} download>
          Export these rows
        </a>
      </PageHead>
      {sp.deleted ? <p className="banner banner-info" role="status">Manual transaction deleted (kept in audit history).</p> : null}
      <Card>
        <div className="filters" style={{ marginBottom: 14 }}>
          <FilterBar month={base.month} scope={base.scope} />
        </div>
        <form className="filters" method="get" role="search" aria-label="Filter transactions">
          <input type="hidden" name="month" value={base.month} />
          <input type="hidden" name="scope" value={base.scope} />
          <label>
            Search
            <input name="q" defaultValue={f.q ?? ""} placeholder="Merchant or memo" />
          </label>
          <label>
            Card / account
            <select name="account" defaultValue={f.account ?? ""}>
              <option value="">All accounts</option>
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.maskLast4 ? ` ••${a.maskLast4}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Category
            <select name="category" defaultValue={f.category ?? ""}>
              <option value="">All categories</option>
              <option value="uncategorized">Needs category</option>
              {data.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.group} · {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select name="status" defaultValue={f.status}>
              <option value="all">Posted + bank-pending</option>
              <option value="posted">Posted only</option>
              <option value="pending">Bank-pending only</option>
            </select>
          </label>
          <label className="inline">
            <input type="checkbox" name="allMonths" value="1" defaultChecked={f.month === "all"} /> All months
          </label>
          <div className="form-actions">
            <button className="btn btn-primary" type="submit">
              Apply
            </button>
            <Link className="btn" href={`/transactions?month=${base.month}&scope=${base.scope}`}>
              Clear
            </Link>
          </div>
        </form>
      </Card>
      <div className="grid grid-kpi">
        <Card title="Posted spend in view">
          <div className="kpi-value">
            <Money cents={spendPosted(lines)} />
          </div>
          <p className="kpi-sub">Transfers and card payments excluded</p>
        </Card>
        <Card title="Bank-pending in view">
          <div className="kpi-value">
            <Money cents={spendPending(lines)} />
          </div>
          <p className="kpi-sub">Not in posted totals</p>
        </Card>
      </div>
      <Card>
        <TxList lines={lines} categoryName={(id) => (id ? catName.get(id) ?? null : null)} accountName={(id) => (id ? acctName.get(id) ?? "" : "Cash / no account")} />
      </Card>
    </>
  );
}
