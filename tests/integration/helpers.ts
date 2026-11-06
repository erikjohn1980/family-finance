import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { bootstrapHousehold } from "@/lib/household";

export async function resetDb() {
  const db = getDb();
  await db.execute(sql`ALTER TABLE bank_transaction DISABLE TRIGGER bank_transaction_no_update`);
  await db.execute(sql`ALTER TABLE audit_event DISABLE TRIGGER audit_event_no_update`);
  await db.execute(sql`TRUNCATE household, "user", bank_transaction, pending_link, ledger_override, audit_event, import_batch CASCADE`);
  await db.execute(sql`ALTER TABLE bank_transaction ENABLE TRIGGER bank_transaction_no_update`);
  await db.execute(sql`ALTER TABLE audit_event ENABLE TRIGGER audit_event_no_update`);
}

export async function setupHousehold() {
  const db = getDb();
  const [erik] = await db.insert(users).values({ email: "erik@example.test", name: "Erik" }).returning();
  const [g] = await db.insert(users).values({ email: "g@example.test", name: "G" }).returning();
  const h = await bootstrapHousehold(db, erik.id);
  return { db, h, erik, g };
}
