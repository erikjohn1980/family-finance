import Link from "next/link";
import { categorizeBankTx, categorizeManualTx } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { FilterBar } from "@/components/filter-bar";
import { InboxCard } from "@/components/inbox-card";
import { Empty, PageHead } from "@/components/ui";
import { bankPendingCount, inScope, needsCategory } from "@/lib/calc/ledger";
import { buildSuggestIndex, chipsFor } from "@/lib/calc/suggest";
import { shortDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
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
  const accounts = new Map(data.accounts.map((a) => [a.id, a]));
  const idx = buildSuggestIndex(data.lines, data.categoryLites);
  const total = queue.reduce((s, n) => s + Math.abs(n.amountCents), 0);

  return (
    <>
      <PageHead title="Needs category" sub="Tap a category to file each item. This queue is separate from bank-pending settlement.">
        <FilterBar month={f.month} scope={f.scope} showMonth={false} />
      </PageHead>
      <div className="stat-strip">
        <div className="stat">
          <span className="stat-value" data-testid="needs-count">
            {queue.length}
          </span>
          <span className="stat-label">need a category · {formatCents(total)}</span>
        </div>
        <div className="stat">
          <span className="stat-value" data-testid="pending-count">
            {pendingTotal}
          </span>
          <span className="stat-label">bank-pending (separate; may already have a category)</span>
        </div>
      </div>
      {queue.length ? (
        <ul className="inbox-list">
          {queue.map((n) => {
            const a = accounts.get(acct.get(n.txId) ?? "");
            return (
              <InboxCard
                key={`${n.source}:${n.txId}`}
                item={{
                  source: n.source,
                  txId: n.txId,
                  merchant: n.merchant,
                  dateLabel: shortDate(n.date),
                  amountLabel: formatCents(Math.abs(n.amountCents), { sign: n.amountCents > 0 }),
                  inflow: n.amountCents > 0,
                  pending: n.pending,
                  accountLabel: a ? `${a.name}${a.maskLast4 ? ` ••${a.maskLast4}` : ""}` : n.source === "manual" ? "Manual entry" : "",
                }}
                chips={chipsFor(n, idx)}
              >
                <ActionForm action={n.source === "bank" ? categorizeBankTx : categorizeManualTx} className="form-actions" aria-label={`Categorize ${n.merchant}`}>
                  <input type="hidden" name="txId" value={n.txId} />
                  <label className="sr-only" htmlFor={`cat-${n.txId}`}>
                    Category for {n.merchant}
                  </label>
                  <select id={`cat-${n.txId}`} name="categoryId" required defaultValue="" style={{ flex: "1 1 180px", width: "auto" }}>
                    <option value="">All categories…</option>
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
                  <Submit className="btn btn-primary">Assign</Submit>
                  <Link className="btn" href={`/transactions/${n.source}/${n.txId}`}>
                    Split or details
                  </Link>
                </ActionForm>
              </InboxCard>
            );
          })}
        </ul>
      ) : (
        <Empty title="All caught up">
          Nothing needs a category. New imports and manual entries without one will appear here.
          <Link className="btn" href="/budgets">
            See this month
          </Link>
        </Empty>
      )}
    </>
  );
}
