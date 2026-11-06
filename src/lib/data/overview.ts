import { and, eq } from "drizzle-orm";
import type { DB } from "@/db";
import { bankTransactions, finAccounts, netWorthManualAssets } from "@/db/schema";
import { sweepComponent, sweepEventsFromRows } from "../adapters/sweep";
import type { BalanceAccount } from "../calc/planning";
import { addDays, todayIso } from "../dates";

/** Accounts with sweep correction pre-computed (adapter-owned rule). */
export async function balanceAccounts(db: DB, householdId: string, accounts: (typeof finAccounts.$inferSelect)[]): Promise<BalanceAccount[]> {
  const out: BalanceAccount[] = [];
  for (const a of accounts) {
    let sweepComponentCents = 0;
    if (a.isSweep) {
      const rows = await db
        .select()
        .from(bankTransactions)
        .where(and(eq(bankTransactions.householdId, householdId), eq(bankTransactions.accountId, a.id)));
      const since = addDays(todayIso(), -10);
      sweepComponentCents = sweepComponent(sweepEventsFromRows(rows.filter((r) => r.postedAt >= since))).componentCents;
    }
    out.push({ id: a.id, name: a.name, kind: a.kind, balanceCents: a.balanceCents, availableBalanceCents: a.availableBalanceCents, isSweep: a.isSweep, sweepComponentCents });
  }
  return out;
}

export async function manualAssets(db: DB, householdId: string) {
  return db.select().from(netWorthManualAssets).where(eq(netWorthManualAssets.householdId, householdId));
}
