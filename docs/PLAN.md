# Family Finance: implementation plan

Status: **MVP built (phases 1–5).** Every default marked **(proposed)** stays proposed until Erik approves it.

Decisions from the owner so far:
- **Sign-in:** Google, with an invite-only allow-list.
- **Hosting:** DigitalOcean, either a Droplet with Docker Compose or App Platform.
- **Code:** a new private GitHub repo. The name is still to be supplied.
- **Admin:** a personal email. The address is still to be supplied and is configured through `HOUSEHOLD_ADMIN_EMAIL`.

## 0. Guardrails (apply to every phase)

| Rule | How it is enforced |
| --- | --- |
| Scope: OAL, Cue Flow, personal finances only | `Account.scope` is one of `household`, `business`, `trust`. Business sections for OAL and Cue Flow start as **empty scoped sections**, with no invented revenue. |
| Katapult excluded | No Katapult accounts and no Katapult charges. The import pipeline has a deny-list hook, and the seed and fixtures contain none. The only Katapult-related row is one `NetWorthManualAsset`, "51% share of cleared Katapult cash", whose amount is **null until the owner enters it**. |
| Cue Flow unread | No adapter, connector or importer reads Cue Flow data. A `CUE_FLOW_AUTHORIZED` flag defaults to `false`, and the UI shows "Not authorized" for it. |
| Stripe | Not referenced anywhere in the code or dependencies. |
| Read-only bank access | `BankImportAdapter` only has `listAccounts`, `listTransactions` and `health`. There are no payment, transfer, refund or settings methods, and a type-level test keeps it that way. |
| No banned bank brands | UI copy uses generic labels such as "Checking ••1234". Institution identifiers stay inside adapters. |
| No fabricated numbers | Investments, goals, limits and income expectations are empty until the owner enters them. Charts show empty states rather than placeholders. |
| No real data in demos | The `pnpm seed:demo` command loads **fictional** data, labelled with a "DEMO DATA" banner. It can only run when `DEMO_MODE=true` and refuses to run against a production database URL. Production starts empty. |
| Secrets | Provider credentials live only in server environment variables or the host's secret store. The client code and git never see them, and `.env*` files are git-ignored. |

## 1. Stack (proposed, needs owner confirmation)

- **Next.js 16 App Router + TypeScript.** Writes go through server actions, and route handlers serve the CSV export and household APIs.
- **Postgres 16 + Drizzle ORM.** Drizzle gives typed SQL and plain SQL migrations. I prefer it over Prisma here because the `numeric` money columns and partial unique indexes are easier to express.
- **Auth.js v5 with Google sign-in** (owner choice) and an invite-only allow-list. Each session is checked against `HouseholdMember` on every request, and a non-member gets a 401 or 403.
- **Money** is stored as `numeric(14,2)` and handled as integer cents in TypeScript. Floats are never used.
- **Tests:** Vitest for semantics (calculations, sweep rule, CSV escaping, import idempotency) and Playwright for end-to-end tests (two users, reload persistence, keyboard navigation, mobile width without clipping).
- **Hosting (owner choice): DigitalOcean.** Either a Droplet running Docker Compose (Caddy for HTTPS, Postgres) or App Platform with a Managed Postgres. There are no public share links.

## 2. Data model (Drizzle schema)

The model follows the spec. Additions are marked with a `+`.

- `user` (id, email, name, role `admin|member`) and the Auth.js `account`/`session`/`verification_token` tables.
- `household` (id, name) and `household_member` (+, user_id, household_id). There is exactly one household.
- `invite` (+): id, email, token_hash, invited_by, expires_at, accepted_at. Invites are single-use, expire after 7 days, and are bound to one email address.
- `account`: kind `checking|savings|credit_card|loan|brokerage|retirement|real_estate|vehicle|other`, scope, source `import|manual`, `mask_last4`, `balance`, `available_balance`, `as_of`, `is_liability`, `is_sweep` (+), `stale_after_hours` (+, default 72, proposed). The stale flag is computed, not stored.
- `bank_transaction`: `external_id` is UNIQUE per account. The table also holds `posted_at`, `amount` (signed: negative = outflow), `merchant_raw`, `pending`, `payload jsonb` and `import_batch_id`. The app never runs UPDATE on this table; a database trigger rejects updates except the pending→posted link column.
- `ledger_override`: bank_tx_id, category_id, memo, split_group, split_amount, actor_id, created_at. Overrides are append-only, and the newest one wins. Splits are several override rows that share a `split_group`, and their sum must equal the transaction amount.
- `manual_transaction`: amount, merchant, category_id, account_id (nullable), actor_id, occurred_at, `deleted_at` (soft delete).
- `pending_link` (+): pending_tx_id, posted_tx_id, matched_at, rule. This carries overrides forward to the posted row.
- `category`: group, name, `kind` (`expense|income|transfer|card_payment|excluded`), monthly_limit (nullable), `rollover` (default false, proposed).
- `income_expectation`: label, amount, cadence, scope, active.
- `recurring_bill`: label, amount_min, amount_max, match_rules jsonb (merchant pattern, account, day window), active.
- `goal`: kind `save|debt`, title, target_amount, target_date, linked_account_ids, funded_amount_manual.
- `net_worth_manual_asset`: label, amount (nullable), notes. This includes the single 51% Katapult stake row, with an application constraint that allows at most one flagged row.
- `merchant_rule`: pattern, category_id, `status` (`suggested|confirmed`), confirmed_by, confirmed_at. Only confirmed rules are applied.
- `audit_event`: actor_id, entity, entity_id, action, before jsonb, after jsonb, at. A shared `withAudit()` helper writes this row in the same database transaction as every write.
- `import_batch`: adapter, checksum (UNIQUE), file_name, started_at, finished_at, stats jsonb.
- `user_pref` (+): user_id, key, value jsonb. This persists overview filters across reloads.

## 3. Calculation semantics (pure functions in `src/lib/calc/`, unit-tested)

- **Effective row:** each bank row is merged with its latest overrides, or with the override carried from its pending twin. Next, a confirmed merchant rule is applied. Manual transactions are added on top. Every financial view reads from this one function.
- **Posted spend:** expense-kind rows with `pending = false` and `amount < 0`. Refunds (positive amounts in an expense category) reduce spend, which can reach zero but never turns into income.
- **Bank-pending spend:** the same filter with `pending = true`. It is shown separately and never added to the posted KPIs.
- **Needs category:** rows with no effective category. This set is independent of the pending flag, and a test checks that the two counts differ when the sets differ.
- **Transfers and card payments:** both are excluded from income and spend.
- **Income:** expected comes from `income_expectation` for the month, and deposited comes from income-kind rows. A missing deposit is shown as "not yet deposited". It never means the institution is disconnected.
- **Pending→posted matching:** a pending row matches a posted row on the same account when the amount is within ±$1 or 20% (tips) and the merchant is similar. The window is 0–7 days (proposed). Overrides carry over to the posted twin. A pending row with no twin inside the window is marked stale and dropped from totals.
- **Sweep cash:** `cash = available + |newest unmatched overnight sweep purchase|`. The sweep component is 0 if a pending redemption matches that purchase, and paired purchase/redemption rows are ignored. This lives in the adapter layer and is covered by unit tests.
- **Net worth:** assets (cash, investments, real estate, vehicles, manual assets including the 51% stake once it has a value) minus liabilities. Liabilities are stored as positive amounts and subtracted. An investment value comes only from an import or a manual balance with an `as_of` date.
- **Cash view:** checking and savings only. It is a separate KPI from net worth.
- **Budget limit:** posted spend for a category in a month is compared with its limit. Rollover applies only when `rollover = true`.
- **Goals:** progress is the linked balance or the manual funded amount, divided by the target. Planning UI only.
- **Recurring bills:** each bill is matched against posted charges. A bill is *paid* when a match exists this cycle, *due* when there is no match yet and the due date is ahead, and *overdue* when there is no match and the due date has passed. Statuses never come from anything other than matched charges.
- **Scope filter:** the default overview shows household accounts plus the business cash accounts the owner flags as `include_in_household_overview` (default none, proposed).

## 4. Screens (every nav item and header action does real work)

The overview, analytics, transactions (with month/card/category/search filters and a detail drawer showing the override history), income, expenses (with a separate pending toggle), needs-category queue, recurring bills, cards & bank (with fresh/stale/source badges and a scope filter), savings, investments, budget limits (with a detail page), goals, settings (categories, merchant-rule confirmation, manual assets, CSV import with a column map), and share (invites).

The header has search (⌘K), Export CSV for the current filters, Share, and Add transaction.

Each screen has `loading.tsx`, `error.tsx` and an empty-state component.

The design is an original dark-card system using the proposed tokens, light mode, status pills, progress bars, and Pie and Bars charts drawn in plain SVG. The design follows the density of the reference screenshot, not its branding or pixels. Touch targets are 44px, focus rings are visible, and the sidebar becomes a drawer on mobile.

## 5. CSV

- **Import (phase 1):** the documented column map lives at `docs/csv-format.md`. The required columns are `external_id,account,posted_at,amount,merchant,pending`, and `category,memo` are optional. The importer computes a file checksum and skips re-uploads, then upserts each row by `(account_id, external_id)` with `ON CONFLICT DO NOTHING`, so existing rows are never mutated. Afterwards it runs pending→posted matching and reports its stats.
- **Export:** UTF-8 with a BOM and RFC 4180 quoting. Any cell that starts with `= + - @`, a tab or a carriage return gets a `'` prefix. Exports respect the current filters. A round-trip test re-imports the parsed key fields.

## 6. BankImportAdapter (phase 6)

```ts
interface BankImportAdapter {
  id: string;
  health(): Promise<{ status: 'ok' | 'degraded' | 'not_configured'; checkedAt: Date }>;
  listAccounts(): Promise<AdapterResult<ImportedAccount[]>>;
  listTransactions(accountId: string, since: Date): Promise<AdapterResult<ImportedTx[]>>;
}
```

The phase-1 adapters are `csv` and `null`. The null adapter returns `not_configured` and never throws. The interface deliberately has no write methods.

## 7. Staged delivery

1. **Foundation:** schema and migrations, auth and invites, audit helper, app shell with real routes, 401/403 guards.
2. **Manual ledger and categories:** add/edit manual transactions, needs-category queue, overrides, splits, budget limits and their detail page.
3. **CSV:** idempotent import, export with escaping, freshness badges, two-user persistence end-to-end tests.
4. **Semantics:** income expected vs deposited, pending vs posted, recurring bills, transfers and refunds, sweep stubs and tests.
5. **Goals and analytics:** owner-entered goals, pie and trend charts, scope filters.
6. **Provider adapter:** only after Erik configures a provider outside the repo.

Each stage ends with its acceptance tests passing, and I report the test output as it actually came out.

## 8. Open owner inputs

These don't block building. The UI collects them, and each shows as empty or "proposed" until it is set:
goal targets, which business cash accounts appear in the overview, whether imported paychecks feed the budget, rollover policy, and the 51% asset value.
