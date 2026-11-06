import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { manualTransactions, users } from "@/db/schema";
import { deleteManualTx, updateManualTx } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { AuditList } from "@/components/audit-list";
import { ManualTxForm } from "@/components/tx-form";
import { Card, PageHead, Pill } from "@/components/ui";
import { auditFor } from "@/lib/data/audit";
import { ledgerFor, pageMember } from "@/lib/page";

export const metadata = { title: "Manual transaction" };

export default async function ManualTxDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await pageMember();
  const db = getDb();
  const [row] = await db
    .select({ tx: manualTransactions, actor: users.name, email: users.email })
    .from(manualTransactions)
    .leftJoin(users, eq(users.id, manualTransactions.actorId))
    .where(and(eq(manualTransactions.id, id), eq(manualTransactions.householdId, ctx.householdId)));
  if (!row || row.tx.deletedAt) notFound();
  const [data, audit] = await Promise.all([ledgerFor(ctx.householdId), auditFor(db, ctx.householdId, { entityIds: [id] })]);
  return (
    <>
      <PageHead title={row.tx.merchant} sub={<><Pill tone="plan">Manual</Pill> added by {row.actor ?? row.email}</>}>
        <Link className="btn" href={`/recurring?verify=manual:${id}`}>
          Track as recurring bill
        </Link>
      </PageHead>
      {sp.created ? (
        <p className="banner banner-info" role="status">
          Transaction added. Both household members will see it.
        </p>
      ) : null}
      <Card title="Edit">
        <ManualTxForm action={updateManualTx} categories={data.categories} accounts={data.accounts} tx={row.tx} submitLabel="Save changes" />
      </Card>
      <Card title="Delete">
        <ActionForm action={deleteManualTx}>
          <input type="hidden" name="id" value={id} />
          <p className="small muted" style={{ marginBottom: 10 }}>
            Removes it from totals. The record stays in audit history.
          </p>
          <Submit className="btn btn-danger" pendingText="Deleting…">
            Delete manual transaction
          </Submit>
        </ActionForm>
      </Card>
      <Card title="Audit history">
        <AuditList rows={audit} />
      </Card>
    </>
  );
}
