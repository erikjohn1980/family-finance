import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { userPrefs } from "@/db/schema";
import { requirePageMember } from "./session";
import { isValidMonth, monthKey, todayIso } from "./dates";
import { SCOPE_FILTERS, type ScopeFilter } from "./calc/ledger";
import { loadLedger } from "./data/ledger";

export const pageMember = cache(requirePageMember);

export const ledgerFor = cache(async (householdId: string, start?: string, end?: string) =>
  loadLedger(getDb(), householdId, start && end ? { start, end } : undefined),
);

export async function getPref<T>(userId: string, key: string): Promise<T | null> {
  const [row] = await getDb().select().from(userPrefs).where(and(eq(userPrefs.userId, userId), eq(userPrefs.key, key))).limit(1);
  return (row?.value as T) ?? null;
}

export type Filters = { month: string; scope: ScopeFilter };

/** Month/scope filters: URL params win, otherwise the user's persisted choice, otherwise defaults. */
export async function resolveFilters(userId: string, sp: Record<string, string | string[] | undefined>): Promise<Filters> {
  const pref = (await getPref<Partial<Filters>>(userId, "filters")) ?? {};
  const m = typeof sp.month === "string" ? sp.month : undefined;
  const sc = typeof sp.scope === "string" ? sp.scope : undefined;
  const month = isValidMonth(m) ? m : isValidMonth(pref.month) ? pref.month! : monthKey(todayIso());
  const scope = SCOPE_FILTERS.includes(sc as ScopeFilter) ? (sc as ScopeFilter) : SCOPE_FILTERS.includes(pref.scope as ScopeFilter) ? (pref.scope as ScopeFilter) : "default";
  return { month, scope };
}

export const SCOPE_LABEL: Record<ScopeFilter, string> = {
  default: "Household + included business",
  household: "Household only",
  business: "Business only",
  trust: "Trust",
  all: "All scopes",
};

export function demoMode() {
  return process.env.DEMO_MODE === "true";
}
