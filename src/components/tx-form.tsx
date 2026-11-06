import { ActionForm, Submit, type FormAction } from "./forms";
import type { Category, FinAccount, ManualTransaction } from "@/db/schema";
import { centsToDecimalString } from "@/lib/money";
import { todayIso } from "@/lib/dates";

export function ManualTxForm({ action, categories, accounts, tx, submitLabel }: { action: FormAction; categories: Category[]; accounts: FinAccount[]; tx?: ManualTransaction; submitLabel: string }) {
  const direction = tx && tx.amountCents > 0 ? "income" : "expense";
  return (
    <ActionForm action={action} aria-label="Manual transaction">
      {tx ? <input type="hidden" name="id" value={tx.id} /> : null}
      <div className="form-grid">
        <label>
          Type
          <select name="direction" defaultValue={direction}>
            <option value="expense">Expense (money out)</option>
            <option value="income">Income / refund (money in)</option>
          </select>
        </label>
        <label>
          Amount (USD)
          <input name="amount" inputMode="decimal" required placeholder="0.00" defaultValue={tx ? centsToDecimalString(Math.abs(tx.amountCents)) : ""} />
        </label>
        <label>
          Date
          <input type="date" name="occurredAt" required defaultValue={tx?.occurredAt ?? todayIso()} />
        </label>
        <label>
          Merchant / description
          <input name="merchant" required maxLength={200} defaultValue={tx?.merchant ?? ""} />
        </label>
        <label>
          Category
          <select name="categoryId" defaultValue={tx?.categoryId ?? ""}>
            <option value="">Needs category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.group} · {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Paid from (optional)
          <select name="accountId" defaultValue={tx?.accountId ?? ""}>
            <option value="">Cash / no account</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Scope (when no account)
          <select name="scope" defaultValue={tx?.scope ?? "household"}>
            <option value="household">Household</option>
            <option value="business">Business</option>
            <option value="trust">Trust</option>
          </select>
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          Memo
          <textarea name="memo" maxLength={500} defaultValue={tx?.memo ?? ""} />
        </label>
      </div>
      <div className="form-actions" style={{ marginTop: 12 }}>
        <Submit>{submitLabel}</Submit>
        <span className="small muted">Saved as a Manual entry. Imported bank rows are never changed.</span>
      </div>
    </ActionForm>
  );
}
