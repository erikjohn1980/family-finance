import { and, asc, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import type { DB } from "@/db";
import {
  bankTransactions,
  categories,
  finAccounts,
  ledgerOverrides,
  manualTransactions,
  merchantRules,
  pendingLinks,
} from "@/db/schema";
import { addDays, todayIso } from "../dates";
import {
  buildEffectiveLines,
  inScope,
  type AccountLite,
  type CategoryLite,
  type EffectiveLine,
  type ScopeFilter,
} from "../calc/ledger";

export async function loadCategories(db: DB, householdId: string) {
  return db
    .select()
    .from(categories)
    .where(and(eq(categories.householdId, householdId), eq(categories.archived, false)))
    .orderBy(asc(categories.group), asc(categories.name));
}

export async function loadAccounts(db: DB, householdId: string, includeArchived = false) {
  const rows = await db.select().from(finAccounts).where(eq(finAccounts.householdId, householdId)).orderBy(asc(finAccounts.name));
  return includeArchived ? rows : rows.filter((a) => !a.archived);
}

export type LedgerData = {
  lines: EffectiveLine[];
  stalePendingIds: string[];
  categories: Awaited<ReturnType<typeof loadCategories>>;
  categoryLites: CategoryLite[];
  accounts: Awaited<ReturnType<typeof loadAccounts>>;
  accountMap: Map<string, AccountLite>;
};

/** Load effective lines for [start, end] (inclusive ISO dates). Omit range to load everything. */
export async function loadLedger(db: DB, householdId: string, range?: { start: string; end: string }, today = todayIso()): Promise<LedgerData> {
  const [allCats, accounts, rules] = await Promise.all([
    db.select().from(categories).where(eq(categories.householdId, householdId)).orderBy(asc(categories.group), asc(categories.name)),
    loadAccounts(db, householdId, true),
    db.select().from(merchantRules).where(eq(merchantRules.householdId, householdId)),
  ]);
  // Pull a little before the range so pending twins & carried overrides resolve.
  const bankWhere = range
    ? and(eq(bankTransactions.householdId, householdId), gte(bankTransactions.postedAt, addDays(range.start, -14)), lte(bankTransactions.postedAt, range.end))
    : eq(bankTransactions.householdId, householdId);
  const bank = await db.select().from(bankTransactions).where(bankWhere).orderBy(desc(bankTransactions.postedAt));
  const ids = bank.map((b) => b.id);
  const [ovr, links] = ids.length
    ? await Promise.all([
        db.select().from(ledgerOverrides).where(inArray(ledgerOverrides.bankTxId, ids)),
        db.select().from(pendingLinks).where(inArray(pendingLinks.postedTxId, ids)),
      ])
    : [[], []];
  // Pending twins may predate the window; fetch their overrides too.
  const extraPendingIds = links.map((l) => l.pendingTxId).filter((id) => !ids.includes(id));
  const extraOvr = extraPendingIds.length ? await db.select().from(ledgerOverrides).where(inArray(ledgerOverrides.bankTxId, extraPendingIds)) : [];
  // Pending rows linked to posted twins outside the window are still superseded.
  const pendingIdsInWindow = bank.filter((b) => b.pending).map((b) => b.id);
  const linksForPending = pendingIdsInWindow.length ? await db.select().from(pendingLinks).where(inArray(pendingLinks.pendingTxId, pendingIdsInWindow)) : [];
  const allLinks = [...links, ...linksForPending.filter((l) => !links.some((x) => x.pendingTxId === l.pendingTxId))];

  const manualWhere = range
    ? and(eq(manualTransactions.householdId, householdId), isNull(manualTransactions.deletedAt), gte(manualTransactions.occurredAt, range.start), lte(manualTransactions.occurredAt, range.end))
    : and(eq(manualTransactions.householdId, householdId), isNull(manualTransactions.deletedAt));
  const manual = await db.select().from(manualTransactions).where(manualWhere);

  const cats = allCats.filter((c) => !c.archived);
  const toLite = (c: (typeof allCats)[number]): CategoryLite => ({ id: c.id, name: c.name, group: c.group, kind: c.kind });
  const categoryLites: CategoryLite[] = cats.map(toLite);
  const allCatLites: CategoryLite[] = allCats.map(toLite);
  const accountLites: AccountLite[] = accounts.map((a) => ({ id: a.id, name: a.name, scope: a.scope, includeInHouseholdOverview: a.includeInHouseholdOverview }));
  const res = buildEffectiveLines({
    bankTxs: bank,
    overrides: [...ovr, ...extraOvr],
    manualTxs: manual,
    rules,
    categories: allCatLites,
    accounts: accountLites,
    pendingLinks: allLinks,
    today,
  });
  const lines = range ? res.lines.filter((l) => l.date >= range.start && l.date <= range.end) : res.lines;
  return {
    lines,
    stalePendingIds: res.stalePendingIds,
    categories: cats,
    categoryLites,
    accounts: accounts.filter((a) => !a.archived),
    accountMap: new Map(accountLites.map((a) => [a.id, a])),
  };
}

export function filterScope(data: LedgerData, scope: ScopeFilter): EffectiveLine[] {
  return data.lines.filter((l) => inScope(l, scope, data.accountMap));
}
