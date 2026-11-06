import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { goals } from "@/db/schema";
import { archiveGoal, saveGoal } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { Card, Empty, Money, PageHead, Pill, Progress } from "@/components/ui";
import { goalProgress } from "@/lib/calc/planning";
import { shortDate } from "@/lib/dates";
import { centsToDecimalString } from "@/lib/money";
import type { Goal, FinAccount } from "@/db/schema";
import { ledgerFor, pageMember } from "@/lib/page";

export const metadata = { title: "Goals" };

function GoalForm({ goal, accounts }: { goal?: Goal; accounts: FinAccount[] }) {
  return (
    <ActionForm action={saveGoal} resetOnSuccess={!goal} aria-label={goal ? `Edit ${goal.title}` : "Add goal"}>
      {goal ? <input type="hidden" name="id" value={goal.id} /> : null}
      <div className="form-grid">
        <label>
          Type
          <select name="kind" defaultValue={goal?.kind ?? "save"}>
            <option value="save">Save toward (emergency fund, vacation…)</option>
            <option value="debt">Pay down debt</option>
          </select>
        </label>
        <label>
          Title
          <input name="title" required maxLength={80} defaultValue={goal?.title ?? ""} placeholder="e.g. Emergency fund" />
        </label>
        <label>
          Target amount (owner-set)
          <input name="targetAmount" inputMode="decimal" required defaultValue={goal ? centsToDecimalString(goal.targetAmountCents) : ""} />
        </label>
        <label>
          Target date
          <input type="date" name="targetDate" defaultValue={goal?.targetDate ?? ""} />
        </label>
        <label>
          Funded so far (if no linked account)
          <input name="fundedAmount" inputMode="decimal" defaultValue={goal?.fundedAmountCents != null ? centsToDecimalString(goal.fundedAmountCents) : ""} />
        </label>
        <label>
          Debt starting balance (debt goals)
          <input name="baseline" inputMode="decimal" defaultValue={goal?.baselineCents != null ? centsToDecimalString(goal.baselineCents) : ""} />
        </label>
      </div>
      {accounts.length ? (
        <fieldset style={{ border: "1px solid var(--border)", borderRadius: 10, marginTop: 10, padding: 10 }}>
          <legend className="small muted">Linked accounts (progress = their balances)</legend>
          <div className="form-actions">
            {accounts.map((a) => (
              <label key={a.id} className="inline small">
                <input type="checkbox" name="linkedAccountIds" value={a.id} defaultChecked={goal?.linkedAccountIds.includes(a.id)} /> {a.name}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <div className="form-actions" style={{ marginTop: 10 }}>
        <Submit>{goal ? "Save goal" : "Add goal"}</Submit>
        <span className="small muted">Planning only. No money is moved and no investment or tax advice is given.</span>
      </div>
    </ActionForm>
  );
}

export default async function Goals() {
  const ctx = await pageMember();
  const [data, rows] = await Promise.all([ledgerFor(ctx.householdId), getDb().select().from(goals).where(and(eq(goals.householdId, ctx.householdId), eq(goals.archived, false)))]);
  const balances = data.accounts.map((a) => ({ id: a.id, name: a.name, kind: a.kind, balanceCents: a.balanceCents }));
  return (
    <>
      <PageHead title="Goals" sub="Emergency fund, vacation, and debt payoff plans. Every target is set by the owner; the screen stays empty until one is entered." />
      {rows.length ? (
        <div className="grid board">
          {rows.map((g) => {
            const p = goalProgress(g, balances);
            return (
              <Card key={g.id}>
                <div className="mini-top">
                  <span>{g.kind === "save" ? "Savings goal" : "Debt payoff"}</span>
                  {p.pct === null ? <Pill tone="plan">No progress data</Pill> : p.pct >= 1 ? <Pill tone="ok">Reached</Pill> : <Pill tone="due">In progress</Pill>}
                </div>
                <h2 style={{ margin: "6px 0" }}>{g.title}</h2>
                <div className="mini-amount">
                  {p.progressCents === null ? "—" : <Money cents={p.progressCents} />} <span className="small muted">/ <Money cents={g.targetAmountCents} /></span>
                </div>
                <div style={{ margin: "10px 0" }}>
                  <Progress pct={p.pct} state="accent" label={`${g.title} progress`} />
                </div>
                <div className="mini-foot">
                  <span>{g.targetDate ? `Target ${shortDate(g.targetDate)}` : "No target date"}</span>
                  <span>{p.source === "linked" ? "From linked balances" : p.source === "manual" ? "Owner-entered" : ""}</span>
                </div>
                <details className="details">
                  <summary className="small muted">Edit</summary>
                  <GoalForm goal={g} accounts={data.accounts} />
                  <ActionForm action={archiveGoal}>
                    <input type="hidden" name="id" value={g.id} />
                    <Submit className="btn btn-sm btn-danger">Archive goal</Submit>
                  </ActionForm>
                </details>
              </Card>
            );
          })}
        </div>
      ) : (
        <Empty title="No goals yet">Targets still needed from the owner: emergency fund amount, vacation name/target/date, debt accounts and payoff targets.</Empty>
      )}
      <Card title="Add goal">
        <GoalForm accounts={data.accounts} />
      </Card>
    </>
  );
}
