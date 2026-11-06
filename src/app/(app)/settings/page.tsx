import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { merchantRules, netWorthManualAssets, importBatches, users } from "@/db/schema";
import { approveProposedCategories, archiveCategory, decideRule, deleteManualAsset, importCsvAction, saveCategory, saveManualAsset } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { Card, Empty, Money, PageHead, Pill, ProposedTag } from "@/components/ui";
import { getProviderAdapter } from "@/lib/adapters/types";
import { centsToDecimalString } from "@/lib/money";
import { KATAPULT_STAKE_KEY, cueFlowAuthorized } from "@/lib/policy";
import { ledgerFor, pageMember } from "@/lib/page";

export const metadata = { title: "Settings" };

export default async function Settings() {
  const ctx = await pageMember();
  const db = getDb();
  const isAdmin = ctx.role === "admin";
  const [data, rules, assets, batches, health] = await Promise.all([
    ledgerFor(ctx.householdId),
    db.select({ r: merchantRules, by: users.name, email: users.email }).from(merchantRules).leftJoin(users, eq(users.id, merchantRules.suggestedBy)).where(eq(merchantRules.householdId, ctx.householdId)).orderBy(desc(merchantRules.createdAt)),
    db.select().from(netWorthManualAssets).where(eq(netWorthManualAssets.householdId, ctx.householdId)),
    db.select().from(importBatches).where(eq(importBatches.householdId, ctx.householdId)).orderBy(desc(importBatches.startedAt)).limit(10),
    getProviderAdapter().health(),
  ]);
  const catName = new Map(data.categories.map((c) => [c.id, `${c.group} · ${c.name}`]));
  const proposed = data.categories.filter((c) => c.proposed).length;
  const suggested = rules.filter(({ r }) => !r.confirmedAt && !r.rejectedAt);
  const confirmed = rules.filter(({ r }) => r.confirmedAt);
  const stake = assets.find((a) => a.systemKey === KATAPULT_STAKE_KEY);
  const otherAssets = assets.filter((a) => !a.systemKey);

  return (
    <>
      <PageHead title="Settings" sub="Household configuration. Every change is recorded in the audit history.">
        <Link className="btn" href="/settings/audit">
          Audit history
        </Link>
      </PageHead>

      <Card title="CSV import" icon={<span id="import" />}>
        <ActionForm action={importCsvAction} aria-label="Import CSV">
          <div className="form-grid">
            <label>
              CSV file (transactions or balances)
              <input type="file" name="file" accept=".csv,text/csv" required />
            </label>
          </div>
          <div className="form-actions" style={{ marginTop: 10 }}>
            <Submit pendingText="Importing…">Import</Submit>
            <a className="small" href="/csv-format.txt" target="_blank">
              Column map
            </a>
          </div>
          <p className="small muted" style={{ marginTop: 8 }}>
            Imports are idempotent: a re-uploaded file or a repeated external_id is skipped, and existing rows are never changed. Rows naming Katapult accounts or charges are excluded by policy.
          </p>
        </ActionForm>
        {batches.length ? (
          <details className="details" style={{ marginTop: 10 }}>
            <summary className="small muted">Recent imports ({batches.length})</summary>
            <ul className="small" style={{ margin: 0 }}>
              {batches.map((b) => (
                <li key={b.id}>
                  {b.startedAt.toISOString().slice(0, 16).replace("T", " ")} · {b.fileName} · {b.adapter} · {JSON.stringify({ inserted: (b.stats as { inserted?: number })?.inserted, duplicates: (b.stats as { duplicates?: number })?.duplicates })}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Card>

      <Card title="Integrations & authorizations">
        <dl className="kv">
          <dt>Bank data provider</dt>
          <dd>
            <Pill tone="plan">{health.status === "not_configured" ? "Not configured" : health.status}</Pill> <span className="small muted">Read-only adapter. Credentials are set by the owner in server secrets, never here.</span>
          </dd>
          <dt>Cue Flow</dt>
          <dd>{cueFlowAuthorized() ? <Pill tone="ok">Authorized by owner</Pill> : <Pill tone="plan">Unread: awaiting explicit owner authorization</Pill>}</dd>
          <dt>Payments / transfers</dt>
          <dd>
            <Pill tone="plan">Not supported by design</Pill>
          </dd>
        </dl>
      </Card>

      <Card title="Merchant rules" action={!isAdmin ? <span className="small muted">Owner confirms</span> : null}>
        <p className="small muted" style={{ marginBottom: 10 }}>
          Rules are suggested while you categorize, and apply only after the owner confirms them. A rule never changes bank rows. It only fills in a category for rows that have no override.
        </p>
        {suggested.length ? (
          <ul className="list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {suggested.map(({ r, by, email }) => (
              <li key={r.id} className="row" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) auto" }}>
                <span className="cell-main">
                  “{r.pattern}” → {catName.get(r.categoryId) ?? "?"}
                </span>
                <span className="small muted">suggested by {by ?? email}</span>
                {isAdmin ? (
                  <span className="form-actions">
                    <ActionForm action={decideRule}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="decision" value="confirm" />
                      <Submit className="btn btn-sm btn-primary">Confirm</Submit>
                    </ActionForm>
                    <ActionForm action={decideRule}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="decision" value="reject" />
                      <Submit className="btn btn-sm">Reject</Submit>
                    </ActionForm>
                  </span>
                ) : (
                  <Pill tone="pend">Awaiting owner</Pill>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">No rules awaiting confirmation.</p>
        )}
        {confirmed.length ? (
          <details className="details" style={{ marginTop: 10 }}>
            <summary className="small muted">Confirmed rules ({confirmed.length})</summary>
            {confirmed.map(({ r }) => (
              <ActionForm key={r.id} action={decideRule} className="form-actions">
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="decision" value="reject" />
                <span>
                  “{r.pattern}” → {catName.get(r.categoryId)}
                </span>
                {isAdmin ? <Submit className="btn btn-sm">Disable</Submit> : null}
              </ActionForm>
            ))}
          </details>
        ) : null}
      </Card>

      <Card title="Net-worth manual assets">
        {stake ? (
          <div className="mini" style={{ marginBottom: 12 }}>
            <div className="mini-top">
              <span>Single allowed Katapult value</span>
              {stake.amountCents === null ? <Pill tone="plan">Awaiting owner value</Pill> : <Pill tone="ok">Owner-entered</Pill>}
            </div>
            <strong>{stake.label}</strong>
            <span className="mini-amount">{stake.amountCents === null ? "Not set" : <Money cents={stake.amountCents} />}</span>
            <p className="small muted">The owner supplies this value; nothing is calculated or read from any Katapult account. Leave it blank to keep it out of net worth.</p>
            {isAdmin ? (
              <ActionForm action={saveManualAsset} className="form-actions">
                <input type="hidden" name="id" value={stake.id} />
                <label style={{ flex: "1 1 160px" }}>
                  Value
                  <input name="amount" inputMode="decimal" defaultValue={stake.amountCents !== null ? centsToDecimalString(stake.amountCents) : ""} />
                </label>
                <label style={{ flex: "2 1 220px" }}>
                  Notes
                  <input name="notes" defaultValue={stake.notes ?? ""} />
                </label>
                <Submit className="btn btn-sm">Save value</Submit>
              </ActionForm>
            ) : (
              <p className="small muted">Only the owner can set this value.</p>
            )}
          </div>
        ) : null}
        {otherAssets.map((a) => (
          <div key={a.id} className="mini" style={{ marginBottom: 10 }}>
            <ActionForm action={saveManualAsset} className="form-actions">
              <input type="hidden" name="id" value={a.id} />
              <label style={{ flex: "2 1 200px" }}>
                Label
                <input name="label" defaultValue={a.label} required />
              </label>
              <label style={{ flex: "1 1 140px" }}>
                Value
                <input name="amount" inputMode="decimal" defaultValue={a.amountCents !== null ? centsToDecimalString(a.amountCents) : ""} />
              </label>
              <label style={{ flex: "2 1 200px" }}>
                Notes
                <input name="notes" defaultValue={a.notes ?? ""} />
              </label>
              <Submit className="btn btn-sm">Save</Submit>
            </ActionForm>
            <ActionForm action={deleteManualAsset}>
              <input type="hidden" name="id" value={a.id} />
              <Submit className="btn btn-sm btn-danger">Remove</Submit>
            </ActionForm>
          </div>
        ))}
        <ActionForm action={saveManualAsset} resetOnSuccess className="form-actions" aria-label="Add manual asset">
          <label style={{ flex: "2 1 200px" }}>
            New asset label
            <input name="label" required placeholder="e.g. Home (owner estimate)" />
          </label>
          <label style={{ flex: "1 1 140px" }}>
            Value
            <input name="amount" inputMode="decimal" />
          </label>
          <Submit className="btn btn-sm">Add asset</Submit>
        </ActionForm>
      </Card>

      <Card
        title="Categories"
        action={
          proposed && isAdmin ? (
            <ActionForm action={approveProposedCategories}>
              <Submit className="btn btn-sm">Approve {proposed} proposed defaults</Submit>
            </ActionForm>
          ) : null
        }
      >
        <ul className="list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {data.categories.map((c) => (
            <li key={c.id} style={{ borderBottom: "1px solid var(--border)", padding: "6px 0" }}>
              <ActionForm action={saveCategory} className="form-actions" aria-label={`Edit category ${c.name}`}>
                <input type="hidden" name="id" value={c.id} />
                <label style={{ flex: "1 1 120px" }}>
                  Group
                  <input name="group" defaultValue={c.group} required />
                </label>
                <label style={{ flex: "1 1 140px" }}>
                  Name
                  <input name="name" defaultValue={c.name} required />
                </label>
                <label style={{ flex: "1 1 140px" }}>
                  Kind
                  <select name="kind" defaultValue={c.kind}>
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                    <option value="transfer">Transfer (excluded)</option>
                    <option value="card_payment">Card payment (excluded)</option>
                    <option value="excluded">Excluded</option>
                  </select>
                </label>
                {c.proposed ? <ProposedTag /> : null}
                <Submit className="btn btn-sm">Save</Submit>
              </ActionForm>
              <ActionForm action={archiveCategory}>
                <input type="hidden" name="id" value={c.id} />
                <Submit className="btn btn-sm btn-ghost">Archive</Submit>
              </ActionForm>
            </li>
          ))}
        </ul>
        <h3 style={{ margin: "14px 0 8px" }}>Add category</h3>
        <ActionForm action={saveCategory} resetOnSuccess className="form-actions" aria-label="Add category">
          <label style={{ flex: "1 1 120px" }}>
            Group
            <input name="group" required />
          </label>
          <label style={{ flex: "1 1 140px" }}>
            Name
            <input name="name" required />
          </label>
          <label style={{ flex: "1 1 140px" }}>
            Kind
            <select name="kind" defaultValue="expense">
              <option value="expense">Expense</option>
              <option value="income">Income</option>
              <option value="transfer">Transfer (excluded)</option>
              <option value="card_payment">Card payment (excluded)</option>
              <option value="excluded">Excluded</option>
            </select>
          </label>
          <Submit className="btn btn-sm">Add</Submit>
        </ActionForm>
        {!data.categories.length ? <Empty title="No categories" /> : null}
      </Card>
    </>
  );
}
