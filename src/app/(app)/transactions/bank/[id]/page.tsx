import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, or } from "drizzle-orm";
import { getDb } from "@/db";
import { bankTransactions, ledgerOverrides, pendingLinks, users } from "@/db/schema";
import { categorizeBankTx, splitBankTx } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { AuditList } from "@/components/audit-list";
import { Card, Money, PageHead, Pill } from "@/components/ui";
import { shortDate } from "@/lib/dates";
import { auditFor } from "@/lib/data/audit";
import { ledgerFor, pageMember } from "@/lib/page";

export const metadata = { title: "Bank transaction" };

export default async function BankTxDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await pageMember();
  const db = getDb();
  const [tx] = await db.select().from(bankTransactions).where(and(eq(bankTransactions.id, id), eq(bankTransactions.householdId, ctx.householdId)));
  if (!tx) notFound();
  const [data, history, links, audit] = await Promise.all([
    ledgerFor(ctx.householdId),
    db
      .select({ o: ledgerOverrides, actor: users.name, email: users.email })
      .from(ledgerOverrides)
      .leftJoin(users, eq(users.id, ledgerOverrides.actorId))
      .where(eq(ledgerOverrides.bankTxId, id))
      .orderBy(desc(ledgerOverrides.createdAt)),
    db.select().from(pendingLinks).where(or(eq(pendingLinks.pendingTxId, id), eq(pendingLinks.postedTxId, id))),
    auditFor(db, ctx.householdId, { entityIds: [id] }),
  ]);
  const eff = data.lines.filter((l) => l.txId === id);
  const catName = new Map(data.categories.map((c) => [c.id, `${c.group} · ${c.name}`]));
  const account = data.accounts.find((a) => a.id === tx.accountId);
  const link = links[0];
  const twinId = link ? (link.pendingTxId === id ? link.postedTxId : link.pendingTxId) : null;
  const stale = data.stalePendingIds.includes(id);
  const current = eff[0];

  return (
    <>
      <PageHead title={tx.merchantRaw} sub={<>Imported bank row · {shortDate(tx.postedAt)} · {account?.name}</>}>
        <Link className="btn" href={`/recurring?verify=bank:${tx.id}`}>
          Track as recurring bill
        </Link>
      </PageHead>
      <div className="grid grid-2">
        <Card title="Source row (read-only)">
          <dl className="kv">
            <dt>Amount</dt>
            <dd>
              <Money cents={tx.amountCents} sign />
            </dd>
            <dt>Status</dt>
            <dd>{tx.pending ? <Pill tone="pend">Bank-pending</Pill> : <Pill tone="ok">Posted</Pill>} {stale ? <Pill tone="late">Stale pending — excluded</Pill> : null}</dd>
            <dt>External id</dt>
            <dd className="small">{tx.externalId}</dd>
            <dt>Account</dt>
            <dd>
              {account?.name}
              {account?.maskLast4 ? ` ••${account.maskLast4}` : ""} · {account?.scope}
            </dd>
            <dt>Imported</dt>
            <dd className="small">{tx.importedAt.toISOString().slice(0, 10)}</dd>
            {twinId ? (
              <>
                <dt>{link!.pendingTxId === id ? "Posted twin" : "Pending twin"}</dt>
                <dd>
                  <Link href={`/transactions/bank/${twinId}`}>Open</Link> <span className="small muted">({link!.rule})</span>
                </dd>
              </>
            ) : null}
          </dl>
          <p className="small muted" style={{ marginTop: 12 }}>
            This row is the immutable source of truth. Categories, memos and splits are stored as overrides and never modify it.
          </p>
        </Card>
        <Card title="Effective categorization">
          {link && link.pendingTxId === id ? (
            <p className="small muted">This pending row has posted. Its categorization carries to the posted twin unless that row has its own.</p>
          ) : null}
          {eff.length ? (
            <ul style={{ listStyle: "none", margin: "0 0 12px", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {eff.map((l) => (
                <li key={l.key} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span>
                    {l.categoryId ? catName.get(l.categoryId) : <Pill tone="late">Needs category</Pill>}{" "}
                    <span className="small muted">{l.categorySource ?? ""}</span>
                  </span>
                  <Money cents={l.amountCents} sign />
                </li>
              ))}
            </ul>
          ) : null}
          <ActionForm action={categorizeBankTx} aria-label="Categorize">
            <input type="hidden" name="txId" value={tx.id} />
            <div className="form-grid">
              <label>
                Category
                <select name="categoryId" defaultValue={current?.isSplit ? "" : current?.categoryId ?? ""} required>
                  <option value="">Choose…</option>
                  {data.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.group} · {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Memo
                <input name="memo" maxLength={500} defaultValue={current?.memo ?? ""} />
              </label>
            </div>
            <label className="inline" style={{ marginTop: 10 }}>
              <input type="checkbox" name="suggestRule" /> Suggest a merchant rule (applies only after the owner confirms)
            </label>
            <div className="form-actions" style={{ marginTop: 10 }}>
              <Submit>Save category</Submit>
            </div>
          </ActionForm>
        </Card>
      </div>
      <Card title="Split (optional)">
        <ActionForm action={splitBankTx} aria-label="Split transaction">
          <input type="hidden" name="txId" value={tx.id} />
          <p className="small muted" style={{ marginBottom: 10 }}>
            Enter positive amounts that add up to <Money cents={Math.abs(tx.amountCents)} />.
          </p>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="form-grid" style={{ marginBottom: 8 }}>
              <label>
                Part {i + 1} category
                <select name={`cat_${i}`} defaultValue="">
                  <option value="">—</option>
                  {data.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.group} · {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Part {i + 1} amount
                <input name={`amt_${i}`} inputMode="decimal" placeholder="0.00" />
              </label>
            </div>
          ))}
          <Submit>Save split</Submit>
        </ActionForm>
      </Card>
      <Card title="Override history">
        {history.length ? (
          <ol className="list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {history.map(({ o, actor, email }) => (
              <li key={o.id} className="row" style={{ gridTemplateColumns: "170px 120px minmax(0,1fr) auto" }}>
                <span className="small muted">{o.createdAt.toISOString().replace("T", " ").slice(0, 16)} UTC</span>
                <span>{actor ?? email}</span>
                <span className="cell-main">
                  {o.categoryId ? catName.get(o.categoryId) ?? "archived category" : "memo only"}
                  {o.memo ? <span className="muted"> — {o.memo}</span> : null}
                </span>
                <span className="small muted">{o.splitAmountCents !== null ? <Money cents={o.splitAmountCents} /> : ""}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">No overrides yet.</p>
        )}
      </Card>
      <Card title="Audit history">
        <AuditList rows={audit} />
      </Card>
    </>
  );
}
