/**
 * Planning semantics: net worth, cash, budgets, income expectations, recurring bills, goals.
 * Pure functions only.
 */
import { daysBetween, monthRange } from "../dates";
import type { EffectiveLine } from "./ledger";
import { spendPosted } from "./ledger";

export type AccountKind =
  | "checking" | "savings" | "credit_card" | "loan" | "brokerage" | "retirement" | "real_estate" | "vehicle" | "other_asset";

export const LIABILITY_KINDS: AccountKind[] = ["credit_card", "loan"];
export const CASH_KINDS: AccountKind[] = ["checking", "savings"];
export const INVESTMENT_KINDS: AccountKind[] = ["brokerage", "retirement"];

export type BalanceAccount = {
  id: string;
  name: string;
  kind: AccountKind;
  balanceCents: number | null;
  availableBalanceCents?: number | null;
  isSweep?: boolean;
  /** Pre-computed sweep component for sweep accounts (see adapters/sweep.ts). */
  sweepComponentCents?: number;
};

export function isLiability(kind: AccountKind) {
  return LIABILITY_KINDS.includes(kind);
}

/** Reported cash for one account. Sweep accounts: available + sweep component (0 when matched). */
export function accountCash(a: BalanceAccount): number | null {
  if (a.isSweep) {
    if (a.availableBalanceCents === null || a.availableBalanceCents === undefined) return a.balanceCents;
    return a.availableBalanceCents + (a.sweepComponentCents ?? 0);
  }
  return a.balanceCents;
}

export type CashSummary = { cashCents: number; missing: string[] };
/** Cash view: checking + savings only. Separate from net worth. */
export function cashView(accounts: BalanceAccount[]): CashSummary {
  let cash = 0;
  const missing: string[] = [];
  for (const a of accounts) {
    if (!CASH_KINDS.includes(a.kind)) continue;
    const v = accountCash(a);
    if (v === null) missing.push(a.name);
    else cash += v;
  }
  return { cashCents: cash, missing };
}

export type ManualAsset = { label: string; amountCents: number | null };
export type NetWorth = {
  assetsCents: number;
  liabilitiesCents: number;
  netCents: number;
  breakdown: { cash: number; investments: number; property: number; otherAccounts: number; manualAssets: number };
  missing: string[];
};

/** Net worth = assets − liabilities. Liabilities are stored positive and subtracted. Nulls are reported, never guessed. */
export function netWorth(accounts: BalanceAccount[], manual: ManualAsset[]): NetWorth {
  const b = { cash: 0, investments: 0, property: 0, otherAccounts: 0, manualAssets: 0 };
  let liabilities = 0;
  const missing: string[] = [];
  for (const a of accounts) {
    const v = CASH_KINDS.includes(a.kind) ? accountCash(a) : a.balanceCents;
    if (v === null) {
      missing.push(a.name);
      continue;
    }
    if (isLiability(a.kind)) liabilities += Math.abs(v);
    else if (CASH_KINDS.includes(a.kind)) b.cash += v;
    else if (INVESTMENT_KINDS.includes(a.kind)) b.investments += v;
    else if (a.kind === "real_estate" || a.kind === "vehicle") b.property += v;
    else b.otherAccounts += v;
  }
  for (const m of manual) {
    if (m.amountCents === null) missing.push(m.label);
    else b.manualAssets += m.amountCents;
  }
  const assets = b.cash + b.investments + b.property + b.otherAccounts + b.manualAssets;
  return { assetsCents: assets, liabilitiesCents: liabilities, netCents: assets - liabilities, breakdown: b, missing };
}

// ---------- Budget limits ----------
export type BudgetCategory = { id: string; monthlyLimitCents: number | null; rollover: boolean };
export type BudgetStatus = {
  limitCents: number | null;
  carryCents: number;
  availableCents: number | null;
  spentCents: number;
  remainingCents: number | null;
  pct: number | null;
  state: "none" | "ok" | "near" | "over";
};

/**
 * Posted spend vs monthly limit. Rollover (only when category.rollover is true):
 * PROPOSED default — carry last month's unused amount (never negative), one month deep.
 */
export function budgetStatus(cat: BudgetCategory, monthLines: EffectiveLine[], prevMonthLines: EffectiveLine[]): BudgetStatus {
  const spent = spendPosted(monthLines.filter((l) => l.categoryId === cat.id));
  if (cat.monthlyLimitCents === null) {
    return { limitCents: null, carryCents: 0, availableCents: null, spentCents: spent, remainingCents: null, pct: null, state: "none" };
  }
  let carry = 0;
  if (cat.rollover) {
    const prevSpent = spendPosted(prevMonthLines.filter((l) => l.categoryId === cat.id));
    carry = Math.max(0, cat.monthlyLimitCents - prevSpent);
  }
  const available = cat.monthlyLimitCents + carry;
  const pct = available > 0 ? spent / available : spent > 0 ? Infinity : 0;
  return {
    limitCents: cat.monthlyLimitCents,
    carryCents: carry,
    availableCents: available,
    spentCents: spent,
    remainingCents: available - spent,
    pct,
    state: pct > 1 ? "over" : pct >= 0.85 ? "near" : "ok",
  };
}

// ---------- Income expectations ----------
export type Cadence = "weekly" | "biweekly" | "semimonthly" | "monthly" | "quarterly" | "annual";
export type Expectation = { amountCents: number; cadence: Cadence; anchorDate: string | null };

/** Occurrences of an expectation in month M. Returns null when an anchor date is required but missing. */
export function occurrencesInMonth(e: Expectation, month: string): number | null {
  const { start, end } = monthRange(month);
  switch (e.cadence) {
    case "monthly":
      return 1;
    case "semimonthly":
      return 2;
    case "weekly":
    case "biweekly": {
      if (!e.anchorDate) return null;
      const step = e.cadence === "weekly" ? 7 : 14;
      const offset = ((daysBetween(e.anchorDate, start) % step) + step) % step;
      const first = offset === 0 ? 0 : step - offset; // days from start to first occurrence
      const len = daysBetween(start, end) + 1;
      return first >= len ? 0 : Math.floor((len - 1 - first) / step) + 1;
    }
    case "quarterly":
    case "annual": {
      if (!e.anchorDate) return null;
      const n = e.cadence === "quarterly" ? 3 : 12;
      const a = e.anchorDate.slice(0, 7);
      const diff = monthsDiff(a, month);
      return ((diff % n) + n) % n === 0 ? 1 : 0;
    }
  }
}
function monthsDiff(a: string, b: string) {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
}
export function expectedInMonth(e: Expectation, month: string): number | null {
  const n = occurrencesInMonth(e, month);
  return n === null ? null : n * e.amountCents;
}

// ---------- Recurring bills (verified obligations; status from matched charges only) ----------
export type BillInput = {
  amountMinCents: number;
  amountMaxCents: number;
  matchRules: { merchantPattern: string; accountId?: string | null; dueDay?: number | null };
};
export type BillStatus = { status: "paid" | "due" | "overdue" | "awaiting"; dueDate: string | null; matched: EffectiveLine[] };

export function billMatches(bill: BillInput, l: EffectiveLine): boolean {
  if (l.pending || l.amountCents >= 0) return false;
  const amt = Math.abs(l.amountCents);
  if (amt < bill.amountMinCents || amt > bill.amountMaxCents) return false;
  if (bill.matchRules.accountId && l.accountId !== bill.matchRules.accountId) return false;
  const p = bill.matchRules.merchantPattern.trim().toLowerCase();
  return p.length > 0 && l.merchant.toLowerCase().includes(p);
}

export function billStatus(bill: BillInput, monthLines: EffectiveLine[], month: string, today: string): BillStatus {
  const matched = monthLines.filter((l) => billMatches(bill, l));
  const { end } = monthRange(month);
  const lastDay = Number(end.slice(8));
  const dueDay = bill.matchRules.dueDay ? Math.min(bill.matchRules.dueDay, lastDay) : null;
  const dueDate = dueDay ? `${month}-${String(dueDay).padStart(2, "0")}` : null;
  if (matched.length > 0) return { status: "paid", dueDate, matched };
  if (!dueDate) return { status: "awaiting", dueDate, matched };
  return { status: today > dueDate ? "overdue" : "due", dueDate, matched };
}

// ---------- Goals (planning only; no fund movement) ----------
export type GoalInput = {
  kind: "save" | "debt";
  targetAmountCents: number;
  linkedAccountIds: string[];
  fundedAmountCents: number | null;
  baselineCents: number | null;
};
export type GoalProgress = { progressCents: number | null; pct: number | null; source: "linked" | "manual" | "none" };

export function goalProgress(g: GoalInput, accounts: BalanceAccount[]): GoalProgress {
  const linked = accounts.filter((a) => g.linkedAccountIds.includes(a.id));
  const withBal = linked.filter((a) => a.balanceCents !== null);
  if (g.kind === "save") {
    if (withBal.length > 0) {
      const p = withBal.reduce((s, a) => s + (a.balanceCents ?? 0), 0);
      return { progressCents: p, pct: clamp01(p / g.targetAmountCents), source: "linked" };
    }
    if (g.fundedAmountCents !== null) return { progressCents: g.fundedAmountCents, pct: clamp01(g.fundedAmountCents / g.targetAmountCents), source: "manual" };
    return { progressCents: null, pct: null, source: "none" };
  }
  // debt: paid down = baseline − current liability balance
  if (withBal.length > 0 && g.baselineCents !== null) {
    const current = withBal.reduce((s, a) => s + Math.abs(a.balanceCents ?? 0), 0);
    const paid = Math.max(0, g.baselineCents - current);
    return { progressCents: paid, pct: clamp01(paid / g.targetAmountCents), source: "linked" };
  }
  if (g.fundedAmountCents !== null) return { progressCents: g.fundedAmountCents, pct: clamp01(g.fundedAmountCents / g.targetAmountCents), source: "manual" };
  return { progressCents: null, pct: null, source: "none" };
}
function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

// ---------- Freshness ----------
export type Freshness = "fresh" | "stale" | "unknown";
export function freshness(asOf: Date | null, staleAfterHours: number, now = new Date()): Freshness {
  if (!asOf) return "unknown";
  return now.getTime() - asOf.getTime() > staleAfterHours * 3_600_000 ? "stale" : "fresh";
}

