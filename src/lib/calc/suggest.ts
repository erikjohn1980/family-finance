/**
 * Category chips for the Needs-category queue. Deterministic, no AI.
 * Chips are only shortcuts for a human pick: nothing here is ever auto-applied.
 *
 *  1. Merchant history: categories this merchant was given by a person before.
 *     The top one is highlighted as "suggested" when it has ≥ 2 picks and ≥ 70% of them.
 *  2. Most-used categories for the same direction (money out → expense, money in → income).
 */
import { rulePatternFor } from "../rules";
import type { CategoryLite, EffectiveLine } from "./ledger";

export type Chip = { categoryId: string; label: string; suggested: boolean };

export const merchantKey = rulePatternFor;

const HUMAN_SOURCES = new Set(["override", "carried", "manual"]);
/** Before the household has any history, lead with everyday categories (matched by name if they exist). */
const EVERYDAY = ["groceries", "dining", "shopping", "fuel", "utilities"];

export type SuggestIndex = {
  byMerchant: Map<string, Map<string, number>>;
  commonOut: string[];
  commonIn: string[];
  cats: Map<string, CategoryLite>;
};

/** Build once per page from all effective lines, then call chipsFor per queue item. */
export function buildSuggestIndex(lines: EffectiveLine[], categories: CategoryLite[]): SuggestIndex {
  const cats = new Map(categories.map((c) => [c.id, c]));
  const byMerchant = new Map<string, Map<string, number>>();
  // "Common" categories are ranked by how many different merchants use them, so a
  // one-merchant category such as rent does not crowd out everyday ones.
  const outM = new Map<string, Set<string>>();
  const innM = new Map<string, Set<string>>();
  const bump = (m: Map<string, Set<string>>, id: string, key: string) => m.set(id, (m.get(id) ?? new Set<string>()).add(key));
  for (const l of lines) {
    if (!l.categoryId || !l.categorySource || !HUMAN_SOURCES.has(l.categorySource)) continue;
    const c = cats.get(l.categoryId);
    if (!c) continue;
    const key = merchantKey(l.merchant);
    if (key) {
      const m = byMerchant.get(key) ?? new Map<string, number>();
      m.set(c.id, (m.get(c.id) ?? 0) + 1);
      byMerchant.set(key, m);
    }
    if (c.kind === "expense" && l.amountCents < 0) bump(outM, c.id, key);
    if (c.kind === "income" && l.amountCents > 0) bump(innM, c.id, key);
  }
  const sizes = (m: Map<string, Set<string>>) => new Map([...m.entries()].map(([id, set]) => [id, set.size]));
  const out = sizes(outM);
  const inn = sizes(innM);
  const rank = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id);
  // Fall back to the category list order so a brand-new household still gets chips.
  const fill = (ranked: string[], kind: "expense" | "income") => {
    const rest = categories.filter((c) => c.kind === kind && !ranked.includes(c.id));
    const everyday = (c: CategoryLite) => {
      const i = EVERYDAY.indexOf(c.name.toLowerCase());
      return i === -1 ? EVERYDAY.length : i;
    };
    return [...ranked, ...rest.sort((a, b) => everyday(a) - everyday(b)).map((c) => c.id)];
  };
  return { byMerchant, commonOut: fill(rank(out), "expense"), commonIn: fill(rank(inn), "income"), cats };
}

export function chipsFor(item: { merchant: string; amountCents: number }, idx: SuggestIndex, max = 4): Chip[] {
  const chips: Chip[] = [];
  const add = (id: string, suggested = false) => {
    const c = idx.cats.get(id);
    if (!c || chips.length >= max || chips.some((x) => x.categoryId === id)) return;
    chips.push({ categoryId: id, label: c.name, suggested });
  };
  const hist = idx.byMerchant.get(merchantKey(item.merchant));
  if (hist) {
    const ranked = [...hist.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const total = ranked.reduce((s, [, n]) => s + n, 0);
    ranked.forEach(([id, n], i) => add(id, i === 0 && n >= 2 && n / total >= 0.7));
  }
  for (const id of item.amountCents < 0 ? idx.commonOut : idx.commonIn) add(id);
  return chips;
}
