import { inArray } from "drizzle-orm";
import { bankTransactions } from "@/db/schema";
import { toCsv } from "@/lib/csv/csv";
import { centsToDecimalString } from "@/lib/money";
import { getDb } from "@/db";
import { loadLedger } from "@/lib/data/ledger";
import { applyTxFilter, parseTxFilter } from "@/lib/data/txfilter";
import { resolveFilters } from "@/lib/page";
import { withMember } from "@/lib/session";

export const dynamic = "force-dynamic";

/** CSV export of the filtered ledger. UTF-8 with BOM; formula-like cells are escaped. */
export const GET = withMember(async (ctx, req) => {
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const base = await resolveFilters(ctx.userId, sp);
  const f = parseTxFilter(sp, base);
  const data = await loadLedger(getDb(), ctx.householdId);
  const lines = applyTxFilter(data, f);
  const cat = new Map(data.categories.map((c) => [c.id, c]));
  const acct = new Map(data.accounts.map((a) => [a.id, a]));
  const header = ["source", "external_id", "posted_at", "account", "scope", "merchant", "amount", "pending", "category_group", "category", "category_kind", "category_source", "split", "memo"];
  const bankIds = lines.filter((l) => l.source === "bank").map((l) => l.txId);
  const ext = new Map<string, string>();
  if (bankIds.length) {
    const rows = await getDb().select({ id: bankTransactions.id, externalId: bankTransactions.externalId }).from(bankTransactions).where(inArray(bankTransactions.id, bankIds));
    for (const r of rows) ext.set(r.id, r.externalId);
  }
  const body = toCsv(
    header,
    lines.map((l) => {
      const c = l.categoryId ? cat.get(l.categoryId) : undefined;
      const a = l.accountId ? acct.get(l.accountId) : undefined;
      return [l.source, l.source === "bank" ? ext.get(l.txId) ?? "" : `manual-${l.txId}`, l.date, a?.name ?? "", l.scope, l.merchant, centsToDecimalString(l.amountCents), l.pending ? "true" : "false", c?.group ?? "", c?.name ?? "", c?.kind ?? "", l.categorySource ?? "", l.isSplit ? "true" : "false", l.memo ?? ""];
    }),
  );
  const name = `family-finance-${f.month === "all" ? "all" : f.month}.csv`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
});
