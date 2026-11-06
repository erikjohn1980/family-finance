import { describe, expect, it } from "vitest";
import {
  bankPendingCount,
  buildEffectiveLines,
  incomeDeposited,
  matchPendingToPosted,
  needsCategory,
  spendPending,
  spendPosted,
  type BuildInput,
} from "@/lib/calc/ledger";

const cats = [
  { id: "groc", name: "Groceries", group: "Food", kind: "expense" as const },
  { id: "sal", name: "Salary", group: "Income", kind: "income" as const },
  { id: "xfer", name: "Transfer", group: "Moves", kind: "transfer" as const },
  { id: "cardpay", name: "Card payment", group: "Moves", kind: "card_payment" as const },
];
const accounts = [{ id: "chk", name: "Checking", scope: "household" as const, includeInHouseholdOverview: false }];
const tx = (id: string, amountCents: number, o: Partial<BuildInput["bankTxs"][number]> = {}) => ({
  id,
  accountId: "chk",
  externalId: id,
  postedAt: "2026-10-10",
  amountCents,
  merchantRaw: `Merchant ${id}`,
  pending: false,
  ...o,
});
const ov = (bankTxId: string, categoryId: string, at = 1, splitGroup = `g-${bankTxId}-${at}`, splitAmountCents: number | null = null) => ({
  bankTxId,
  categoryId,
  memo: null,
  splitGroup,
  splitAmountCents,
  createdAt: new Date(at * 1000),
});
const base = (p: Partial<BuildInput>): BuildInput => ({
  bankTxs: [],
  overrides: [],
  manualTxs: [],
  rules: [],
  categories: cats,
  accounts,
  pendingLinks: [],
  today: "2026-10-12",
  ...p,
});

describe("spend and income semantics", () => {
  it("excludes transfers and card payments from income and spend", () => {
    const { lines } = buildEffectiveLines(
      base({
        bankTxs: [tx("a", -5000), tx("b", -100000), tx("c", 100000), tx("d", -20000), tx("e", 300000)],
        overrides: [ov("a", "groc"), ov("b", "xfer"), ov("c", "xfer"), ov("d", "cardpay"), ov("e", "sal")],
      }),
    );
    expect(spendPosted(lines)).toBe(5000);
    expect(incomeDeposited(lines)).toBe(300000);
  });

  it("refund reduces spend and does not create phantom income", () => {
    const { lines } = buildEffectiveLines(
      base({ bankTxs: [tx("a", -5000), tx("r", 1500)], overrides: [ov("a", "groc"), ov("r", "groc")] }),
    );
    expect(spendPosted(lines)).toBe(3500);
    expect(incomeDeposited(lines)).toBe(0);
  });

  it("uncategorized inflow is not income", () => {
    const { lines } = buildEffectiveLines(base({ bankTxs: [tx("in", 99900)] }));
    expect(incomeDeposited(lines)).toBe(0);
    expect(needsCategory(lines)).toHaveLength(1);
  });

  it("keeps bank-pending spend separate from posted", () => {
    const { lines } = buildEffectiveLines(
      base({ bankTxs: [tx("a", -5000), tx("p", -2500, { pending: true })], overrides: [ov("a", "groc"), ov("p", "groc")] }),
    );
    expect(spendPosted(lines)).toBe(5000);
    expect(spendPending(lines)).toBe(2500);
  });

  it("needs-category count differs from bank-pending count when sets differ", () => {
    const { lines } = buildEffectiveLines(
      base({
        bankTxs: [tx("u1", -100), tx("u2", -200), tx("p1", -300, { pending: true })],
        overrides: [ov("p1", "groc")],
      }),
    );
    expect(needsCategory(lines).length).toBe(2);
    expect(bankPendingCount(lines)).toBe(1);
  });

  it("latest override wins; splits produce multiple lines that sum to the tx", () => {
    const { lines } = buildEffectiveLines(
      base({
        bankTxs: [tx("s", -10000)],
        overrides: [ov("s", "xfer", 1), ov("s", "groc", 2, "split", -6000), { ...ov("s", "cardpay", 2, "split", -4000) }],
      }),
    );
    const s = lines.filter((l) => l.txId === "s");
    expect(s).toHaveLength(2);
    expect(s.reduce((a, l) => a + l.amountCents, 0)).toBe(-10000);
    expect(spendPosted(lines)).toBe(6000);
  });

  it("applies only owner-confirmed merchant rules", () => {
    const rules = [
      { pattern: "whole", categoryId: "groc", confirmedAt: null },
      { pattern: "coffee", categoryId: "groc", confirmedAt: new Date() },
    ];
    const { lines } = buildEffectiveLines(base({ bankTxs: [tx("w", -100, { merchantRaw: "WHOLE MKT" }), tx("c", -200, { merchantRaw: "Corner Coffee" })], rules }));
    expect(lines.find((l) => l.txId === "w")!.categoryId).toBeNull();
    expect(lines.find((l) => l.txId === "c")!.categorySource).toBe("rule");
  });
});

describe("pending → posted", () => {
  it("carries the pending override to the posted twin and supersedes the pending row", () => {
    const p = tx("p", -4210, { pending: true, merchantRaw: "CORNER BAKERY #12", postedAt: "2026-10-08" });
    const q = tx("q", -4210, { merchantRaw: "Corner Bakery 12", postedAt: "2026-10-10" });
    const links = matchPendingToPosted([p], [q], []);
    expect(links).toEqual([{ pendingTxId: "p", postedTxId: "q", rule: "heuristic" }]);
    const r = buildEffectiveLines(base({ bankTxs: [p, q], overrides: [ov("p", "groc")], pendingLinks: links }));
    expect(r.supersededPendingIds).toEqual(["p"]);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].categoryId).toBe("groc");
    expect(r.lines[0].categorySource).toBe("carried");
  });

  it("matches tips within 20% and prefers explicit external twin ids", () => {
    const p = tx("p", -2000, { pending: true, merchantRaw: "Bistro Uno" });
    const q1 = tx("q1", -2350, { merchantRaw: "BISTRO UNO" });
    const q2 = { ...tx("q2", -9000, { merchantRaw: "Other" }), pendingExternalId: "p" };
    expect(matchPendingToPosted([p], [q1], [])[0].postedTxId).toBe("q1");
    expect(matchPendingToPosted([p], [q1, q2], [])[0]).toMatchObject({ postedTxId: "q2", rule: "external_twin" });
  });

  it("drops stale pendings with no twin inside the window", () => {
    const r = buildEffectiveLines(base({ bankTxs: [tx("old", -500, { pending: true, postedAt: "2026-09-01" })] }));
    expect(r.stalePendingIds).toEqual(["old"]);
    expect(r.lines).toHaveLength(0);
  });

  it("does not match across accounts, signs, or dissimilar merchants", () => {
    const p = tx("p", -2000, { pending: true, merchantRaw: "Bistro Uno" });
    expect(matchPendingToPosted([p], [tx("q", -2000, { accountId: "other", merchantRaw: "Bistro Uno" })], [])).toHaveLength(0);
    expect(matchPendingToPosted([p], [tx("q", 2000, { merchantRaw: "Bistro Uno" })], [])).toHaveLength(0);
    expect(matchPendingToPosted([p], [tx("q", -2000, { merchantRaw: "Hardware Depot" })], [])).toHaveLength(0);
  });
});
