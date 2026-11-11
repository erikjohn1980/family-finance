import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeDb } from "@/db";
import { auditEvents, bankTransactions, categories, goals, ledgerOverrides, netWorthManualAssets } from "@/db/schema";
import { importCsv, runPendingMatch } from "@/lib/import/csvImport";
import { loadLedger } from "@/lib/data/ledger";
import { needsCategory, spendPosted } from "@/lib/calc/ledger";
import { resetDb, setupHousehold } from "./helpers";

const HEADER = "external_id,account,posted_at,amount,merchant,pending,pending_id";
const fileA = [HEADER, "t1,Demo Checking,2026-10-01,-42.10,Corner Bakery 12,false,", "t2,Demo Checking,2026-10-02,-15.00,Sample Cafe,false,", "p3,Demo Checking,2026-10-03,-60.00,FUEL STOP 9,true,"].join("\n");

describe("CSV import (Postgres)", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("is idempotent: same file and same external_id never duplicate rows", async () => {
    const { db, h, erik } = await setupHousehold();
    const a = await importCsv(db, { householdId: h.id, actorId: erik.id, fileName: "a.csv", text: fileA, today: "2026-10-04" });
    expect(a).toMatchObject({ status: "imported", inserted: 3, duplicates: 0, accountsCreated: 1 });
    const again = await importCsv(db, { householdId: h.id, actorId: erik.id, fileName: "a.csv", text: fileA });
    expect(again.status).toBe("duplicate_file");
    // Different file (extra row) that repeats the same external ids.
    const b = await importCsv(db, { householdId: h.id, actorId: erik.id, fileName: "b.csv", text: fileA + "\nt4,Demo Checking,2026-10-04,-5.00,Kiosk,false,", today: "2026-10-04" });
    expect(b).toMatchObject({ inserted: 1, duplicates: 3 });
    const [{ n }] = await db.execute<{ n: number }>(sql`select count(*)::int as n from bank_transaction`);
    expect(n).toBe(4);
  });

  it("bank rows are immutable at the database level", async () => {
    const { db, h, erik } = await setupHousehold();
    await importCsv(db, { householdId: h.id, actorId: erik.id, fileName: "a.csv", text: fileA });
    await expect(db.update(bankTransactions).set({ merchantRaw: "changed" })).rejects.toThrow();
    await expect(db.delete(bankTransactions)).rejects.toThrow();
  });

  it("category override survives re-import and pending → posted match", async () => {
    const { db, h, erik, g } = await setupHousehold();
    await importCsv(db, { householdId: h.id, actorId: erik.id, fileName: "a.csv", text: fileA, today: "2026-10-04" });
    const [fuel] = await db.select().from(categories).where(and(eq(categories.householdId, h.id), eq(categories.name, "Fuel")));
    const [pending] = await db.select().from(bankTransactions).where(eq(bankTransactions.externalId, "p3"));
    await db.insert(ledgerOverrides).values({ householdId: h.id, bankTxId: pending.id, categoryId: fuel.id, splitGroup: "g1", actorId: g.id });

    // Posted twin arrives with a different external id and a slightly different merchant string.
    const fileC = [HEADER, "t1,Demo Checking,2026-10-01,-42.10,Corner Bakery 12,false,", "t5,Demo Checking,2026-10-05,-60.00,FUEL STOP #9,false,"].join("\n");
    const c = await importCsv(db, { householdId: h.id, actorId: erik.id, fileName: "c.csv", text: fileC, today: "2026-10-06" });
    expect(c).toMatchObject({ inserted: 1, duplicates: 1, pendingMatched: 1 });

    const data = await loadLedger(db, h.id, { start: "2026-10-01", end: "2026-10-31" }, "2026-10-06");
    const posted = data.lines.find((l) => l.merchant === "FUEL STOP #9")!;
    expect(posted.categoryId).toBe(fuel.id);
    expect(posted.categorySource).toBe("carried");
    expect(data.lines.some((l) => l.pending)).toBe(false); // pending superseded
    expect(spendPosted(data.lines)).toBe(4210 + 1500 + 6000);
    expect(needsCategory(data.lines).map((n) => n.merchant).sort()).toEqual(["Corner Bakery 12", "Sample Cafe"]);

    // Re-running the match job is a no-op and keeps the override.
    expect(await runPendingMatch(db, h.id, [posted.accountId!], "2026-10-06")).toBe(0);
    const again = await loadLedger(db, h.id, { start: "2026-10-01", end: "2026-10-31" }, "2026-10-06");
    expect(again.lines.find((l) => l.merchant === "FUEL STOP #9")!.categoryId).toBe(fuel.id);
  });

  it("goals and limits survive refresh (import + match) jobs", async () => {
    const { db, h, erik } = await setupHousehold();
    const [groc] = await db.update(categories).set({ monthlyLimitCents: 60000 }).where(and(eq(categories.householdId, h.id), eq(categories.name, "Groceries"))).returning();
    await db.insert(goals).values({ householdId: h.id, kind: "save", title: "Emergency fund", targetAmountCents: 1000000 });
    await importCsv(db, { householdId: h.id, actorId: erik.id, fileName: "a.csv", text: fileA });
    await importCsv(db, { householdId: h.id, actorId: erik.id, fileName: "a2.csv", text: fileA + "\n" });
    const [g2] = await db.select().from(categories).where(eq(categories.id, groc.id));
    expect(g2.monthlyLimitCents).toBe(60000);
    expect((await db.select().from(goals)).length).toBe(1);
  });

  it("excludes Katapult accounts and charges; no Katapult asset exists", async () => {
    const { db, h, erik } = await setupHousehold();
    const text = [HEADER, "k1,Katapult Operating,2026-10-01,-10.00,Vendor,false,", "k2,Demo Checking,2026-10-01,-10.00,KATAPULT EVENTS LLC,false,", "ok,Demo Checking,2026-10-01,-1.00,Kiosk,false,"].join("\n");
    const r = await importCsv(db, { householdId: h.id, actorId: erik.id, fileName: "k.csv", text });
    expect(r).toMatchObject({ inserted: 1, excludedByPolicy: 2 });
    expect(await db.select().from(netWorthManualAssets).where(eq(netWorthManualAssets.householdId, h.id))).toHaveLength(0);
    const rows = await db.select().from(bankTransactions);
    expect(rows.some((t) => /katapult/i.test(t.merchantRaw))).toBe(false);
  });

  it("rejects files missing required columns and reports bad rows", async () => {
    const { db, h, erik } = await setupHousehold();
    expect((await importCsv(db, { householdId: h.id, actorId: erik.id, fileName: "x.csv", text: "a,b\n1,2" })).status).toBe("rejected");
    const r = await importCsv(db, { householdId: h.id, actorId: erik.id, fileName: "y.csv", text: `${HEADER}\nz1,Demo Checking,not-a-date,-1,Kiosk,false,` });
    expect(r.errors[0].line).toBe(2);
    expect(r.inserted).toBe(0);
  });

  it("balances CSV stores liabilities positive and audits", async () => {
    const { db, h, erik } = await setupHousehold();
    const r = await importCsv(db, { householdId: h.id, actorId: erik.id, fileName: "bal.csv", text: "account,kind,balance,as_of\nDemo Card,credit_card,-512.30,2026-10-01\nDemo Savings,savings,1000,2026-10-01" });
    expect(r).toMatchObject({ kind: "balances", balancesUpdated: 2 });
    const data = await loadLedger(db, h.id);
    expect(data.accounts.find((a) => a.name === "Demo Card")!.balanceCents).toBe(51230);
    const events = await db.select().from(auditEvents).where(eq(auditEvents.action, "balance_import"));
    expect(events).toHaveLength(2);
  });
});
