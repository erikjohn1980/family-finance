import type { Tx } from "@/db";
import { auditEvents } from "@/db/schema";

export type AuditInput = {
  householdId: string;
  actorId: string | null;
  entity: string;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
};

/** Write an audit event. Call inside the same DB transaction as the write it describes. */
export async function audit(tx: Tx, e: AuditInput) {
  await tx.insert(auditEvents).values({
    householdId: e.householdId,
    actorId: e.actorId,
    entity: e.entity,
    entityId: e.entityId,
    action: e.action,
    before: e.before === undefined ? null : JSON.parse(JSON.stringify(e.before)),
    after: e.after === undefined ? null : JSON.parse(JSON.stringify(e.after)),
  });
}
