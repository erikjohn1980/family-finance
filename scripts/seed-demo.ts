/**
 * Loads FICTIONAL demo data. Never use real financial data in a demo.
 * Guards: DEMO_MODE=true is required; NODE_ENV=production is refused; a non-local database
 * additionally requires DEMO_SEED_CONFIRM=<database name>.
 * Amounts, merchants and accounts below are invented examples ("Demo …", "Sample …").
 */
import { and, eq } from "drizzle-orm";
import { closeDb, getDb } from "../src/db";
import { bankTransactions, categories, finAccounts, goals, householdMembers, incomeExpectations, manualTransactions, recurringBills, users } from "../src/db/schema";
import { bootstrapHousehold, getHousehold } from "../src/lib/household";
import { importCsv } from "../src/lib/import/csvImport";
import { addDays, addMonths, monthKey, todayIso } from "../src/lib/dates";

const url = process.env.DATABASE_URL ?? "";
if (process.env.DEMO_MODE !== "true") throw new Error("Refusing to seed: set DEMO_MODE=true (demo instances only).");
if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed with NODE_ENV=production.");
const local = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);
const dbName = url.split("/").pop()?.split("?")[0];
if (!local && process.env.DEMO_SEED_CONFIRM !== dbName) throw new Error(`Refusing to seed a non-local database. Set DEMO_SEED_CONFIRM=${dbName} if this is a dedicated demo database.`);

const db = getDb();
const adminEmail = (process.env.HOUSEHOLD_ADMIN_EMAIL || "erik@example.test").toLowerCase();
const memberEmail = (process.env.DEMO_MEMBER_EMAIL || "g@example.test").toLowerCase();

async function user(email: string, name: string) {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  return u ?? (await db.insert(users).values({ email, name }).returning())[0];
}

const erik = await user(adminEmail, "Erik");
const g = await user(memberEmail, "G");
const h = (await getHousehold(db)) ?? (await bootstrapHousehold(db, erik.id));
await db.insert(householdMembers).values({ householdId: h.id, userId: erik.id, role: "admin" }).onConflictDoNothing();
await db.insert(householdMembers).values({ householdId: h.id, userId: g.id, role: "member" }).onConflictDoNothing();

const today = todayIso();
const thisMonth = monthKey(today);
const day = (m: string, d: number) => `${m}-${String(d).padStart(2, "0")}`;
const months = [addMonths(thisMonth, -3), addMonths(thisMonth, -2), addMonths(thisMonth, -1), thisMonth];

// Balances (fictional)
await importCsv(db, {
  householdId: h.id,
  actorId: erik.id,
  fileName: "demo-balances.csv",
  text: [
    "account,kind,balance,available_balance,as_of,mask_last4,scope,is_sweep",
    `Demo Checking,checking,4210.55,,${today},0001,household,false`,
    `Demo Savings,savings,8150.00,,${today},0002,household,false`,
    `Demo Card,credit_card,-1284.19,,${today},0003,household,false`,
    `Demo Brokerage,brokerage,23500.00,,${addDays(today, -6)},0004,household,false`,
    `Demo Sweep Checking,checking,0,1900.00,${today},0005,household,true`,
    `Demo OAL Operating,checking,3100.00,,${addDays(today, -5)},0006,business,false`,
  ].join("\n"),
});
await db.update(finAccounts).set({ businessUnit: "OAL" }).where(and(eq(finAccounts.householdId, h.id), eq(finAccounts.name, "Demo OAL Operating")));

// Transactions (fictional)
const rows: string[] = ["external_id,account,posted_at,amount,merchant,pending,pending_id,category,sweep_type,account_kind"];
let n = 0;
const add = (acct: string, date: string, amt: string, merchant: string, opts: { pending?: boolean; pendingId?: string; category?: string; sweep?: string; kind?: string } = {}) => {
  if (date > today) return;
  rows.push([`demo-${++n}`, acct, date, amt, merchant, opts.pending ? "true" : "false", opts.pendingId ?? "", opts.category ?? "", opts.sweep ?? "", opts.kind ?? ""].join(","));
};
for (const m of months) {
  add("Demo Checking", day(m, 1), "3200.00", "SAMPLE EMPLOYER PAYROLL", { category: "Salary" });
  add("Demo Checking", day(m, 15), "3200.00", "SAMPLE EMPLOYER PAYROLL", { category: "Salary" });
  add("Demo Checking", day(m, 2), "-1850.00", "SAMPLE PROPERTY MGMT RENT", { category: "Rent / Mortgage" });
  add("Demo Checking", day(m, 18), "-96.40", "SAMPLE ELECTRIC UTILITY", { category: "Utilities" });
  add("Demo Card", day(m, 4), "-128.33", "SAMPLE GROCER #12", { category: "Groceries", kind: "credit_card" });
  add("Demo Card", day(m, 11), "-87.10", "SAMPLE GROCER #12", { category: "Groceries", kind: "credit_card" });
  add("Demo Card", day(m, 9), "-54.00", "SAMPLE FUEL STOP", { category: "Fuel", kind: "credit_card" });
  add("Demo Card", day(m, 13), "-42.75", "SAMPLE BISTRO", { category: "Dining", kind: "credit_card" });
  add("Demo Checking", day(m, 20), "-900.00", "PAYMENT TO DEMO CARD", { category: "Card payment" });
  add("Demo Card", day(m, 20), "900.00", "PAYMENT RECEIVED THANK YOU", { category: "Card payment", kind: "credit_card" });
  add("Demo Checking", day(m, 22), "-500.00", "TRANSFER TO DEMO SAVINGS", { category: "Transfer" });
  add("Demo Savings", day(m, 22), "500.00", "TRANSFER FROM DEMO CHECKING", { category: "Transfer", kind: "savings" });
}
// Current-month items that need attention (uncategorized, refund, pending)
add("Demo Card", day(thisMonth, 3), "-23.99", "SAMPLE STREAMING CO", { kind: "credit_card" });
add("Demo Card", day(thisMonth, 3), "-61.20", "SAMPLE HARDWARE DEPOT", { kind: "credit_card" });
add("Demo Card", day(thisMonth, 4), "18.50", "SAMPLE GROCER #12 REFUND", { category: "Groceries", kind: "credit_card" });
add("Demo Card", addDays(today, -1), "-34.80", "SAMPLE BAKERY 7", { pending: true, kind: "credit_card" });
add("Demo Card", addDays(today, -1), "-15.00", "SAMPLE PARKING", { pending: true, category: "Transit & Parking", kind: "credit_card" });
add("Demo Sweep Checking", addDays(today, -1), "-1200.00", "OVERNIGHT SWEEP PURCHASE", { sweep: "purchase", category: "Transfer" });

const r = await importCsv(db, { householdId: h.id, actorId: erik.id, fileName: "demo-transactions.csv", text: rows.join("\n") });
console.log("transactions:", r.status, r.inserted, "inserted", r.duplicates, "dupes");

const cat = async (name: string) => (await db.select().from(categories).where(and(eq(categories.householdId, h.id), eq(categories.name, name))))[0];
const groceries = await cat("Groceries");
const dining = await cat("Dining");
const salary = await cat("Salary");
await db.update(categories).set({ monthlyLimitCents: 45000 }).where(eq(categories.id, groceries.id));
await db.update(categories).set({ monthlyLimitCents: 15000 }).where(eq(categories.id, dining.id));

const [hasManual] = await db.select().from(manualTransactions).where(eq(manualTransactions.householdId, h.id)).limit(1);
if (!hasManual) {
  await db.insert(manualTransactions).values([
    { householdId: h.id, amountCents: -1200, merchant: "Demo farmers market (cash)", categoryId: groceries.id, occurredAt: day(thisMonth, 2) > today ? today : day(thisMonth, 2), actorId: g.id },
    { householdId: h.id, amountCents: -800, merchant: "Demo school bake sale (cash)", categoryId: null, occurredAt: today, actorId: g.id },
  ]);
}
const [hasIncome] = await db.select().from(incomeExpectations).where(eq(incomeExpectations.householdId, h.id)).limit(1);
if (!hasIncome) await db.insert(incomeExpectations).values({ householdId: h.id, label: "Demo base pay", amountCents: 320000, cadence: "semimonthly", categoryId: salary.id });

const [hasBill] = await db.select().from(recurringBills).where(eq(recurringBills.householdId, h.id)).limit(1);
if (!hasBill) {
  const verify = async (merchant: string) => {
    const [t] = await db.select().from(bankTransactions).where(and(eq(bankTransactions.householdId, h.id), eq(bankTransactions.merchantRaw, merchant))).limit(1);
    return `bank:${t.id}`;
  };
  await db.insert(recurringBills).values([
    { householdId: h.id, label: "Demo rent", amountMinCents: 180000, amountMaxCents: 190000, matchRules: { merchantPattern: "property mgmt rent", dueDay: 3 }, verifiedByTxId: await verify("SAMPLE PROPERTY MGMT RENT") },
    { householdId: h.id, label: "Demo electric", amountMinCents: 6000, amountMaxCents: 15000, matchRules: { merchantPattern: "electric utility", dueDay: 20 }, verifiedByTxId: await verify("SAMPLE ELECTRIC UTILITY") },
  ]);
}
const [hasGoal] = await db.select().from(goals).where(eq(goals.householdId, h.id)).limit(1);
if (!hasGoal) {
  const [sav] = await db.select().from(finAccounts).where(and(eq(finAccounts.householdId, h.id), eq(finAccounts.name, "Demo Savings")));
  await db.insert(goals).values({ householdId: h.id, kind: "save", title: "Demo emergency fund", targetAmountCents: 1500000, targetDate: `${Number(thisMonth.slice(0, 4)) + 1}-06-30`, linkedAccountIds: [sav.id] });
}
console.log("demo seed complete (fictional data)");
await closeDb();
