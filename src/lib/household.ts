import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { categories, householdMembers, households, invites, netWorthManualAssets } from "@/db/schema";
import { audit } from "./audit";
import { KATAPULT_STAKE_KEY } from "./policy";

/** PROPOSED default categories — flagged `proposed` until the owner approves or edits them. No limits are set. */
export const DEFAULT_CATEGORIES: { group: string; name: string; kind: "expense" | "income" | "transfer" | "card_payment" | "excluded" }[] = [
  { group: "Housing", name: "Rent / Mortgage", kind: "expense" },
  { group: "Housing", name: "Utilities", kind: "expense" },
  { group: "Housing", name: "Internet & Phone", kind: "expense" },
  { group: "Food", name: "Groceries", kind: "expense" },
  { group: "Food", name: "Dining", kind: "expense" },
  { group: "Transport", name: "Fuel", kind: "expense" },
  { group: "Transport", name: "Transit & Parking", kind: "expense" },
  { group: "Lifestyle", name: "Shopping", kind: "expense" },
  { group: "Lifestyle", name: "Entertainment", kind: "expense" },
  { group: "Lifestyle", name: "Travel", kind: "expense" },
  { group: "Health", name: "Medical", kind: "expense" },
  { group: "Insurance", name: "Insurance premiums", kind: "expense" },
  { group: "Other", name: "Fees", kind: "expense" },
  { group: "Other", name: "Gifts & Donations", kind: "expense" },
  { group: "Income", name: "Salary", kind: "income" },
  { group: "Income", name: "Other income", kind: "income" },
  { group: "Business", name: "OAL", kind: "expense" },
  { group: "Business", name: "Cue Flow", kind: "expense" },
  { group: "Moves", name: "Transfer", kind: "transfer" },
  { group: "Moves", name: "Card payment", kind: "card_payment" },
  { group: "Moves", name: "Excluded", kind: "excluded" },
];

export function normEmail(e: string | null | undefined): string {
  return (e ?? "").trim().toLowerCase();
}

export function adminEmail(): string {
  return normEmail(process.env.HOUSEHOLD_ADMIN_EMAIL);
}

export async function getHousehold(db: DB) {
  const [h] = await db.select().from(households).limit(1);
  return h ?? null;
}

/** Create the single household (idempotent) with proposed defaults and the empty 51% stake slot. */
export async function bootstrapHousehold(db: DB, adminUserId: string) {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(households).limit(1);
    if (existing) return existing;
    const [h] = await tx
      .insert(households)
      .values({ name: process.env.HOUSEHOLD_NAME || "Family Finance" })
      .returning();
    await tx.insert(householdMembers).values({ householdId: h.id, userId: adminUserId, role: "admin" });
    await tx.insert(categories).values(DEFAULT_CATEGORIES.map((c) => ({ ...c, householdId: h.id, proposed: true })));
    await tx.insert(netWorthManualAssets).values({
      householdId: h.id,
      label: "51% share of cleared Katapult cash",
      amountCents: null,
      notes: "Owner-supplied value only. Not linked to any Katapult account.",
      systemKey: KATAPULT_STAKE_KEY,
    });
    await audit(tx, { householdId: h.id, actorId: adminUserId, entity: "household", entityId: h.id, action: "bootstrap", after: { name: h.name } });
    return h;
  });
}

/** Is this email allowed to sign in? Admin email, existing member, or holder of a live invite. */
export async function isEmailAllowed(db: DB, email: string): Promise<boolean> {
  const e = normEmail(email);
  if (!e) return false;
  if (e === adminEmail()) return true;
  const member = await db.execute(sql`select 1 from household_member m join "user" u on u.id = m.user_id where lower(u.email) = ${e} limit 1`);
  if (member.length > 0) return true;
  const [inv] = await db
    .select({ id: invites.id })
    .from(invites)
    .where(and(eq(sql`lower(${invites.email})`, e), isNull(invites.acceptedAt), isNull(invites.revokedAt), gt(invites.expiresAt, new Date())))
    .limit(1);
  return !!inv;
}

/** After sign-in: ensure the user is a member (bootstrap for admin, accept invite for others). */
export async function ensureMembership(db: DB, userId: string, email: string) {
  const e = normEmail(email);
  const [m] = await db.select().from(householdMembers).where(eq(householdMembers.userId, userId)).limit(1);
  if (m) return m;
  if (e && e === adminEmail()) {
    const h = await getHousehold(db);
    if (!h) {
      await bootstrapHousehold(db, userId);
    } else {
      await db.transaction(async (tx) => {
        await tx.insert(householdMembers).values({ householdId: h.id, userId, role: "admin" }).onConflictDoNothing();
        await audit(tx, { householdId: h.id, actorId: userId, entity: "household_member", entityId: userId, action: "admin_join" });
      });
    }
  } else {
    await db.transaction(async (tx) => {
      const [inv] = await tx
        .select()
        .from(invites)
        .where(and(eq(sql`lower(${invites.email})`, e), isNull(invites.acceptedAt), isNull(invites.revokedAt), gt(invites.expiresAt, new Date())))
        .limit(1);
      if (!inv) return;
      await tx.insert(householdMembers).values({ householdId: inv.householdId, userId, role: "member" }).onConflictDoNothing();
      await tx.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.id, inv.id));
      await audit(tx, { householdId: inv.householdId, actorId: userId, entity: "invite", entityId: inv.id, action: "accept", after: { email: e } });
    });
  }
  const [after] = await db.select().from(householdMembers).where(eq(householdMembers.userId, userId)).limit(1);
  return after ?? null;
}
