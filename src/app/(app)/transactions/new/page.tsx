import { createManualTx } from "@/app/actions";
import { ManualTxForm } from "@/components/tx-form";
import { Card, PageHead } from "@/components/ui";
import { ledgerFor, pageMember } from "@/lib/page";

export const metadata = { title: "Add transaction" };

export default async function NewTx() {
  const ctx = await pageMember();
  const data = await ledgerFor(ctx.householdId);
  return (
    <>
      <PageHead title="Add transaction" sub="For cash or anything not in a bank import. Visible to both household members." />
      <Card>
        <ManualTxForm action={createManualTx} categories={data.categories} accounts={data.accounts} submitLabel="Add transaction" />
      </Card>
    </>
  );
}
