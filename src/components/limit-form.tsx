import type { Category } from "@/db/schema";
import { centsToDecimalString } from "@/lib/money";
import { saveCategory } from "@/app/actions";
import { ActionForm, Submit } from "./forms";

export function LimitForm({ c }: { c: Category }) {
  return (
    <ActionForm action={saveCategory} className="form-actions" aria-label={`Limit for ${c.name}`}>
      <input type="hidden" name="id" value={c.id} />
      <input type="hidden" name="rolloverPresent" value="1" />
      <label style={{ flex: "1 1 140px" }}>
        Monthly limit
        <input name="monthlyLimit" inputMode="decimal" placeholder="none" defaultValue={c.monthlyLimitCents !== null ? centsToDecimalString(c.monthlyLimitCents) : ""} />
      </label>
      <label className="inline small">
        <input type="checkbox" name="rollover" defaultChecked={c.rollover} /> Roll over unused (off by default · proposed)
      </label>
      <Submit className="btn btn-sm">Save limit</Submit>
    </ActionForm>
  );
}
