import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { recurringBills } from "@/db/schema";
import { saveRecurringBill, toggleRecurringBill } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { FilterBar } from "@/components/filter-bar";
import { BillPill, Card, Empty, Money, PageHead } from "@/components/ui";
import { billStatus } from "@/lib/calc/planning";
import { addDays, monthLabel, monthRange, shortDate, todayIso } from "@/lib/dates";
import { centsToDecimalString } from "@/lib/money";
import { rulePatternFor } from "@/lib/rules";
import { ledgerFor, pageMember, resolveFilters } from "@/lib/page";

export const metadata = { title: "Recurring bills" };

export default async function Recurring({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pageMember();
  const sp = await searchParams;
  const f = await resolveFilters(ctx.userId, sp);
  const { start, end } = monthRange(f.month);
  const today = todayIso();
  const [month, all, bills] = await Promise.all([
    ledgerFor(ctx.householdId, start, end),
    ledgerFor(ctx.householdId),
    getDb().select().from(recurringBills).where(eq(recurringBills.householdId, ctx.householdId)),
  ]);
  const candidates = all.lines.filter((l) => !l.pending && l.amountCents < 0 && l.date >= addDays(today, -180)).slice(0, 300);
  const verify = typeof sp.verify === "string" ? sp.verify : "";
  const pre = candidates.find((l) => `${l.source}:${l.txId}` === verify);
  const active = bills.filter((b) => b.active);
  const inactive = bills.filter((b) => !b.active);

  return (
    <>
      <PageHead title="Recurring bills" sub={`${monthLabel(f.month)} · verified payment obligations. Status comes only from matched posted charges.`}>
        <FilterBar month={f.month} scope={f.scope} showScope={false} />
      </PageHead>
      <Card title="Bills this month">
        {active.length ? (
          <div className="board grid">
            {active.map((b) => {
              const st = billStatus(b, month.lines, f.month, today);
              return (
                <div key={b.id} className="mini">
                  <div className="mini-top">
                    <span>{b.matchRules.merchantPattern}</span>
                    <BillPill status={st.status} />
                  </div>
                  <strong>{b.label}</strong>
                  <span className="mini-amount">
                    <Money cents={b.amountMinCents} />
                    {b.amountMaxCents !== b.amountMinCents ? <> – <Money cents={b.amountMaxCents} /></> : null}
                  </span>
                  <div className="mini-foot">
                    <span>{st.dueDate ? `Due ${shortDate(st.dueDate)}` : "No due day set"}</span>
                    <span>
                      {st.matched[0] ? (
                        <Link href={`/transactions/${st.matched[0].source}/${st.matched[0].txId}`}>
                          Paid {shortDate(st.matched[0].date)}
                        </Link>
                      ) : (
                        "No matching charge"
                      )}
                    </span>
                  </div>
                  <ActionForm action={toggleRecurringBill}>
                    <input type="hidden" name="id" value={b.id} />
                    <Submit className="btn btn-sm">Stop tracking</Submit>
                  </ActionForm>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty title="No verified bills">Add one below from a real charge, or use “Track as recurring bill” on a transaction.</Empty>
        )}
        {inactive.length ? (
          <details className="details" style={{ marginTop: 12 }}>
            <summary className="small muted">Not tracked ({inactive.length})</summary>
            {inactive.map((b) => (
              <ActionForm key={b.id} action={toggleRecurringBill} className="form-actions">
                <input type="hidden" name="id" value={b.id} />
                <span>{b.label}</span>
                <Submit className="btn btn-sm">Resume tracking</Submit>
              </ActionForm>
            ))}
          </details>
        ) : null}
      </Card>
      <Card title="Add a verified bill">
        <p className="small muted" style={{ marginBottom: 12 }}>
          A bill must be verified by an existing posted charge that matches its merchant text and amount band. This screen tracks obligations only. It does not pay bills, review insurance, or propose coverage.
        </p>
        {candidates.length ? (
          <ActionForm action={saveRecurringBill} aria-label="Add recurring bill">
            <div className="form-grid">
              <label style={{ gridColumn: "1 / -1" }}>
                Verifying charge
                <select name="verifyTx" required defaultValue={pre ? verify : ""}>
                  <option value="">Choose a posted charge…</option>
                  {candidates.map((l) => (
                    <option key={l.key} value={`${l.source}:${l.txId}`}>
                      {l.date} · {l.merchant} · {centsToDecimalString(Math.abs(l.amountCents))}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Label
                <input name="label" required defaultValue={pre?.merchant ?? ""} />
              </label>
              <label>
                Merchant match text
                <input name="merchantPattern" required defaultValue={pre ? rulePatternFor(pre.merchant) : ""} />
              </label>
              <label>
                Min amount
                <input name="amountMin" inputMode="decimal" required defaultValue={pre ? centsToDecimalString(Math.round(Math.abs(pre.amountCents) * 0.9)) : ""} />
              </label>
              <label>
                Max amount
                <input name="amountMax" inputMode="decimal" required defaultValue={pre ? centsToDecimalString(Math.round(Math.abs(pre.amountCents) * 1.1)) : ""} />
              </label>
              <label>
                Due day of month (optional)
                <input name="dueDay" type="number" min={1} max={31} defaultValue={pre ? Number(pre.date.slice(8)) : ""} />
              </label>
              <label>
                Only from account (optional)
                <select name="accountId" defaultValue="">
                  <option value="">Any account</option>
                  {all.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="small muted" style={{ marginTop: 8 }}>The ±10% amount band and the due day are proposed defaults taken from the charge. Adjust them as needed.</p>
            <div className="form-actions" style={{ marginTop: 12 }}>
              <Submit>Add bill</Submit>
            </div>
          </ActionForm>
        ) : (
          <Empty title="No posted charges yet">Import a CSV or add transactions first. Bills can only be created from a real charge.</Empty>
        )}
      </Card>
    </>
  );
}
