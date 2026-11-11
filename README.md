# Family Finance

A private household ledger for two invited members, Erik and G. It covers OAL, Cue Flow and personal finances only.

- **Read-only by design.** The app never moves money, pays bills, issues refunds, or changes bank settings.
- **Invite-only.** Sign-in is with Google, limited to an allow-list. There are no public share links.
- **Imported bank rows are immutable.** A database trigger enforces this. Categories, memos and splits live in an append-only override layer, and every write is audited.
- **Katapult is excluded entirely.** Katapult accounts and charges are filtered at import, and accounts, manual entries and assets that name Katapult are refused.
- **Cue Flow stays unread** until `CUE_FLOW_AUTHORIZED=true` is set by the owner. Stripe is not used anywhere.

See [`docs/PLAN.md`](docs/PLAN.md) for the full plan and semantics, and [`docs/csv-format.md`](docs/csv-format.md) for the CSV column map.

## Stack

Next.js 16 (App Router, server actions), TypeScript, Postgres 16, Drizzle ORM, Auth.js v5 (Google), Vitest, Playwright.

## Local development

```bash
npm ci
cp .env.example .env.local        # then fill in values
createdb family_finance           # or use any local Postgres
npm run db:migrate
npm run dev
```

`AUTH_TEST_MODE=true` adds a password-less "Test sign-in" for local work. It only works when **both** of these hold:
- `NODE_ENV` is not `production`
- `DATABASE_URL` points at localhost

### Fictional demo data

```bash
DEMO_MODE=true npm run seed:demo
```

This loads clearly fictional "Demo …" / "Sample …" data, and the app shows a **DEMO DATA** banner on every screen.

The seed refuses to run when:
- `DEMO_MODE` is not `true`
- `NODE_ENV=production`
- the database is non-local, unless you also set `DEMO_SEED_CONFIRM=<dbname>`

Never load real financial data into a demo instance.

### Live preview behind a proxy

```bash
PREVIEW_MODE=true DEMO_MODE=true AUTH_TEST_MODE=true npm run dev
```

`PREVIEW_MODE` lets the dev server be viewed through a preview proxy or pane: it accepts dev requests from other hosts, allows framing, and marks the session cookie for cross-site use. It is ignored when `NODE_ENV=production`, so it can't weaken a deployed instance. Use it only with demo data.

## Phone use

The layout is phone-first below 900 px: a bottom tab bar (Overview, Categorize, Add, Transactions, More), one-tap category chips with Undo in the Needs category queue, and 16 px inputs so iOS doesn't zoom. Both of you can add it to the home screen from the browser's share menu.

## Tests

```bash
npm test             # unit + Postgres integration tests (uses family_finance_test)
npm run test:e2e     # Playwright acceptance suite (uses family_finance_e2e, starts its own dev server on :3100)
```

The acceptance suite covers:
- 401/403 on household APIs
- invite-only access
- idempotent CSV import
- dual-user persistence after reload
- needs-category → override + audit
- merchant-rule owner confirmation
- budget detail
- goals that stay empty until a target is set
- CSV export escaping and filter matching
- filter persistence
- keyboard navigation
- mobile layout without horizontal overflow

## Google sign-in setup (owner)

1. Open Google Cloud Console → APIs & Services → Credentials → **Create OAuth client ID** → Web application.
2. Add an authorized redirect URI: `https://<your-domain>/api/auth/callback/google`. For local work, also add `http://localhost:3000/api/auth/callback/google`.
3. Put the client ID and secret in the server's secret store as `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`. Never commit them.
4. Set `HOUSEHOLD_ADMIN_EMAIL` to the owner's Google email. The first sign-in with that email creates the household.
5. Invite G from **Share → Invite**. G then signs in with the invited Google account.

## Deploy on DigitalOcean (private)

### Option A: Droplet with Docker Compose (recommended for cost)

1. Create a Droplet (Ubuntu 24.04, 1 GB or larger) and install Docker.
2. Point a DNS A record (for example `finance.example.com`) at the Droplet.
3. Restrict the Droplet firewall to 22 (your IP), 80 and 443.
4. Run:

   ```bash
   git clone <private repo> && cd family-finance/deploy/droplet
   cp .env.example .env && chmod 600 .env   # fill in values
   docker compose up -d --build
   ```

5. Caddy provisions HTTPS automatically. Postgres is only reachable inside the compose network.
6. Back up the `pgdata` volume. For example, run this nightly from cron and copy the result off the box (DO Spaces or similar):

   ```bash
   docker compose exec db pg_dump -U ff family_finance
   ```

### Option B: App Platform with a Managed Postgres

1. Edit `.do/app.yaml`: set the repo and your domain.
2. Run `doctl apps create --spec .do/app.yaml`.
3. Set the `SECRET` env values in the App settings.

Migrations run automatically when the container starts.

The app sends `X-Robots-Tag: noindex` and denies framing. Every page and API route requires an authenticated household member.

## Bank data provider (phase 6)

`src/lib/adapters/types.ts` defines the read-only `BankImportAdapter` (`listAccounts`, `listTransactions`, `health`). Until the owner configures a documented provider in server secrets, it returns `not_configured` and the app keeps working with CSV import.

## Owner inputs still open

These are collected in the UI, and each stays empty or marked **Proposed** until set:
- goal targets
- which business cash accounts appear in the household overview
- whether imported paychecks feed the budget
- rollover policy (default off)
- approval of the proposed default categories and design tokens
