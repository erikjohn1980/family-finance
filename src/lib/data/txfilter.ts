import { inScope, type EffectiveLine, type ScopeFilter } from "../calc/ledger";
import type { LedgerData } from "./ledger";

export type TxFilter = {
  month: string | "all";
  scope: ScopeFilter;
  account?: string;
  category?: string; // category id, "uncategorized"
  q?: string;
  status?: "all" | "posted" | "pending";
};

export function parseTxFilter(sp: Record<string, string | string[] | undefined>, defaults: { month: string; scope: ScopeFilter }): TxFilter {
  const g = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const st = g("status");
  return {
    month: g("allMonths") === "1" ? "all" : defaults.month,
    scope: defaults.scope,
    account: g("account") || undefined,
    category: g("category") || undefined,
    q: g("q")?.slice(0, 100) || undefined,
    status: st === "posted" || st === "pending" ? st : "all",
  };
}

/** Same filter for the ledger screen and the CSV export, so exports match what is on screen. */
export function applyTxFilter(data: LedgerData, f: TxFilter): EffectiveLine[] {
  const q = f.q?.toLowerCase();
  return data.lines.filter((l) => {
    if (f.month !== "all" && !l.date.startsWith(f.month)) return false;
    if (!inScope(l, f.scope, data.accountMap)) return false;
    if (f.account && l.accountId !== f.account) return false;
    if (f.category === "uncategorized" ? l.categoryId !== null : f.category && l.categoryId !== f.category) return false;
    if (f.status === "posted" && l.pending) return false;
    if (f.status === "pending" && !l.pending) return false;
    if (q && !(l.merchant.toLowerCase().includes(q) || (l.memo ?? "").toLowerCase().includes(q))) return false;
    return true;
  });
}
