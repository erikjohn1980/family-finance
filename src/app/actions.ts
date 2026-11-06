"use server";
/**
 * Server actions — every write in the app. Each action:
 *   1. re-checks household membership (401/403) on the server,
 *   2. validates input,
 *   3. writes inside a DB transaction together with an audit_event.
 * No action moves money, pays bills, issues refunds, or changes bank settings.
 */
import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  bankTransactions,
  categories,
  finAccounts,
  goals,
  householdMembers,
  incomeExpectations,
  invites,
  ledgerOverrides,
  manualTransactions,
  merchantRules,
  netWorthManualAssets,
  recurringBills,
  userPrefs,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { HttpError, requireActionMember, requireAdmin, type MemberContext } from "@/lib/session";
import { parseMoneyToCents } from "@/lib/money";
import { isValidDate } from "@/lib/dates";
import { importCsv } from "@/lib/import/csvImport";
import { KATAPULT_STAKE_KEY, isExcludedByPolicy } from "@/lib/policy";
import { normEmail } from "@/lib/household";
import { billMatches } from "@/lib/calc/planning";
import { rulePatternFor } from "@/lib/rules";
import type { ActionResult } from "@/components/forms";
import type { EffectiveLine } from "@/lib/calc/ledger";
import { signOut } from "@/auth";

class UserError extends Error {}

async function run(fn: () => Promise<string | void>): Promise<ActionResult> {
  try {
    const ok = await fn();
    return { ok: ok ?? "Saved", at: Date.now() };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof UserError || e instanceof HttpError) return { error: e.message, at: Date.now() };
    console.error(e);
    return { error: "Something went wrong. Nothing was saved.", at: Date.now() };
  }
}

// ---------- input helpers ----------
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const opt = (fd: FormData, k: string) => s(fd, k) || null;
const req = (fd: FormData, k: string, label = k) => {
  const v = s(fd, k);
  if (!v) throw new UserError(`${label} is required`);
  return v;
};
const money = (fd: FormData, k: string, label = k): number | null => {
  const raw = s(fd, k);
  if (!raw) return null;
  const c = parseMoneyToCents(raw);
  if (c === null) throw new UserError(`${label}: enter an amount like 123.45`);
  return c;
};
const reqMoney = (fd: FormData, k: string, label = k) => {
  const c = money(fd, k, label);
  if (c === null) throw new UserError(`${label} is required`);
  return c;
};
const date = (fd: FormData, k: string, label = k, required = true) => {
  const v = s(fd, k);
  if (!v && !required) return null;
  if (!isValidDate(v)) throw new UserError(`${label}: use a valid date`);
  return v;
};
const oneOf = <T extends string>(v: string, allowed: readonly T[], label: string): T => {
  if (!allowed.includes(v as T)) throw new UserError(`${label} is invalid`);
  return v as T;
};
const SCOPES = ["household", "business", "trust"] as const;
const ACCOUNT_KINDS = ["checking", "savings", "credit_card", "loan", "brokerage", "retirement", "real_estate", "vehicle", "other_asset"] as const;
const CAT_KINDS = ["expense", "income", "transfer", "card_payment", "excluded"] as const;
const CADENCES = ["weekly", "biweekly", "semimonthly", "monthly", "quarterly", "annual"] as const;

async function ownedCategory(ctx: MemberContext, id: string | null) {
  if (!id) return null;
  const [c] = await getDb().select().from(categories).where(and(eq(categories.id, id), eq(categories.householdId, ctx.householdId)));
  if (!c) throw new UserError("Unknown category");
  return c;
}
async function ownedAccount(ctx: MemberContext, id: string | null) {
  if (!id) return null;
  const [a] = await getDb().select().from(finAccounts).where(and(eq(finAccounts.id, id), eq(finAccounts.householdId, ctx.householdId)));
  if (!a) throw new UserError("Unknown account");
  return a;
}
function revalidateAll() {
  revalidatePath("/", "layout");
}

// ---------- preferences (filters persist across reloads) ----------
export async function setPref(key: string, value: unknown) {
  const ctx = await requireActionMember();
  if (!/^[a-z][a-z0-9_.-]{0,40}$/.test(key)) throw new HttpError(400, "bad key");
  const json = JSON.parse(JSON.stringify(value ?? null));
  await getDb()
    .insert(userPrefs)
    .values({ userId: ctx.userId, key, value: json })
    .onConflictDoUpdate({ target: [userPrefs.userId, userPrefs.key], set: { value: json, updatedAt: new Date() } });
}

// ---------- manual transactions ----------
function manualFields(fd: FormData) {
  const direction = oneOf(s(fd, "direction") || "expense", ["expense", "income"] as const, "Type");
  const amount = reqMoney(fd, "amount", "Amount");
  if (amount === 0) throw new UserError("Amount cannot be zero");
  const merchant = req(fd, "merchant", "Merchant / description").slice(0, 200);
  if (isExcludedByPolicy(merchant)) throw new UserError("Katapult charges are excluded from Family Finance.");
  return {
    amountCents: direction === "expense" ? -Math.abs(amount) : Math.abs(amount),
    merchant,
    occurredAt: date(fd, "occurredAt", "Date")!,
    categoryId: opt(fd, "categoryId"),
    accountId: opt(fd, "accountId"),
    scope: oneOf(s(fd, "scope") || "household", SCOPES, "Scope"),
    memo: opt(fd, "memo")?.slice(0, 500) ?? null,
  };
}

export async function createManualTx(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let newId = "";
  const r = await run(async () => {
    const ctx = await requireActionMember();
    const f = manualFields(fd);
    await ownedCategory(ctx, f.categoryId);
    await ownedAccount(ctx, f.accountId);
    await getDb().transaction(async (tx) => {
      const [row] = await tx.insert(manualTransactions).values({ ...f, householdId: ctx.householdId, actorId: ctx.userId }).returning();
      newId = row.id;
      await audit(tx, { householdId: ctx.householdId, actorId: ctx.userId, entity: "manual_transaction", entityId: row.id, action: "create", after: row });
    });
    revalidateAll();
  });
  if (r?.error) return r;
  redirect(`/transactions/manual/${newId}?created=1`);
}

export async function updateManualTx(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireActionMember();
    const id = req(fd, "id");
    const f = manualFields(fd);
    await ownedCategory(ctx, f.categoryId);
    await ownedAccount(ctx, f.accountId);
    await getDb().transaction(async (tx) => {
      const [before] = await tx.select().from(manualTransactions).where(and(eq(manualTransactions.id, id), eq(manualTransactions.householdId, ctx.householdId), isNull(manualTransactions.deletedAt)));
      if (!before) throw new UserError("Transaction not found");
      const [after] = await tx.update(manualTransactions).set({ ...f, updatedAt: new Date() }).where(eq(manualTransactions.id, id)).returning();
      await audit(tx, { householdId: ctx.householdId, actorId: ctx.userId, entity: "manual_transaction", entityId: id, action: "update", before, after });
    });
    revalidateAll();
    return "Transaction updated";
  });
}

export async function deleteManualTx(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const r = await run(async () => {
    const ctx = await requireActionMember();
    const id = req(fd, "id");
    await getDb().transaction(async (tx) => {
      const [before] = await tx.select().from(manualTransactions).where(and(eq(manualTransactions.id, id), eq(manualTransactions.householdId, ctx.householdId), isNull(manualTransactions.deletedAt)));
      if (!before) throw new UserError("Transaction not found");
      await tx.update(manualTransactions).set({ deletedAt: new Date() }).where(eq(manualTransactions.id, id));
      await audit(tx, { householdId: ctx.householdId, actorId: ctx.userId, entity: "manual_transaction", entityId: id, action: "delete", before });
    });
    revalidateAll();
  });
  if (r?.error) return r;
  redirect("/transactions?deleted=1");
}

// ---------- categorization (overrides never mutate bank rows) ----------
async function ownedBankTx(ctx: MemberContext, id: string) {
  const [t] = await getDb().select().from(bankTransactions).where(and(eq(bankTransactions.id, id), eq(bankTransactions.householdId, ctx.householdId)));
  if (!t) throw new UserError("Bank transaction not found");
  return t;
}

async function suggestRule(ctx: MemberContext, merchant: string, categoryId: string) {
  const pattern = rulePatternFor(merchant);
  if (pattern.length < 3) return false;
  const db = getDb();
  const [exists] = await db
    .select({ id: merchantRules.id })
    .from(merchantRules)
    .where(and(eq(merchantRules.householdId, ctx.householdId), eq(merchantRules.pattern, pattern), isNull(merchantRules.rejectedAt)));
  if (exists) return false;
  await db.transaction(async (tx) => {
    const [rule] = await tx.insert(merchantRules).values({ householdId: ctx.householdId, pattern, categoryId, suggestedBy: ctx.userId }).returning();
    await audit(tx, { householdId: ctx.householdId, actorId: ctx.userId, entity: "merchant_rule", entityId: rule.id, action: "suggest", after: rule });
  });
  return true;
}

export async function categorizeBankTx(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireActionMember();
    const t = await ownedBankTx(ctx, req(fd, "txId"));
    const categoryId = opt(fd, "categoryId");
    const memo = opt(fd, "memo")?.slice(0, 500) ?? null;
    if (!categoryId && !memo) throw new UserError("Choose a category");
    await ownedCategory(ctx, categoryId);
    await getDb().transaction(async (tx) => {
      const prev = await tx.select().from(ledgerOverrides).where(eq(ledgerOverrides.bankTxId, t.id));
      const [o] = await tx
        .insert(ledgerOverrides)
        .values({ householdId: ctx.householdId, bankTxId: t.id, categoryId, memo, splitGroup: crypto.randomUUID(), actorId: ctx.userId })
        .returning();
      await audit(tx, {
        householdId: ctx.householdId,
        actorId: ctx.userId,
        entity: "bank_transaction",
        entityId: t.id,
        action: "categorize",
        before: prev.length ? prev.sort((a, b) => +b.createdAt - +a.createdAt)[0] : null,
        after: o,
      });
    });
    let suggested = false;
    if (categoryId && fd.get("suggestRule") === "on") suggested = await suggestRule(ctx, t.merchantRaw, categoryId);
    revalidateAll();
    return suggested ? "Categorized. Merchant rule suggested — the owner confirms it in Settings." : "Categorized";
  });
}

export async function splitBankTx(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireActionMember();
    const t = await ownedBankTx(ctx, req(fd, "txId"));
    const parts: { categoryId: string; cents: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const cat = s(fd, `cat_${i}`);
      const amt = money(fd, `amt_${i}`, `Split ${i + 1} amount`);
      if (!cat && amt === null) continue;
      if (!cat || amt === null || amt === 0) throw new UserError(`Split ${i + 1} needs a category and a non-zero amount`);
      await ownedCategory(ctx, cat);
      parts.push({ categoryId: cat, cents: Math.abs(amt) });
    }
    if (parts.length < 2) throw new UserError("A split needs at least two parts");
    const total = parts.reduce((a, p) => a + p.cents, 0);
    if (total !== Math.abs(t.amountCents)) throw new UserError(`Split parts must add up to ${(Math.abs(t.amountCents) / 100).toFixed(2)} (currently ${(total / 100).toFixed(2)})`);
    const sign = Math.sign(t.amountCents) || -1;
    const group = crypto.randomUUID();
    await getDb().transaction(async (tx) => {
      const rows = await tx
        .insert(ledgerOverrides)
        .values(parts.map((p) => ({ householdId: ctx.householdId, bankTxId: t.id, categoryId: p.categoryId, splitGroup: group, splitAmountCents: sign * p.cents, actorId: ctx.userId })))
        .returning();
      await audit(tx, { householdId: ctx.householdId, actorId: ctx.userId, entity: "bank_transaction", entityId: t.id, action: "split", after: rows });
    });
    revalidateAll();
    return `Split into ${parts.length} parts`;
  });
}

export async function categorizeManualTx(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireActionMember();
    const id = req(fd, "txId");
    const categoryId = req(fd, "categoryId", "Category");
    await ownedCategory(ctx, categoryId);
    await getDb().transaction(async (tx) => {
      const [before] = await tx.select().from(manualTransactions).where(and(eq(manualTransactions.id, id), eq(manualTransactions.householdId, ctx.householdId)));
      if (!before) throw new UserError("Transaction not found");
      const [after] = await tx.update(manualTransactions).set({ categoryId, updatedAt: new Date() }).where(eq(manualTransactions.id, id)).returning();
      await audit(tx, { householdId: ctx.householdId, actorId: ctx.userId, entity: "manual_transaction", entityId: id, action: "categorize", before, after });
    });
    revalidateAll();
    return "Categorized";
  });
}

// ---------- merchant rules (owner confirmation required) ----------
export async function decideRule(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireAdmin();
    const id = req(fd, "id");
    const decision = oneOf(s(fd, "decision"), ["confirm", "reject"] as const, "Decision");
    await getDb().transaction(async (tx) => {
      const [before] = await tx.select().from(merchantRules).where(and(eq(merchantRules.id, id), eq(merchantRules.householdId, ctx.householdId)));
      if (!before) throw new UserError("Rule not found");
      const set = decision === "confirm" ? { confirmedBy: ctx.userId, confirmedAt: new Date(), rejectedAt: null } : { rejectedAt: new Date(), confirmedAt: null, confirmedBy: null };
      const [after] = await tx.update(merchantRules).set(set).where(eq(merchantRules.id, id)).returning();
      await audit(tx, { householdId: ctx.householdId, actorId: ctx.userId, entity: "merchant_rule", entityId: id, action: decision, before, after });
    });
    revalidateAll();
    return decision === "confirm" ? "Rule confirmed and applied" : "Rule rejected";
  });
}

// ---------- categories & limits ----------
export async function saveCategory(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireActionMember();
    const id = opt(fd, "id");
    const db = getDb();
    const limit = money(fd, "monthlyLimit", "Monthly limit");
    if (limit !== null && limit < 0) throw new UserError("Monthly limit cannot be negative");
    const patch: Partial<typeof categories.$inferInsert> = {};
    if (fd.has("monthlyLimit")) patch.monthlyLimitCents = limit;
    if (fd.has("rolloverPresent")) patch.rollover = fd.get("rollover") === "on";
    if (fd.has("name")) patch.name = req(fd, "name", "Name").slice(0, 60);
    if (fd.has("group")) patch.group = req(fd, "group", "Group").slice(0, 60);
    if (fd.has("kind")) patch.kind = oneOf(s(fd, "kind"), CAT_KINDS, "Kind");
    try {
      await db.transaction(async (tx) => {
        if (id) {
          const [before] = await tx.select().from(categories).where(and(eq(categories.id, id), eq(categories.householdId, ctx.householdId)));
          if (!before) throw new UserError("Category not found");
          const [after] = await tx.update(categories).set(patch).where(eq(categories.id, id)).returning();
          await audit(tx, { householdId: ctx.householdId, actorId: ctx.userId, entity: "category", entityId: id, action: "update", before, after });
        } else {
          const [row] = await tx
            .insert(categories)
            .values({ householdId: ctx.householdId, name: patch.name ?? req(fd, "name"), group: patch.group ?? req(fd, "group"), kind: patch.kind ?? "expense", monthlyLimitCents: patch.monthlyLimitCents ?? null, rollover: patch.rollover ?? false })
            .returning();
          await audit(tx, { householdId: ctx.householdId, actorId: ctx.userId, entity: "category", entityId: row.id, action: "create", after: row });
        }
      });
    } catch (e) {
      if ((e as { code?: string }).code === "23505" || String((e as Error).message).includes("category_name_uq")) throw new UserError("A category with that group and name already exists");
      throw e;
    }
    revalidateAll();
    return id ? "Category saved" : "Category added";
  });
}

export async function approveProposedCategories(_: ActionResult, _fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireAdmin();
    await getDb().transaction(async (tx) => {
      const rows = await tx.update(categories).set({ proposed: false }).where(and(eq(categories.householdId, ctx.householdId), eq(categories.proposed, true))).returning({ id: categories.id });
      await audit(tx, { householdId: ctx.householdId, actorId: ctx.userId, entity: "category", entityId: "*", action: "approve_defaults", after: { count: rows.length } });
    });
    revalidateAll();
    return "Default categories approved";
  });
}

export async function archiveCategory(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireActionMember();
    const id = req(fd, "id");
    await getDb().transaction(async (tx) => {
      const [before] = await tx.select().from(categories).where(and(eq(categories.id, id), eq(categories.householdId, ctx.householdId)));
      if (!before) throw new UserError("Category not found");
      await tx.update(categories).set({ archived: true }).where(eq(categories.id, id));
      await audit(tx, { householdId: ctx.householdId, actorId: ctx.userId, entity: "category", entityId: id, action: "archive", before });
    });
    revalidateAll();
    return "Category archived";
  });
}

// ---------- accounts ----------
export async function saveAccount(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireActionMember();
    const id = opt(fd, "id");
    const name = req(fd, "name", "Name").slice(0, 80);
    if (isExcludedByPolicy(name)) throw new UserError("Katapult accounts are excluded. Use the 51% cleared-cash stake in Settings instead.");
    const kind = oneOf(s(fd, "kind"), ACCOUNT_KINDS, "Kind");
    const scope = oneOf(s(fd, "scope") || "household", SCOPES, "Scope");
    const balance = money(fd, "balance", "Balance");
    const available = money(fd, "available", "Available balance");
    const mask = (s(fd, "maskLast4").replace(/\D/g, "") || null)?.slice(-4) ?? null;
    if (s(fd, "maskLast4") && s(fd, "maskLast4").replace(/\D/g, "").length > 4) throw new UserError("Only the last four digits may be stored");
    const isLiab = kind === "credit_card" || kind === "loan";
    const patch = {
      name,
      kind,
      scope,
      businessUnit: scope === "business" ? opt(fd, "businessUnit") : null,
      maskLast4: mask,
      isSweep: fd.get("isSweep") === "on",
      includeInHouseholdOverview: scope === "business" && fd.get("includeInHouseholdOverview") === "on",
      staleAfterHours: Math.max(1, Math.min(24 * 90, Number(s(fd, "staleAfterHours") || 72) || 72)),
    };
    const balanceProvided = s(fd, "balance") !== "";
    const asOf = date(fd, "asOf", "Balance as-of date", false);
    const balancePatch = balanceProvided
      ? { balanceCents: isLiab ? Math.abs(balance!) : balance, availableBalanceCents: available, balanceAsOf: asOf ? new Date(asOf + "T12:00:00Z") : new Date() }
      : {};
    try {
      await getDb().transaction(async (tx) => {
        if (id) {
          const [before] = await tx.select().from(finAccounts).where(and(eq(finAccounts.id, id), eq(finAccounts.householdId, ctx.householdId)));
          if (!before) throw new UserError("Account not found");
          const [after] = await tx.update(finAccounts).set({ ...patch, ...balancePatch }).where(eq(finAccounts.id, id)).returning();
          await audit(tx, { householdId: ctx.householdId, actorId: ctx.userId, entity: "fin_account", entityId: id, action: "update", before, after });
        } else {
          const [row] = await tx.insert(finAccounts).values({ ...patch, ...balancePatch, householdId: ctx.householdId, source: "manual" }).returning();
          await audit(tx, { householdId: ctx.householdId, actorId: ctx.userId, entity: "fin_account", entityId: row.id, action: "create", after: row });
        }
      });
    } catch (e) {
      if (String((e as Error).message).includes("fin_account_name_uq") || (e as { code?: string }).code === "23505") throw new UserError("An account with that name already exists");
      throw e;
    }
    revalidateAll();
    return id ? "Account saved" : "Account added";
  });
}

export async function archiveAccount(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireActionMember();
    const id = req(fd, "id");
    await getDb().transaction(async (tx) => {
      const [before] = await tx.select().from(finAccounts).where(and(eq(finAccounts.id, id), eq(finAccounts.householdId, ctx.householdId)));
      if (!before) throw new UserError("Account not found");
      await tx.update(finAccounts).set({ archived: !before.archived }).where(eq(finAccounts.id, id));
      await audit(tx, { householdId: ctx.householdId, actorId: ctx.userId, entity: "fin_account", entityId: id, action: before.archived ? "unarchive" : "archive", before });
    });
    revalidateAll();
    return "Account updated";
  });
}

// ---------- income expectations ----------
export async function saveIncomeExpectation(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireActionMember();
    const id = opt(fd, "id");
    const cadence = oneOf(s(fd, "cadence") || "monthly", CADENCES, "Cadence");
    const anchorDate = date(fd, "anchorDate", "Anchor pay date", false);
    if (["weekly", "biweekly", "quarterly", "annual"].includes(cadence) && !anchorDate) throw new UserError("This cadence needs a known pay date to count occurrences per month");
    const amount = reqMoney(fd, "amount", "Amount");
    if (amount <= 0) throw new UserError("Expected amount must be positive");
    const categoryId = opt(fd, "categoryId");
    const cat = await ownedCategory(ctx, categoryId);
    if (cat && cat.kind !== "income") throw new UserError("Pick an income-type category");
    const values = { label: req(fd, "label", "Label").slice(0, 80), amountCents: amount, cadence, anchorDate, scope: oneOf(s(fd, "scope") || "household", SCOPES, "Scope"), categoryId };
    await getDb().transaction(async (tx) => {
      if (id) {
        const [before] = await tx.select().from(incomeExpectations).where(and(eq(incomeExpectations.id, id), eq(incomeExpectations.householdId, ctx.householdId)));
        if (!before) throw new UserError("Not found");
        const [after] = await tx.update(incomeExpectations).set(values).where(eq(incomeExpectations.id, id)).returning();
        await audit(tx, { householdId: ctx.householdId, actorId: ctx.userId, entity: "income_expectation", entityId: id, action: "update", before, after });
      } else {
        const [row] = await tx.insert(incomeExpectations).values({ ...values, householdId: ctx.householdId }).returning();
        await audit(tx, { householdId: ctx.householdId, actorId: ctx.userId, entity: "income_expectation", entityId: row.id, action: "create", after: row });
      }
    });
    revalidateAll();
    return "Income plan saved";
  });
}

export async function toggleIncomeExpectation(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireActionMember();
    const id = req(fd, "id");
    await getDb().transaction(async (tx) => {
      const [before] = await tx.select().from(incomeExpectations).where(and(eq(incomeExpectations.id, id), eq(incomeExpectations.householdId, ctx.householdId)));
      if (!before) throw new UserError("Not found");
      await tx.update(incomeExpectations).set({ active: !before.active }).where(eq(incomeExpectations.id, id));
      await audit(tx, { householdId: ctx.householdId, actorId: ctx.userId, entity: "income_expectation", entityId: id, action: before.active ? "deactivate" : "activate", before });
    });
    revalidateAll();
    return "Updated";
  });
}

// ---------- recurring bills (verified obligations only) ----------
export async function saveRecurringBill(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireActionMember();
    const label = req(fd, "label", "Label").slice(0, 80);
    const merchantPattern = req(fd, "merchantPattern", "Merchant match text").toLowerCase().slice(0, 60);
    const min = reqMoney(fd, "amountMin", "Minimum amount");
    const max = reqMoney(fd, "amountMax", "Maximum amount");
    if (min < 0 || max < min) throw new UserError("Amount band must be 0 ≤ min ≤ max");
    const dueDayRaw = s(fd, "dueDay");
    const dueDay = dueDayRaw ? Number(dueDayRaw) : null;
    if (dueDay !== null && !(Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 31)) throw new UserError("Due day must be 1–31");
    const accountId = opt(fd, "accountId");
    await ownedAccount(ctx, accountId);
    const verify = req(fd, "verifyTx", "Verifying charge");
    const [src, txId] = verify.split(":");
    const db = getDb();
    let line: Pick<EffectiveLine, "pending" | "amountCents" | "accountId" | "merchant"> | null = null;
    if (src === "bank") {
      const t = await ownedBankTx(ctx, txId);
      line = { pending: t.pending, amountCents: t.amountCents, accountId: t.accountId, merchant: t.merchantRaw };
    } else if (src === "manual") {
      const [m] = await db.select().from(manualTransactions).where(and(eq(manualTransactions.id, txId), eq(manualTransactions.householdId, ctx.householdId), isNull(manualTransactions.deletedAt)));
      if (m) line = { pending: false, amountCents: m.amountCents, accountId: m.accountId, merchant: m.merchant };
    }
    const rules = { merchantPattern, accountId, dueDay };
    if (!line || !billMatches({ amountMinCents: min, amountMaxCents: max, matchRules: rules }, line as EffectiveLine)) {
      throw new UserError("The verifying charge must be a posted outflow that matches the merchant text, amount band and account. Bills are tracked only as verified obligations.");
    }
    await db.transaction(async (tx) => {
      const [row] = await tx.insert(recurringBills).values({ householdId: ctx.householdId, label, amountMinCents: min, amountMaxCents: max, matchRules: rules, verifiedByTxId: verify }).returning();
      await audit(tx, { householdId: ctx.householdId, actorId: ctx.userId, entity: "recurring_bill", entityId: row.id, action: "create", after: row });
    });
    revalidateAll();
    return "Recurring bill added";
  });
}

export async function toggleRecurringBill(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireActionMember();
    const id = req(fd, "id");
    await getDb().transaction(async (tx) => {
      const [before] = await tx.select().from(recurringBills).where(and(eq(recurringBills.id, id), eq(recurringBills.householdId, ctx.householdId)));
      if (!before) throw new UserError("Not found");
      await tx.update(recurringBills).set({ active: !before.active }).where(eq(recurringBills.id, id));
      await audit(tx, { householdId: ctx.householdId, actorId: ctx.userId, entity: "recurring_bill", entityId: id, action: before.active ? "deactivate" : "activate", before });
    });
    revalidateAll();
    return "Updated";
  });
}

// ---------- goals (owner-entered; planning only) ----------
export async function saveGoal(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireActionMember();
    const id = opt(fd, "id");
    const kind = oneOf(s(fd, "kind") || "save", ["save", "debt"] as const, "Goal type");
    const target = reqMoney(fd, "targetAmount", "Target amount");
    if (target <= 0) throw new UserError("Target must be positive");
    const linked = fd.getAll("linkedAccountIds").map(String).filter(Boolean);
    for (const a of linked) await ownedAccount(ctx, a);
    const funded = money(fd, "fundedAmount", "Funded amount");
    const baseline = money(fd, "baseline", "Starting balance");
    const values = {
      kind,
      title: req(fd, "title", "Title").slice(0, 80),
      targetAmountCents: target,
      targetDate: date(fd, "targetDate", "Target date", false),
      linkedAccountIds: linked,
      fundedAmountCents: funded,
      baselineCents: kind === "debt" ? (baseline !== null ? Math.abs(baseline) : null) : null,
    };
    await getDb().transaction(async (tx) => {
      if (id) {
        const [before] = await tx.select().from(goals).where(and(eq(goals.id, id), eq(goals.householdId, ctx.householdId)));
        if (!before) throw new UserError("Goal not found");
        const [after] = await tx.update(goals).set(values).where(eq(goals.id, id)).returning();
        await audit(tx, { householdId: ctx.householdId, actorId: ctx.userId, entity: "goal", entityId: id, action: "update", before, after });
      } else {
        const [row] = await tx.insert(goals).values({ ...values, householdId: ctx.householdId }).returning();
        await audit(tx, { householdId: ctx.householdId, actorId: ctx.userId, entity: "goal", entityId: row.id, action: "create", after: row });
      }
    });
    revalidateAll();
    return id ? "Goal saved" : "Goal added";
  });
}

export async function archiveGoal(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireActionMember();
    const id = req(fd, "id");
    await getDb().transaction(async (tx) => {
      const [before] = await tx.select().from(goals).where(and(eq(goals.id, id), eq(goals.householdId, ctx.householdId)));
      if (!before) throw new UserError("Goal not found");
      await tx.update(goals).set({ archived: true }).where(eq(goals.id, id));
      await audit(tx, { householdId: ctx.householdId, actorId: ctx.userId, entity: "goal", entityId: id, action: "archive", before });
    });
    revalidateAll();
    return "Goal archived";
  });
}

// ---------- net-worth manual assets ----------
export async function saveManualAsset(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireActionMember();
    const id = opt(fd, "id");
    const amount = money(fd, "amount", "Amount");
    const notes = opt(fd, "notes")?.slice(0, 500) ?? null;
    await getDb().transaction(async (tx) => {
      if (id) {
        const [before] = await tx.select().from(netWorthManualAssets).where(and(eq(netWorthManualAssets.id, id), eq(netWorthManualAssets.householdId, ctx.householdId)));
        if (!before) throw new UserError("Asset not found");
        if (before.systemKey === KATAPULT_STAKE_KEY && ctx.role !== "admin") throw new HttpError(403, "Only the owner can set the 51% stake value");
        const label = before.systemKey ? before.label : req(fd, "label", "Label").slice(0, 80);
        if (!before.systemKey && isExcludedByPolicy(label)) throw new UserError("Only the single 51% cleared-cash stake may reference Katapult.");
        const [after] = await tx.update(netWorthManualAssets).set({ label, amountCents: amount, notes, asOf: new Date() }).where(eq(netWorthManualAssets.id, id)).returning();
        await audit(tx, { householdId: ctx.householdId, actorId: ctx.userId, entity: "net_worth_manual_asset", entityId: id, action: "update", before, after });
      } else {
        const label = req(fd, "label", "Label").slice(0, 80);
        if (isExcludedByPolicy(label)) throw new UserError("Only the single 51% cleared-cash stake may reference Katapult.");
        const [row] = await tx.insert(netWorthManualAssets).values({ householdId: ctx.householdId, label, amountCents: amount, notes, asOf: amount !== null ? new Date() : null }).returning();
        await audit(tx, { householdId: ctx.householdId, actorId: ctx.userId, entity: "net_worth_manual_asset", entityId: row.id, action: "create", after: row });
      }
    });
    revalidateAll();
    return "Asset saved";
  });
}

export async function deleteManualAsset(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireActionMember();
    const id = req(fd, "id");
    await getDb().transaction(async (tx) => {
      const [before] = await tx.select().from(netWorthManualAssets).where(and(eq(netWorthManualAssets.id, id), eq(netWorthManualAssets.householdId, ctx.householdId)));
      if (!before) throw new UserError("Asset not found");
      if (before.systemKey) throw new UserError("The 51% stake slot cannot be deleted; clear its value instead.");
      await tx.delete(netWorthManualAssets).where(eq(netWorthManualAssets.id, id));
      await audit(tx, { householdId: ctx.householdId, actorId: ctx.userId, entity: "net_worth_manual_asset", entityId: id, action: "delete", before });
    });
    revalidateAll();
    return "Asset removed";
  });
}

// ---------- CSV import ----------
export async function importCsvAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireActionMember();
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new UserError("Choose a CSV file");
    if (file.size > 5 * 1024 * 1024) throw new UserError("File too large (5 MB max)");
    const text = await file.text();
    const r = await importCsv(getDb(), { householdId: ctx.householdId, actorId: ctx.userId, fileName: file.name, text });
    revalidateAll();
    if (r.status === "rejected") throw new UserError(`Import rejected: ${r.errors.map((e) => `line ${e.line}: ${e.message}`).join("; ")}`);
    if (r.status === "duplicate_file") return "This exact file was already imported — nothing changed.";
    const parts =
      r.kind === "balances"
        ? [`${r.balancesUpdated ?? 0} balances updated`]
        : [`${r.inserted} new`, `${r.duplicates} already present`, `${r.pendingMatched} pending→posted matched`];
    if (r.accountsCreated) parts.push(`${r.accountsCreated} accounts created`);
    if (r.excludedByPolicy) parts.push(`${r.excludedByPolicy} excluded by scope policy`);
    if (r.errors.length) parts.push(`${r.errors.length} row issue(s): ${r.errors.slice(0, 3).map((e) => `line ${e.line} ${e.message}`).join("; ")}`);
    return `Imported: ${parts.join(" · ")}`;
  });
}

// ---------- sharing (invite-only, no public links) ----------
export async function createInvite(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireAdmin();
    const email = normEmail(req(fd, "email", "Email"));
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new UserError("Enter a valid email");
    const db = getDb();
    const members = await db.execute<{ n: number }>(sql`select count(*)::int as n from household_member m join "user" u on u.id = m.user_id where lower(u.email) = ${email}`);
    if (members[0]?.n) throw new UserError("That person is already a member");
    const token = randomBytes(24).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await db.transaction(async (tx) => {
      await tx.update(invites).set({ revokedAt: new Date() }).where(and(eq(invites.householdId, ctx.householdId), eq(sql`lower(${invites.email})`, email), isNull(invites.acceptedAt), isNull(invites.revokedAt)));
      const [row] = await tx.insert(invites).values({ householdId: ctx.householdId, email, tokenHash, invitedBy: ctx.userId, expiresAt: new Date(Date.now() + 7 * 86_400_000) }).returning();
      await audit(tx, { householdId: ctx.householdId, actorId: ctx.userId, entity: "invite", entityId: row.id, action: "create", after: { email, expiresAt: row.expiresAt } });
    });
    revalidateAll();
    const base = process.env.AUTH_URL ?? "";
    return `Invite created for ${email}. Send them this link (valid 7 days, works only for that Google account): ${base}/invite/${token}`;
  });
}

export async function revokeInvite(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireAdmin();
    const id = req(fd, "id");
    await getDb().transaction(async (tx) => {
      const [before] = await tx.select().from(invites).where(and(eq(invites.id, id), eq(invites.householdId, ctx.householdId)));
      if (!before) throw new UserError("Invite not found");
      await tx.update(invites).set({ revokedAt: new Date() }).where(eq(invites.id, id));
      await audit(tx, { householdId: ctx.householdId, actorId: ctx.userId, entity: "invite", entityId: id, action: "revoke", before: { email: before.email } });
    });
    revalidateAll();
    return "Invite revoked";
  });
}

export async function removeMember(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireAdmin();
    const id = req(fd, "id");
    await getDb().transaction(async (tx) => {
      const [before] = await tx.select().from(householdMembers).where(and(eq(householdMembers.id, id), eq(householdMembers.householdId, ctx.householdId)));
      if (!before) throw new UserError("Member not found");
      if (before.userId === ctx.userId) throw new UserError("You cannot remove yourself");
      await tx.delete(householdMembers).where(eq(householdMembers.id, id));
      await audit(tx, { householdId: ctx.householdId, actorId: ctx.userId, entity: "household_member", entityId: id, action: "remove", before });
    });
    revalidateAll();
    return "Member removed";
  });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}
