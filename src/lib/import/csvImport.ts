/**
 * Phase-1 CSV import. Idempotent:
 *  - the whole file is fingerprinted (sha256); re-uploading the same file is a no-op
 *  - each row inserts ON CONFLICT (account_id, external_id) DO NOTHING — existing rows are never mutated
 * Pending → posted matching runs after every import. Overrides are untouched by imports.
 * See docs/csv-format.md for the column map.
 */
import { createHash } from "node:crypto";
import { and, eq, gte, inArray } from "drizzle-orm";
import type { DB } from "@/db";
import { bankTransactions, categories, finAccounts, importBatches, ledgerOverrides, pendingLinks } from "@/db/schema";
import { audit } from "../audit";
import { parseCsv, unescapeFormula } from "../csv/csv";
import { addDays, isValidDate, todayIso } from "../dates";
import { parseMoneyToCents } from "../money";
import { isExcludedByPolicy } from "../policy";
import { matchPendingToPosted } from "../calc/ledger";

export const TX_REQUIRED = ["external_id", "account", "posted_at", "amount", "merchant"] as const;
export const TX_OPTIONAL = ["pending", "pending_id", "category", "memo", "sweep_type", "account_kind", "mask_last4", "scope"] as const;
export const BAL_REQUIRED = ["account", "kind", "balance", "as_of"] as const;
export const BAL_OPTIONAL = ["available_balance", "mask_last4", "scope", "is_sweep"] as const;

const ACCOUNT_KINDS = ["checking", "savings", "credit_card", "loan", "brokerage", "retirement", "real_estate", "vehicle", "other_asset"] as const;
type AccountKind = (typeof ACCOUNT_KINDS)[number];
const SCOPES = ["household", "business", "trust"] as const;

export type ImportStats = {
  kind: "transactions" | "balances";
  status: "imported" | "duplicate_file" | "rejected";
  batchId?: string;
  rows: number;
  inserted: number;
  duplicates: number;
  excludedByPolicy: number;
  errors: { line: number; message: string }[];
  pendingMatched: number;
  accountsCreated: number;
  balancesUpdated?: number;
};

function bool(v: string | undefined): boolean {
  return ["true", "1", "yes", "y", "pending"].includes((v ?? "").trim().toLowerCase());
}

function headerIndex(header: string[]) {
  const idx = new Map<string, number>();
  header.forEach((h, i) => idx.set(h.trim().toLowerCase(), i));
  return idx;
}

export async function importCsv(db: DB, opts: { householdId: string; actorId: string; fileName: string; text: string; today?: string }): Promise<ImportStats> {
  const checksum = createHash("sha256").update(opts.text).digest("hex");
  let rows: string[][];
  try {
    rows = parseCsv(opts.text);
  } catch (e) {
    return { kind: "transactions", status: "rejected", rows: 0, inserted: 0, duplicates: 0, excludedByPolicy: 0, pendingMatched: 0, accountsCreated: 0, errors: [{ line: 0, message: (e as Error).message }] };
  }
  if (rows.length === 0) {
    return { kind: "transactions", status: "rejected", rows: 0, inserted: 0, duplicates: 0, excludedByPolicy: 0, pendingMatched: 0, accountsCreated: 0, errors: [{ line: 1, message: "Empty file" }] };
  }
  const idx = headerIndex(rows[0]);
  const isBalances = BAL_REQUIRED.every((c) => idx.has(c)) && !idx.has("external_id");
  const required = isBalances ? BAL_REQUIRED : TX_REQUIRED;
  const missing = required.filter((c) => !idx.has(c));
  const base: ImportStats = {
    kind: isBalances ? "balances" : "transactions",
    status: "rejected",
    rows: rows.length - 1,
    inserted: 0,
    duplicates: 0,
    excludedByPolicy: 0,
    errors: [],
    pendingMatched: 0,
    accountsCreated: 0,
  };
  if (missing.length) return { ...base, errors: [{ line: 1, message: `Missing required column(s): ${missing.join(", ")}` }] };

  const [dupe] = await db
    .select({ id: importBatches.id })
    .from(importBatches)
    .where(and(eq(importBatches.householdId, opts.householdId), eq(importBatches.checksum, checksum)))
    .limit(1);
  if (dupe) return { ...base, status: "duplicate_file", batchId: dupe.id, duplicates: rows.length - 1 };

  const get = (r: string[], col: string) => {
    const i = idx.get(col);
    return i === undefined ? undefined : unescapeFormula((r[i] ?? "").trim());
  };

  return db.transaction(async (tx) => {
    const [batch] = await tx
      .insert(importBatches)
      .values({ householdId: opts.householdId, adapter: isBalances ? "csv-balances" : "csv", fileName: opts.fileName.slice(0, 200), checksum, actorId: opts.actorId })
      .returning();
    const stats: ImportStats = { ...base, status: "imported", batchId: batch.id };
    const accountCache = new Map<string, string>();
    const existing = await tx.select().from(finAccounts).where(eq(finAccounts.householdId, opts.householdId));
    for (const a of existing) accountCache.set(a.name.toLowerCase(), a.id);

    async function accountId(name: string, kind: AccountKind, scope: (typeof SCOPES)[number], mask: string | null): Promise<string> {
      const k = name.toLowerCase();
      const cached = accountCache.get(k);
      if (cached) return cached;
      const [a] = await tx
        .insert(finAccounts)
        .values({ householdId: opts.householdId, name, kind, scope, source: "import", maskLast4: mask })
        .returning();
      accountCache.set(k, a.id);
      stats.accountsCreated++;
      await audit(tx, { householdId: opts.householdId, actorId: opts.actorId, entity: "fin_account", entityId: a.id, action: "create_from_import", after: { name, kind, scope } });
      return a.id;
    }

    const cats = await tx.select().from(categories).where(eq(categories.householdId, opts.householdId));
    const catByName = new Map(cats.map((c) => [c.name.toLowerCase(), c.id]));
    const touchedAccounts = new Set<string>();

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const line = i + 1;
      const accountName = get(r, "account") ?? "";
      const kindRaw = (get(r, isBalances ? "kind" : "account_kind") || "checking").toLowerCase();
      const scopeRaw = (get(r, "scope") || "household").toLowerCase();
      const mask = (get(r, "mask_last4") || "").replace(/\D/g, "").slice(-4) || null;
      if (!accountName) {
        stats.errors.push({ line, message: "account is required" });
        continue;
      }
      if (!ACCOUNT_KINDS.includes(kindRaw as AccountKind)) {
        stats.errors.push({ line, message: `unknown account kind "${kindRaw}"` });
        continue;
      }
      if (!SCOPES.includes(scopeRaw as (typeof SCOPES)[number])) {
        stats.errors.push({ line, message: `unknown scope "${scopeRaw}"` });
        continue;
      }
      if (isBalances) {
        if (isExcludedByPolicy(accountName)) {
          stats.excludedByPolicy++;
          continue;
        }
        const bal = parseMoneyToCents(get(r, "balance"));
        const avail = get(r, "available_balance") ? parseMoneyToCents(get(r, "available_balance")) : null;
        const asOf = get(r, "as_of") ?? "";
        if (bal === null || !isValidDate(asOf.slice(0, 10))) {
          stats.errors.push({ line, message: "balance and as_of (YYYY-MM-DD) are required" });
          continue;
        }
        const kind = kindRaw as AccountKind;
        const stored = kind === "credit_card" || kind === "loan" ? Math.abs(bal) : bal; // liabilities positive
        const id = await accountId(accountName, kind, scopeRaw as (typeof SCOPES)[number], mask);
        const [before] = await tx.select().from(finAccounts).where(eq(finAccounts.id, id));
        const isSweep = get(r, "is_sweep") !== undefined ? bool(get(r, "is_sweep")) : before.isSweep;
        await tx
          .update(finAccounts)
          .set({ balanceCents: stored, availableBalanceCents: avail, balanceAsOf: new Date(asOf.slice(0, 10) + "T12:00:00Z"), isSweep })
          .where(eq(finAccounts.id, id));
        await audit(tx, {
          householdId: opts.householdId,
          actorId: opts.actorId,
          entity: "fin_account",
          entityId: id,
          action: "balance_import",
          before: { balanceCents: before.balanceCents, availableBalanceCents: before.availableBalanceCents },
          after: { balanceCents: stored, availableBalanceCents: avail, asOf },
        });
        stats.balancesUpdated = (stats.balancesUpdated ?? 0) + 1;
        continue;
      }

      const externalId = get(r, "external_id") ?? "";
      const postedAt = (get(r, "posted_at") ?? "").slice(0, 10);
      const amount = parseMoneyToCents(get(r, "amount"));
      const merchant = get(r, "merchant") ?? "";
      if (!externalId || !isValidDate(postedAt) || amount === null || !merchant) {
        stats.errors.push({ line, message: "external_id, posted_at (YYYY-MM-DD), amount and merchant are required" });
        continue;
      }
      if (isExcludedByPolicy(accountName, merchant)) {
        stats.excludedByPolicy++;
        continue;
      }
      const sweep = (get(r, "sweep_type") || "").toLowerCase();
      const payload: Record<string, unknown> = { source: "csv", line, raw: Object.fromEntries([...idx.entries()].map(([k, j]) => [k, r[j] ?? ""])) };
      if (sweep === "purchase" || sweep === "redemption") payload.sweep_type = sweep;
      const pendingId = get(r, "pending_id");
      if (pendingId) payload.pending_external_id = pendingId;
      const acct = await accountId(accountName, kindRaw as AccountKind, scopeRaw as (typeof SCOPES)[number], mask);
      const inserted = await tx
        .insert(bankTransactions)
        .values({
          householdId: opts.householdId,
          accountId: acct,
          externalId,
          postedAt,
          amountCents: amount,
          merchantRaw: merchant.slice(0, 300),
          pending: bool(get(r, "pending")),
          payload,
          importBatchId: batch.id,
        })
        .onConflictDoNothing({ target: [bankTransactions.accountId, bankTransactions.externalId] })
        .returning({ id: bankTransactions.id });
      if (inserted.length === 0) {
        stats.duplicates++;
        continue;
      }
      stats.inserted++;
      touchedAccounts.add(acct);
      const catName = (get(r, "category") || "").toLowerCase();
      const memo = get(r, "memo") || null;
      const catId = catName ? catByName.get(catName) : undefined;
      if (catName && !catId) stats.errors.push({ line, message: `category "${get(r, "category")}" not found; row imported uncategorized` });
      if (catId || memo) {
        await tx.insert(ledgerOverrides).values({
          householdId: opts.householdId,
          bankTxId: inserted[0].id,
          categoryId: catId ?? null,
          memo,
          splitGroup: crypto.randomUUID(),
          actorId: opts.actorId,
        });
      }
    }

    if (touchedAccounts.size) stats.pendingMatched = await runPendingMatch(tx as unknown as DB, opts.householdId, [...touchedAccounts], opts.today ?? todayIso());
    stats.status = "imported";
    await tx.update(importBatches).set({ finishedAt: new Date(), stats }).where(eq(importBatches.id, batch.id));
    await audit(tx, { householdId: opts.householdId, actorId: opts.actorId, entity: "import_batch", entityId: batch.id, action: "import", after: stats });
    return stats;
  });
}

/** Match pending rows to posted twins for the given accounts. Returns number of new links. */
export async function runPendingMatch(db: DB, householdId: string, accountIds: string[], today: string): Promise<number> {
  const since = addDays(today, -90);
  const txs = await db
    .select()
    .from(bankTransactions)
    .where(and(eq(bankTransactions.householdId, householdId), inArray(bankTransactions.accountId, accountIds), gte(bankTransactions.postedAt, since)));
  if (!txs.length) return 0;
  const existing = await db
    .select()
    .from(pendingLinks)
    .where(
      inArray(
        pendingLinks.pendingTxId,
        txs.map((t) => t.id),
      ),
    );
  const existingByPosted = await db
    .select()
    .from(pendingLinks)
    .where(
      inArray(
        pendingLinks.postedTxId,
        txs.map((t) => t.id),
      ),
    );
  const cands = txs.map((t) => ({ ...t, pendingExternalId: (t.payload?.pending_external_id as string | undefined) ?? null }));
  const links = matchPendingToPosted(
    cands.filter((t) => t.pending),
    cands.filter((t) => !t.pending),
    [...existing, ...existingByPosted],
  );
  if (!links.length) return 0;
  const res = await db
    .insert(pendingLinks)
    .values(links.map((l) => ({ pendingTxId: l.pendingTxId, postedTxId: l.postedTxId, rule: l.rule })))
    .onConflictDoNothing()
    .returning({ id: pendingLinks.pendingTxId });
  return res.length;
}

