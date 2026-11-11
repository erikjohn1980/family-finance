/**
 * Family Finance relational model.
 *
 * Money is stored as integer cents (bigint) — never floats.
 * Sign convention for transactions: negative = outflow, positive = inflow.
 * Liabilities (cards, loans) store their balance POSITIVE and are subtracted in net worth.
 * bank_transaction rows are immutable (enforced by a DB trigger in drizzle/0001_guards.sql).
 */
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  date,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const cents = (name: string) => bigint(name, { mode: "number" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ---------- Auth.js tables (adapter-compatible) ----------
export const users = pgTable("user", {
  id: id(),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
});

export const authAccounts = pgTable(
  "auth_account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable("auth_session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "auth_verification_token",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

// ---------- Household ----------
export const roleEnum = pgEnum("member_role", ["admin", "member"]);

export const households = pgTable("household", {
  id: id(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const householdMembers = pgTable(
  "household_member",
  {
    id: id(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("household_member_user_uq").on(t.userId)],
);

export const invites = pgTable("invite", {
  id: id(),
  householdId: text("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  invitedBy: text("invited_by")
    .notNull()
    .references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// ---------- Accounts ----------
export const accountKindEnum = pgEnum("account_kind", [
  "checking",
  "savings",
  "credit_card",
  "loan",
  "brokerage",
  "retirement",
  "real_estate",
  "vehicle",
  "other_asset",
]);
export const scopeEnum = pgEnum("scope", ["household", "business", "trust"]);
export const sourceEnum = pgEnum("source", ["import", "manual"]);

export const finAccounts = pgTable(
  "fin_account",
  {
    id: id(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Optional last four digits only. Full account numbers are never stored. */
    maskLast4: text("mask_last4"),
    kind: accountKindEnum("kind").notNull(),
    scope: scopeEnum("scope").notNull().default("household"),
    /** Business section label, e.g. "OAL" or "Cue Flow". Null for household/trust. */
    businessUnit: text("business_unit"),
    source: sourceEnum("source").notNull().default("manual"),
    /** Positive for liabilities as well (subtracted in net worth). Null = unknown. */
    balanceCents: cents("balance_cents"),
    availableBalanceCents: cents("available_balance_cents"),
    balanceAsOf: timestamp("balance_as_of", { withTimezone: true }),
    staleAfterHours: integer("stale_after_hours").notNull().default(72),
    isSweep: boolean("is_sweep").notNull().default(false),
    /** Business cash the owner explicitly includes in the default household overview. */
    includeInHouseholdOverview: boolean("include_in_household_overview").notNull().default(false),
    archived: boolean("archived").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("fin_account_name_uq").on(t.householdId, t.name)],
);

// ---------- Categories ----------
export const categoryKindEnum = pgEnum("category_kind", [
  "expense",
  "income",
  "transfer",
  "card_payment",
  "excluded",
]);

export const categories = pgTable(
  "category",
  {
    id: id(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    group: text("group").notNull(),
    name: text("name").notNull(),
    kind: categoryKindEnum("kind").notNull().default("expense"),
    monthlyLimitCents: cents("monthly_limit_cents"),
    rollover: boolean("rollover").notNull().default(false),
    /** True for app-suggested defaults that the owner has not approved yet. */
    proposed: boolean("proposed").notNull().default(false),
    archived: boolean("archived").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("category_name_uq").on(t.householdId, t.group, t.name)],
);

// ---------- Imports ----------
export const importBatches = pgTable(
  "import_batch",
  {
    id: id(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    adapter: text("adapter").notNull(),
    fileName: text("file_name"),
    checksum: text("checksum").notNull(),
    actorId: text("actor_id").references(() => users.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    stats: jsonb("stats").$type<Record<string, unknown>>(),
  },
  (t) => [uniqueIndex("import_batch_checksum_uq").on(t.householdId, t.checksum)],
);

export const bankTransactions = pgTable(
  "bank_transaction",
  {
    id: id(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => finAccounts.id),
    externalId: text("external_id").notNull(),
    postedAt: date("posted_at", { mode: "string" }).notNull(),
    amountCents: cents("amount_cents").notNull(),
    merchantRaw: text("merchant_raw").notNull(),
    pending: boolean("pending").notNull().default(false),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    importBatchId: text("import_batch_id").references(() => importBatches.id),
    importedAt: createdAt(),
  },
  (t) => [
    uniqueIndex("bank_tx_external_uq").on(t.accountId, t.externalId),
    index("bank_tx_posted_idx").on(t.householdId, t.postedAt),
  ],
);

/** Links a bank-pending row to its posted twin; overrides on the pending row carry forward. */
export const pendingLinks = pgTable("pending_link", {
  pendingTxId: text("pending_tx_id")
    .primaryKey()
    .references(() => bankTransactions.id),
  postedTxId: text("posted_tx_id")
    .notNull()
    .references(() => bankTransactions.id),
  rule: text("rule").notNull(),
  matchedAt: createdAt(),
});

/**
 * Append-only categorization layer over immutable bank rows.
 * The newest split_group for a bank tx is effective. A split_group with several rows is a split;
 * their split_amount_cents must sum to the transaction amount.
 */
export const ledgerOverrides = pgTable(
  "ledger_override",
  {
    id: id(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    bankTxId: text("bank_tx_id").references(() => bankTransactions.id),
    categoryId: text("category_id").references(() => categories.id),
    memo: text("memo"),
    splitGroup: text("split_group").notNull(),
    splitAmountCents: cents("split_amount_cents"),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("override_tx_idx").on(t.bankTxId, t.createdAt)],
);

export const manualTransactions = pgTable(
  "manual_transaction",
  {
    id: id(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    accountId: text("account_id").references(() => finAccounts.id),
    scope: scopeEnum("scope").notNull().default("household"),
    amountCents: cents("amount_cents").notNull(),
    merchant: text("merchant").notNull(),
    categoryId: text("category_id").references(() => categories.id),
    memo: text("memo"),
    occurredAt: date("occurred_at", { mode: "string" }).notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("manual_tx_occurred_idx").on(t.householdId, t.occurredAt)],
);

// ---------- Planning ----------
export const cadenceEnum = pgEnum("cadence", ["weekly", "biweekly", "semimonthly", "monthly", "quarterly", "annual"]);

export const incomeExpectations = pgTable("income_expectation", {
  id: id(),
  householdId: text("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  amountCents: cents("amount_cents").notNull(),
  cadence: cadenceEnum("cadence").notNull().default("monthly"),
  /** A known pay date; required for weekly/biweekly/quarterly/annual to count occurrences per month. */
  anchorDate: date("anchor_date", { mode: "string" }),
  scope: scopeEnum("scope").notNull().default("household"),
  categoryId: text("category_id").references(() => categories.id),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export type RecurringMatchRules = {
  merchantPattern: string;
  accountId?: string | null;
  dueDay?: number | null;
};

export const recurringBills = pgTable("recurring_bill", {
  id: id(),
  householdId: text("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  amountMinCents: cents("amount_min_cents").notNull(),
  amountMaxCents: cents("amount_max_cents").notNull(),
  matchRules: jsonb("match_rules").$type<RecurringMatchRules>().notNull(),
  /** Bank or manual tx id that verified this obligation when it was created. */
  verifiedByTxId: text("verified_by_tx_id").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const goalKindEnum = pgEnum("goal_kind", ["save", "debt"]);

export const goals = pgTable("goal", {
  id: id(),
  householdId: text("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  kind: goalKindEnum("kind").notNull(),
  title: text("title").notNull(),
  targetAmountCents: cents("target_amount_cents").notNull(),
  targetDate: date("target_date", { mode: "string" }),
  linkedAccountIds: jsonb("linked_account_ids").$type<string[]>().notNull().default([]),
  /** Owner-entered funded amount when no account is linked. */
  fundedAmountCents: cents("funded_amount_cents"),
  /** Debt goals: liability balance when the plan started. */
  baselineCents: cents("baseline_cents"),
  archived: boolean("archived").notNull().default(false),
  createdAt: createdAt(),
});

export const netWorthManualAssets = pgTable(
  "net_worth_manual_asset",
  {
    id: id(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    /** Null until the owner supplies a value. Never invented. */
    amountCents: cents("amount_cents"),
    notes: text("notes"),
    /** Reserved for app-managed rows. Currently unused. */
    systemKey: text("system_key"),
    asOf: timestamp("as_of", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("nw_asset_system_key_uq")
      .on(t.householdId, t.systemKey)
      .where(sql`${t.systemKey} is not null`),
  ],
);

export const merchantRules = pgTable("merchant_rule", {
  id: id(),
  householdId: text("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  /** Case-insensitive substring match against merchant_raw. */
  pattern: text("pattern").notNull(),
  categoryId: text("category_id")
    .notNull()
    .references(() => categories.id),
  suggestedBy: text("suggested_by")
    .notNull()
    .references(() => users.id),
  confirmedBy: text("confirmed_by").references(() => users.id),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const auditEvents = pgTable(
  "audit_event",
  {
    id: id(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => users.id),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_entity_idx").on(t.entity, t.entityId), index("audit_at_idx").on(t.householdId, t.at)],
);

export const userPrefs = pgTable(
  "user_pref",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

export type FinAccount = typeof finAccounts.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type BankTransaction = typeof bankTransactions.$inferSelect;
export type ManualTransaction = typeof manualTransactions.$inferSelect;
export type LedgerOverride = typeof ledgerOverrides.$inferSelect;
export type Goal = typeof goals.$inferSelect;
export type RecurringBill = typeof recurringBills.$inferSelect;
export type MerchantRule = typeof merchantRules.$inferSelect;
export type IncomeExpectation = typeof incomeExpectations.$inferSelect;
export type NetWorthManualAsset = typeof netWorthManualAssets.$inferSelect;
