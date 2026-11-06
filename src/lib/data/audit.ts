import { and, desc, eq, inArray } from "drizzle-orm";
import type { DB } from "@/db";
import { auditEvents, users } from "@/db/schema";

export async function auditFor(db: DB, householdId: string, opts: { entity?: string; entityIds?: string[]; limit?: number } = {}) {
  const conds = [eq(auditEvents.householdId, householdId)];
  if (opts.entity) conds.push(eq(auditEvents.entity, opts.entity));
  if (opts.entityIds?.length) conds.push(inArray(auditEvents.entityId, opts.entityIds));
  const rows = await db
    .select({ ev: auditEvents, actorName: users.name, actorEmail: users.email })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorId))
    .where(and(...conds))
    .orderBy(desc(auditEvents.at))
    .limit(opts.limit ?? 200);
  return rows.map((r) => ({ ...r.ev, actorName: r.actorName ?? r.actorEmail }));
}
