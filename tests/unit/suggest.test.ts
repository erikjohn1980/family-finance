import { describe, expect, it } from "vitest";
import { buildSuggestIndex, chipsFor, merchantKey } from "@/lib/calc/suggest";
import type { EffectiveLine } from "@/lib/calc/ledger";

const cats = [
  { id: "groc", name: "Groceries", group: "Food", kind: "expense" as const },
  { id: "dine", name: "Dining", group: "Food", kind: "expense" as const },
  { id: "shop", name: "Shopping", group: "Lifestyle", kind: "expense" as const },
  { id: "sal", name: "Salary", group: "Income", kind: "income" as const },
  { id: "xfer", name: "Transfer", group: "Moves", kind: "transfer" as const },
];
const line = (merchant: string, categoryId: string | null, amountCents = -1000, categorySource: EffectiveLine["categorySource"] = "override"): EffectiveLine => ({
  key: Math.random().toString(),
  source: "bank",
  txId: Math.random().toString(),
  accountId: "a",
  scope: "household",
  date: "2026-10-01",
  amountCents,
  txAmountCents: amountCents,
  merchant,
  pending: false,
  categoryId,
  categoryKind: cats.find((c) => c.id === categoryId)?.kind ?? null,
  categorySource: categoryId ? categorySource : null,
  isSplit: false,
  memo: null,
});

describe("category chips", () => {
  it("normalizes store numbers out of the merchant key", () => {
    expect(merchantKey("SAMPLE GROCER #12")).toBe(merchantKey("Sample Grocer 0045"));
  });

  it("highlights the merchant's usual category when it has ≥ 2 picks and ≥ 70% share", () => {
    const idx = buildSuggestIndex([line("SAMPLE GROCER #12", "groc"), line("SAMPLE GROCER #9", "groc"), line("SAMPLE GROCER 3", "groc"), line("SAMPLE GROCER 4", "shop")], cats);
    const chips = chipsFor({ merchant: "Sample Grocer 77", amountCents: -500 }, idx);
    expect(chips[0]).toEqual({ categoryId: "groc", label: "Groceries", suggested: true });
    expect(chips[1].categoryId).toBe("shop");
    expect(chips.filter((c) => c.suggested)).toHaveLength(1);
  });

  it("does not highlight on a single pick or a split history", () => {
    const one = buildSuggestIndex([line("Corner Cafe", "dine")], cats);
    expect(chipsFor({ merchant: "Corner Cafe", amountCents: -500 }, one)[0]).toMatchObject({ categoryId: "dine", suggested: false });
    const mixed = buildSuggestIndex([line("Big Box", "groc"), line("Big Box", "shop")], cats);
    expect(chipsFor({ merchant: "Big Box", amountCents: -500 }, mixed).some((c) => c.suggested)).toBe(false);
  });

  it("ignores rule-applied categories and never offers transfer-type chips", () => {
    const idx = buildSuggestIndex([line("Auto Co", "shop", -1000, "rule"), line("Auto Co", "shop", -1000, "rule"), line("Move", "xfer")], cats);
    const chips = chipsFor({ merchant: "Auto Co", amountCents: -500 }, idx);
    expect(chips.some((c) => c.suggested)).toBe(false);
    expect(chips.some((c) => c.categoryId === "xfer")).toBe(false);
  });

  it("offers income categories first for money in, expense for money out, max 4, no duplicates", () => {
    const idx = buildSuggestIndex([line("Payroll", "sal", 5000), line("A", "dine"), line("B", "dine"), line("C", "groc")], cats);
    expect(chipsFor({ merchant: "Unknown Deposit", amountCents: 9000 }, idx)[0].categoryId).toBe("sal");
    const out = chipsFor({ merchant: "Unknown Shop", amountCents: -100 }, idx);
    expect(out.map((c) => c.categoryId)).toEqual(["dine", "groc", "shop"]);
    expect(new Set(out.map((c) => c.categoryId)).size).toBe(out.length);
  });
});
