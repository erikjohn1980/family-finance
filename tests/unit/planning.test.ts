import { describe, expect, it } from "vitest";
import { sweepComponent } from "@/lib/adapters/sweep";
import { billStatus, budgetStatus, cashView, expectedInMonth, goalProgress, netWorth, occurrencesInMonth } from "@/lib/calc/planning";
import type { EffectiveLine } from "@/lib/calc/ledger";

const line = (p: Partial<EffectiveLine>): EffectiveLine => ({
  key: Math.random().toString(),
  source: "bank",
  txId: "t",
  accountId: "a",
  scope: "household",
  date: "2026-10-05",
  amountCents: -1000,
  txAmountCents: -1000,
  merchant: "Electric Co",
  pending: false,
  categoryId: "util",
  categoryKind: "expense",
  categorySource: "override",
  isSplit: false,
  memo: null,
  ...p,
});

describe("sweep cash rule", () => {
  it("unmatched purchase adds its absolute value", () => {
    const r = sweepComponent([{ id: "p1", date: "2026-10-01", type: "purchase", amountCents: -50000, pending: false }]);
    expect(r.componentCents).toBe(50000);
  });
  it("matched pending redemption zeros the sweep component", () => {
    const r = sweepComponent([
      { id: "p1", date: "2026-10-01", type: "purchase", amountCents: -50000, pending: false },
      { id: "r1", date: "2026-10-02", type: "redemption", amountCents: 50000, pending: true },
    ]);
    expect(r.componentCents).toBe(0);
  });
  it("ignores posted purchase+redemption pairs and uses the newest unmatched purchase only", () => {
    const r = sweepComponent([
      { id: "p0", date: "2026-09-29", type: "purchase", amountCents: -10000, pending: false },
      { id: "r0", date: "2026-09-30", type: "redemption", amountCents: 10000, pending: false },
      { id: "p1", date: "2026-10-01", type: "purchase", amountCents: -20000, pending: false },
      { id: "p2", date: "2026-10-02", type: "purchase", amountCents: -30000, pending: false },
    ]);
    expect(r.componentCents).toBe(30000); // never sums p1 + p2
    expect(r.purchaseId).toBe("p2");
  });
  it("no sweep events → 0", () => {
    expect(sweepComponent([]).componentCents).toBe(0);
  });
});

describe("net worth and cash", () => {
  const accounts = [
    { id: "c", name: "Checking", kind: "checking" as const, balanceCents: 100000 },
    { id: "s", name: "Sweep", kind: "checking" as const, balanceCents: 0, availableBalanceCents: 20000, isSweep: true, sweepComponentCents: 50000 },
    { id: "cc", name: "Card", kind: "credit_card" as const, balanceCents: 30000 },
    { id: "b", name: "Brokerage", kind: "brokerage" as const, balanceCents: null },
  ];
  it("liabilities are stored positive and subtracted; null balances are reported missing, not guessed", () => {
    const nw = netWorth(accounts, [{ label: "51% stake", amountCents: null }, { label: "Car", amountCents: 500000 }]);
    expect(nw.liabilitiesCents).toBe(30000);
    expect(nw.assetsCents).toBe(100000 + 70000 + 500000);
    expect(nw.netCents).toBe(100000 + 70000 + 500000 - 30000);
    expect(nw.missing).toEqual(["Brokerage", "51% stake"]);
  });
  it("cash view is checking/savings only with sweep correction", () => {
    expect(cashView(accounts).cashCents).toBe(170000);
  });
});

describe("budget limits", () => {
  it("compares posted spend with the limit; rollover only when flagged", () => {
    const m = [line({ amountCents: -30000 }), line({ amountCents: -5000, pending: true })];
    const prev = [line({ amountCents: -10000, date: "2026-09-05" })];
    expect(budgetStatus({ id: "util", monthlyLimitCents: 40000, rollover: false }, m, prev)).toMatchObject({ spentCents: 30000, carryCents: 0, remainingCents: 10000, state: "ok" });
    expect(budgetStatus({ id: "util", monthlyLimitCents: 40000, rollover: true }, m, prev)).toMatchObject({ carryCents: 30000, availableCents: 70000 });
    expect(budgetStatus({ id: "util", monthlyLimitCents: null, rollover: false }, m, prev).state).toBe("none");
  });
});

describe("income expectations", () => {
  it("counts biweekly occurrences from an anchor date", () => {
    expect(occurrencesInMonth({ amountCents: 1, cadence: "biweekly", anchorDate: "2026-01-02" }, "2026-01")).toBe(3); // Jan 2, 16, 30
    expect(occurrencesInMonth({ amountCents: 1, cadence: "biweekly", anchorDate: "2026-01-02" }, "2026-02")).toBe(2);
    expect(expectedInMonth({ amountCents: 100, cadence: "semimonthly", anchorDate: null }, "2026-02")).toBe(200);
    expect(expectedInMonth({ amountCents: 100, cadence: "weekly", anchorDate: null }, "2026-02")).toBeNull();
    expect(occurrencesInMonth({ amountCents: 1, cadence: "quarterly", anchorDate: "2026-01-15" }, "2026-04")).toBe(1);
    expect(occurrencesInMonth({ amountCents: 1, cadence: "quarterly", anchorDate: "2026-01-15" }, "2026-05")).toBe(0);
  });
});

describe("recurring bills from matched charges only", () => {
  const bill = { amountMinCents: 9000, amountMaxCents: 11000, matchRules: { merchantPattern: "electric", dueDay: 20 } };
  it("paid when a posted charge matches", () => {
    expect(billStatus(bill, [line({ amountCents: -10000 })], "2026-10", "2026-10-25").status).toBe("paid");
  });
  it("pending charges do not count as paid", () => {
    expect(billStatus(bill, [line({ amountCents: -10000, pending: true })], "2026-10", "2026-10-25").status).toBe("overdue");
  });
  it("due before the due date, overdue after", () => {
    expect(billStatus(bill, [], "2026-10", "2026-10-10").status).toBe("due");
    expect(billStatus(bill, [], "2026-10", "2026-10-21").status).toBe("overdue");
  });
});

describe("goals", () => {
  it("has no progress until data exists; uses linked balances", () => {
    expect(goalProgress({ kind: "save", targetAmountCents: 100000, linkedAccountIds: [], fundedAmountCents: null, baselineCents: null }, []).source).toBe("none");
    const p = goalProgress({ kind: "save", targetAmountCents: 100000, linkedAccountIds: ["s"], fundedAmountCents: null, baselineCents: null }, [{ id: "s", name: "S", kind: "savings", balanceCents: 25000 }]);
    expect(p.pct).toBe(0.25);
    const d = goalProgress({ kind: "debt", targetAmountCents: 50000, linkedAccountIds: ["l"], fundedAmountCents: null, baselineCents: 50000 }, [{ id: "l", name: "L", kind: "loan", balanceCents: 40000 }]);
    expect(d.progressCents).toBe(10000);
  });
});
