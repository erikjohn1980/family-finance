import { getDb } from "@/db";
import { loadLedger } from "@/lib/data/ledger";
import { incomeDeposited, needsCategory, spendPending, spendPosted, bankPendingCount } from "@/lib/calc/ledger";
import { isValidMonth, monthKey, monthRange, todayIso } from "@/lib/dates";
import { withMember } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Household KPI summary (JSON). 401 without a session, 403 for non-members. */
export const GET = withMember(async (ctx, req) => {
  const m = new URL(req.url).searchParams.get("month");
  const month = isValidMonth(m) ? m : monthKey(todayIso());
  const { start, end } = monthRange(month);
  const db = getDb();
  const [data, all] = await Promise.all([loadLedger(db, ctx.householdId, { start, end }), loadLedger(db, ctx.householdId)]);
  return Response.json(
    {
      month,
      spendPostedCents: spendPosted(data.lines),
      spendPendingCents: spendPending(data.lines),
      incomeDepositedCents: incomeDeposited(data.lines),
      needsCategoryCount: needsCategory(all.lines).length,
      bankPendingCount: bankPendingCount(data.lines),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
