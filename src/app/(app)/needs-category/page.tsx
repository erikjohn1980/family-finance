import Link from "next/link";
import { categorizeBankTx, categorizeManualTx } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { FilterBar } from "@/components/filter-bar";
import { Card, Empty, Money, PageHead, Pill } from "@/components/ui";
import { bankPendingCount, inScope, needsCategory } from "@/lib/calc/ledger";
import { shortDate } from "@/lib/dates";
import { ledgerFor, pageMember, resolveFilters } from "@/lib/page";

export const metadata = { title: "Needs category" };

export default async function NeedsCategory({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pageMember();
  const f = await resolveFilters(ctx.userId, await searchParams);
  const data = await ledgerFor(ctx.householdId);
  const lines = data.lines.filter((l) => inScope(l, f.scope, data.accountMap));
  const queue = needsCategory(lines);
  const pendingTotal = bankPendingCount(lines);
  const acct = new Map(data.lines.map((l) => [l.txId, l.accountId]));
  const acctName = new Map(data.accounts.map((a) => [a.id, a.name]));

  return (
    <>
      <PageHead title="Needs category" sub="Rows without a household category, from any month. This queue is independent of bank-pending settlement.">
        <FilterBar month={f.month} scope={f.scope} showMonth={false} />
      </PageHead>
      <div className="grid grid-kpi">
        <Card title="Needs category">
          <div className="kpi-value" data-testid="needs-count">
            {queue.length}
          </div>
          <p className="kpi-sub">No override, carried override, or confirmed rule</p>
        </Card>
        <Card title="Bank-pending (separate)">
          <div className="kpi-value" data-testid="pending-count">
            {pendingTotal}
          </div>
          <p className="kpi-sub">Not yet settled by the bank; may already have a category</p>
        </Card>
      </div>
      <Card>
        {queue.length ? (
          <ul className="list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {queue.map((n) => (
              <li key={`${n.source}:${n.txId}`} className="row" style={{ gridTemplateColumns: "100px minmax(0,1.4fr) 110px minmax(0,2fr)" }}>
                <span className="small muted">{shortDate(n.date)}</span>
                <span className="cell-main">
                  <Link href={`/transactions/${n.source}/${n.txId}`}>{n.merchant}</Link>
                  <span className="small muted"> · {acctName.get(acct.get(n.txId) ?? "") ?? (n.source === "manual" ? "Manual" : "")}</span>
                  {n.pending ? (
                    <>
                      {" "}
                      <Pill tone="pend">Bank-pending</Pill>
                    </>
                  ) : null}
                </span>
                <Money className="amt" cents={n.amountCents} sign />
                <ActionForm action={n.source === "bank" ? categorizeBankTx : categorizeManualTx} className="form-actions" aria-label={`Categorize ${n.merchant}`}>
                  <input type="hidden" name="txId" value={n.txId} />
                  <label className="sr-only" htmlFor={`cat-${n.txId}`}>
                    Category for {n.merchant}
                  </label>
                  <select id={`cat-${n.txId}`} name="categoryId" required defaultValue="" style={{ flex: "1 1 180px", width: "auto" }}>
                    <option value="">Choose category…</option>
                    {data.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.group} · {c.name}
                      </option>
                    ))}
                  </select>
                  {n.source === "bank" ? (
                    <label className="inline small">
                      <input type="checkbox" name="suggestRule" /> Suggest rule
                    </label>
                  ) : null}
                  <Submit className="btn btn-sm btn-primary">Assign</Submit>
                </ActionForm>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="Nothing needs a category">New imports and manual entries without a category will appear here.</Empty>
        )}
      </Card>
    </>
  );
}
