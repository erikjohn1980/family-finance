/**
 * Effective-ledger semantics. Pure functions — no DB access — so they are unit-testable.
 *
 * Bank rows are immutable. The effective category of a bank row is, in priority order:
 *   1. its own latest override split_group
 *   2. overrides carried from its bank-pending twin (pending → posted link)
 *   3. an owner-CONFIRMED merchant rule
 *   4. none → it appears in the Needs-category queue
 */
import { daysBetween } from "../dates";

export type Scope = "household" | "business" | "trust";
export type CategoryKind = "expense" | "income" | "transfer" | "card_payment" | "excluded";

export type CategoryLite = { id: string; name: string; group: string; kind: CategoryKind };
export type AccountLite = { id: string; name: string; scope: Scope; includeInHouseholdOverview: boolean };

export type BankTxInput = {
  id: string;
  accountId: string;
  externalId: string;
  postedAt: string;
  amountCents: number;
  merchantRaw: string;
  pending: boolean;
};
export type OverrideInput = {
  bankTxId: string | null;
  categoryId: string | null;
  memo: string | null;
  splitGroup: string;
  splitAmountCents: number | null;
  createdAt: Date;
};
export type ManualTxInput = {
  id: string;
  accountId: string | null;
  scope: Scope;
  amountCents: number;
  merchant: string;
  categoryId: string | null;
  memo: string | null;
  occurredAt: string;
};
export type RuleInput = { pattern: string; categoryId: string; confirmedAt: Date | null; rejectedAt?: Date | null };
export type PendingLinkInput = { pendingTxId: string; postedTxId: string };

export type CategorySource = "override" | "carried" | "rule" | "manual" | null;

export type EffectiveLine = {
  key: string;
  source: "bank" | "manual";
  txId: string;
  accountId: string | null;
  scope: Scope;
  date: string;
  amountCents: number;
  txAmountCents: number;
  merchant: string;
  pending: boolean;
  categoryId: string | null;
  categoryKind: CategoryKind | null;
  categorySource: CategorySource;
  isSplit: boolean;
  memo: string | null;
};

/** Proposed default (owner may change): pending rows without a posted twin are dropped after 7 days. */
export const PENDING_STALE_DAYS = 7;

export function latestOverrideGroups(overrides: OverrideInput[]): Map<string, OverrideInput[]> {
  const latestGroup = new Map<string, { group: string; at: number }>();
  for (const o of overrides) {
    if (!o.bankTxId) continue;
    const at = o.createdAt.getTime();
    const cur = latestGroup.get(o.bankTxId);
    if (!cur || at > cur.at || (at === cur.at && o.splitGroup > cur.group)) {
      latestGroup.set(o.bankTxId, { group: o.splitGroup, at });
    }
  }
  const out = new Map<string, OverrideInput[]>();
  for (const o of overrides) {
    if (!o.bankTxId) continue;
    if (latestGroup.get(o.bankTxId)?.group !== o.splitGroup) continue;
    const arr = out.get(o.bankTxId) ?? [];
    arr.push(o);
    out.set(o.bankTxId, arr);
  }
  return out;
}

export function matchRule(merchant: string, rules: RuleInput[]): RuleInput | null {
  const m = merchant.toLowerCase();
  let best: RuleInput | null = null;
  for (const r of rules) {
    if (!r.confirmedAt || r.rejectedAt) continue; // owner confirmation required
    const p = r.pattern.trim().toLowerCase();
    if (p && m.includes(p) && (!best || p.length > best.pattern.length)) best = r;
  }
  return best;
}

export type BuildInput = {
  bankTxs: BankTxInput[];
  overrides: OverrideInput[];
  manualTxs: ManualTxInput[];
  rules: RuleInput[];
  categories: CategoryLite[];
  accounts: AccountLite[];
  pendingLinks: PendingLinkInput[];
  today: string;
};

export type BuildResult = {
  lines: EffectiveLine[];
  /** Bank-pending rows dropped because no posted twin appeared inside the window. */
  stalePendingIds: string[];
  /** Pending rows superseded by their posted twin. */
  supersededPendingIds: string[];
};

export function buildEffectiveLines(input: BuildInput): BuildResult {
  const cats = new Map(input.categories.map((c) => [c.id, c]));
  const accts = new Map(input.accounts.map((a) => [a.id, a]));
  const groups = latestOverrideGroups(input.overrides);
  const pendingOfPosted = new Map<string, string>();
  const linkedPending = new Set<string>();
  for (const l of input.pendingLinks) {
    linkedPending.add(l.pendingTxId);
    pendingOfPosted.set(l.postedTxId, l.pendingTxId);
  }
  const lines: EffectiveLine[] = [];
  const stalePendingIds: string[] = [];
  const supersededPendingIds: string[] = [];

  for (const tx of input.bankTxs) {
    if (tx.pending && linkedPending.has(tx.id)) {
      supersededPendingIds.push(tx.id);
      continue;
    }
    if (tx.pending && daysBetween(tx.postedAt, input.today) > PENDING_STALE_DAYS) {
      stalePendingIds.push(tx.id);
      continue;
    }
    const scope = accts.get(tx.accountId)?.scope ?? "household";
    let group = groups.get(tx.id);
    let src: CategorySource = group ? "override" : null;
    if (!group) {
      const p = pendingOfPosted.get(tx.id);
      if (p && groups.has(p)) {
        group = groups.get(p);
        src = "carried";
      }
    }
    const base = {
      source: "bank" as const,
      txId: tx.id,
      accountId: tx.accountId,
      scope,
      date: tx.postedAt,
      txAmountCents: tx.amountCents,
      merchant: tx.merchantRaw,
      pending: tx.pending,
    };
    const categorized = group?.filter((o) => o.categoryId) ?? [];
    const isSplit = categorized.length > 1 && categorized.every((o) => o.splitAmountCents !== null);
    if (isSplit) {
      categorized.forEach((o, i) => {
        const c = cats.get(o.categoryId!);
        lines.push({
          ...base,
          key: `bank:${tx.id}:${i}`,
          amountCents: o.splitAmountCents!,
          categoryId: o.categoryId,
          categoryKind: c?.kind ?? null,
          categorySource: src,
          isSplit: true,
          memo: o.memo,
        });
      });
      continue;
    }
    const memo = group?.find((o) => o.memo)?.memo ?? null;
    let categoryId = categorized[0]?.categoryId ?? null;
    if (!categoryId) {
      const r = matchRule(tx.merchantRaw, input.rules);
      if (r) {
        categoryId = r.categoryId;
        src = "rule";
      } else src = null;
    }
    const c = categoryId ? cats.get(categoryId) : undefined;
    lines.push({
      ...base,
      key: `bank:${tx.id}:0`,
      amountCents: tx.amountCents,
      categoryId: c ? categoryId : null,
      categoryKind: c?.kind ?? null,
      categorySource: c ? src : null,
      isSplit: false,
      memo,
    });
  }

  for (const m of input.manualTxs) {
    const c = m.categoryId ? cats.get(m.categoryId) : undefined;
    const scope = (m.accountId && accts.get(m.accountId)?.scope) || m.scope;
    lines.push({
      key: `manual:${m.id}:0`,
      source: "manual",
      txId: m.id,
      accountId: m.accountId,
      scope,
      date: m.occurredAt,
      amountCents: m.amountCents,
      txAmountCents: m.amountCents,
      merchant: m.merchant,
      pending: false,
      categoryId: c ? m.categoryId : null,
      categoryKind: c?.kind ?? null,
      categorySource: c ? "manual" : null,
      isSplit: false,
      memo: m.memo,
    });
  }
  lines.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.key.localeCompare(b.key)));
  return { lines, stalePendingIds, supersededPendingIds };
}

// ---------- Scope filter ----------
export type ScopeFilter = "default" | "household" | "business" | "trust" | "all";
export const SCOPE_FILTERS: ScopeFilter[] = ["default", "household", "business", "trust", "all"];

/** Default overview = household + business accounts the owner explicitly includes. */
export function inScope(line: { scope: Scope; accountId: string | null }, f: ScopeFilter, accounts: Map<string, AccountLite>): boolean {
  if (f === "all") return true;
  if (f === "default") {
    if (line.scope === "household") return true;
    return line.accountId ? accounts.get(line.accountId)?.includeInHouseholdOverview === true : false;
  }
  return line.scope === f;
}

// ---------- Totals ----------
/** Expense-signed lines: categorized expense, or uncategorized outflow (still spend until categorized). */
function isSpendLine(l: EffectiveLine): boolean {
  if (l.categoryKind === "expense") return true;
  if (l.categoryKind === null) return l.amountCents < 0;
  return false; // income, transfer, card_payment, excluded
}

/** Posted spend in cents (positive number). Refunds in expense categories reduce it. */
export function spendPosted(lines: EffectiveLine[]): number {
  return lines.filter((l) => !l.pending && isSpendLine(l)).reduce((s, l) => s - l.amountCents, 0);
}
/** Bank-pending spend — shown separately, never mixed into posted KPIs. */
export function spendPending(lines: EffectiveLine[]): number {
  return lines.filter((l) => l.pending && isSpendLine(l)).reduce((s, l) => s - l.amountCents, 0);
}
/** Deposited income = posted lines in income-kind categories only (bank or manual). */
export function incomeDeposited(lines: EffectiveLine[]): number {
  return lines.filter((l) => !l.pending && l.categoryKind === "income").reduce((s, l) => s + l.amountCents, 0);
}

export type NeedsCategoryItem = { source: "bank" | "manual"; txId: string; merchant: string; date: string; amountCents: number; pending: boolean };
/** Rows lacking an effective category (no override, no carried override, no confirmed rule). Independent of pending. */
export function needsCategory(lines: EffectiveLine[]): NeedsCategoryItem[] {
  const seen = new Set<string>();
  const out: NeedsCategoryItem[] = [];
  for (const l of lines) {
    if (l.categoryId !== null) continue;
    const k = `${l.source}:${l.txId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ source: l.source, txId: l.txId, merchant: l.merchant, date: l.date, amountCents: l.txAmountCents, pending: l.pending });
  }
  return out;
}
export function bankPendingCount(lines: EffectiveLine[]): number {
  return new Set(lines.filter((l) => l.pending).map((l) => l.txId)).size;
}

export function spendByCategory(lines: EffectiveLine[], cats: CategoryLite[]) {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const m = new Map<string, { id: string | null; name: string; group: string; cents: number }>();
  for (const l of lines) {
    if (l.pending || !isSpendLine(l)) continue;
    const c = l.categoryId ? byId.get(l.categoryId) : undefined;
    const k = c?.id ?? "__uncat";
    const cur = m.get(k) ?? { id: c?.id ?? null, name: c?.name ?? "Uncategorized", group: c?.group ?? "Uncategorized", cents: 0 };
    cur.cents -= l.amountCents;
    m.set(k, cur);
  }
  return [...m.values()].sort((a, b) => b.cents - a.cents);
}

export function spendByGroup(lines: EffectiveLine[], cats: CategoryLite[]) {
  const m = new Map<string, number>();
  for (const r of spendByCategory(lines, cats)) m.set(r.group, (m.get(r.group) ?? 0) + r.cents);
  return [...m.entries()].map(([group, cents]) => ({ group, cents })).sort((a, b) => b.cents - a.cents);
}

// ---------- Pending → posted matching ----------
function normMerchant(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !/^\d+$/.test(t) && !["pos", "pending", "purchase", "debit", "card", "the"].includes(t));
}
export function merchantSimilar(a: string, b: string): boolean {
  const ta = normMerchant(a);
  const tb = new Set(normMerchant(b));
  if (ta.length === 0 || tb.size === 0) return a.trim().toLowerCase() === b.trim().toLowerCase();
  return ta.some((t) => tb.has(t));
}

export type MatchCandidate = BankTxInput & { pendingExternalId?: string | null };

/**
 * Match bank-pending rows to posted twins.
 * Rule 1 (external_twin): posted payload names the pending external id.
 * Rule 2 (heuristic): same account, same sign, posted within 0–7 days, amount within max($1, 20%), merchant similar.
 */
export function matchPendingToPosted(
  pendings: MatchCandidate[],
  posteds: MatchCandidate[],
  existing: PendingLinkInput[],
): (PendingLinkInput & { rule: "external_twin" | "heuristic" })[] {
  const linkedP = new Set(existing.map((l) => l.pendingTxId));
  const usedQ = new Set(existing.map((l) => l.postedTxId));
  const out: (PendingLinkInput & { rule: "external_twin" | "heuristic" })[] = [];
  for (const p of pendings) {
    if (!p.pending || linkedP.has(p.id)) continue;
    const twin = posteds.find((q) => !q.pending && !usedQ.has(q.id) && q.accountId === p.accountId && q.pendingExternalId && q.pendingExternalId === p.externalId);
    if (twin) {
      out.push({ pendingTxId: p.id, postedTxId: twin.id, rule: "external_twin" });
      usedQ.add(twin.id);
      linkedP.add(p.id);
      continue;
    }
    let best: { q: MatchCandidate; score: number } | null = null;
    for (const q of posteds) {
      if (q.pending || usedQ.has(q.id) || q.accountId !== p.accountId) continue;
      if (Math.sign(q.amountCents) !== Math.sign(p.amountCents)) continue;
      const days = daysBetween(p.postedAt, q.postedAt);
      if (days < 0 || days > PENDING_STALE_DAYS) continue;
      const diff = Math.abs(Math.abs(q.amountCents) - Math.abs(p.amountCents));
      if (diff > Math.max(100, Math.round(Math.abs(p.amountCents) * 0.2))) continue;
      if (!merchantSimilar(p.merchantRaw, q.merchantRaw)) continue;
      const score = diff * 10 + days;
      if (!best || score < best.score) best = { q, score };
    }
    if (best) {
      out.push({ pendingTxId: p.id, postedTxId: best.q.id, rule: "heuristic" });
      usedQ.add(best.q.id);
      linkedP.add(p.id);
    }
  }
  return out;
}


export function accountInScope(a: { scope: Scope; includeInHouseholdOverview: boolean }, f: ScopeFilter): boolean {
  if (f === "all") return true;
  if (f === "default") return a.scope === "household" || a.includeInHouseholdOverview;
  return a.scope === f;
}
