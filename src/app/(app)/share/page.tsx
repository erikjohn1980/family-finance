import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { householdMembers, invites, users } from "@/db/schema";
import { createInvite, removeMember, revokeInvite } from "@/app/actions";
import { ActionForm, Submit } from "@/components/forms";
import { Card, PageHead, Pill } from "@/components/ui";
import { pageMember } from "@/lib/page";

export const metadata = { title: "Share" };

export default async function Share() {
  const ctx = await pageMember();
  const db = getDb();
  const [members, pending] = await Promise.all([
    db.select({ id: householdMembers.id, userId: householdMembers.userId, role: householdMembers.role, name: users.name, email: users.email }).from(householdMembers).innerJoin(users, eq(users.id, householdMembers.userId)).where(eq(householdMembers.householdId, ctx.householdId)),
    db.select().from(invites).where(and(eq(invites.householdId, ctx.householdId), isNull(invites.acceptedAt), isNull(invites.revokedAt))).orderBy(desc(invites.createdAt)),
  ]);
  const isAdmin = ctx.role === "admin";
  return (
    <>
      <PageHead title="Share" sub="Access is invite-only, through an authenticated Google sign-in. Public share links do not exist." />
      <Card title="Members">
        <ul className="list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {members.map((m) => (
            <li key={m.id} className="row" style={{ gridTemplateColumns: "minmax(0,1fr) auto auto" }}>
              <span className="cell-main">
                <strong>{m.name ?? m.email}</strong> <span className="small muted">{m.email}</span>
              </span>
              <Pill tone={m.role === "admin" ? "due" : "plan"}>{m.role === "admin" ? "Owner" : "Member"}</Pill>
              {isAdmin && m.userId !== ctx.userId ? (
                <ActionForm action={removeMember}>
                  <input type="hidden" name="id" value={m.id} />
                  <Submit className="btn btn-sm btn-danger">Remove</Submit>
                </ActionForm>
              ) : (
                <span />
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Invite a household member">
        {isAdmin ? (
          <ActionForm action={createInvite} resetOnSuccess aria-label="Invite">
            <div className="form-grid">
              <label>
                Their Google account email
                <input type="email" name="email" required autoComplete="off" />
              </label>
            </div>
            <div className="form-actions" style={{ marginTop: 10 }}>
              <Submit>Create invite</Submit>
              <span className="small muted">The link is single-use, expires in 7 days, and only works for that email.</span>
            </div>
          </ActionForm>
        ) : (
          <p className="muted">Only the owner can invite members.</p>
        )}
        {pending.length ? (
          <ul className="list" style={{ listStyle: "none", margin: "12px 0 0", padding: 0 }}>
            {pending.map((i) => (
              <li key={i.id} className="row" style={{ gridTemplateColumns: "minmax(0,1fr) auto auto" }}>
                <span className="cell-main">{i.email}</span>
                <span className="small muted">{i.expiresAt < new Date() ? "expired" : `expires ${i.expiresAt.toISOString().slice(0, 10)}`}</span>
                {isAdmin ? (
                  <ActionForm action={revokeInvite}>
                    <input type="hidden" name="id" value={i.id} />
                    <Submit className="btn btn-sm">Revoke</Submit>
                  </ActionForm>
                ) : (
                  <span />
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </>
  );
}
