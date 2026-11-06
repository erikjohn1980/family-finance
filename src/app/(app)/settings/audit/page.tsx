import { getDb } from "@/db";
import { AuditList } from "@/components/audit-list";
import { Card, PageHead } from "@/components/ui";
import { auditFor } from "@/lib/data/audit";
import { pageMember } from "@/lib/page";

export const metadata = { title: "Audit history" };

export default async function Audit({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pageMember();
  const sp = await searchParams;
  const entity = sp.entity && /^[a-z_]+$/.test(sp.entity) ? sp.entity : undefined;
  const rows = await auditFor(getDb(), ctx.householdId, { entity, limit: 300 });
  return (
    <>
      <PageHead title="Audit history" sub="Every write, by either member, with before and after values. Append-only." />
      <form method="get" className="filters">
        <label>
          Entity
          <select name="entity" defaultValue={entity ?? ""}>
            <option value="">All</option>
            {["manual_transaction", "bank_transaction", "category", "fin_account", "merchant_rule", "goal", "income_expectation", "recurring_bill", "net_worth_manual_asset", "import_batch", "invite", "household_member", "household"].map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" type="submit">
          Filter
        </button>
      </form>
      <Card>
        <AuditList rows={rows} />
      </Card>
    </>
  );
}
