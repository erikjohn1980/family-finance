import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL ?? "postgres://ff:ff@localhost:5432/family_finance_e2e";
  if (!/@(localhost|127\.0\.0\.1)/.test(url)) throw new Error("e2e must run against a local database");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  await sql`ALTER TABLE bank_transaction DISABLE TRIGGER bank_transaction_no_update`;
  await sql`ALTER TABLE audit_event DISABLE TRIGGER audit_event_no_update`;
  await sql`TRUNCATE household, "user", bank_transaction, pending_link, ledger_override, audit_event, import_batch CASCADE`;
  await sql`ALTER TABLE bank_transaction ENABLE TRIGGER bank_transaction_no_update`;
  await sql`ALTER TABLE audit_event ENABLE TRIGGER audit_event_no_update`;
  await sql.end();
}
