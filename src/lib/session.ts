import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { householdMembers, users } from "@/db/schema";

export type MemberContext = {
  userId: string;
  email: string;
  name: string | null;
  role: "admin" | "member";
  householdId: string;
};

export class HttpError extends Error {
  constructor(public status: 401 | 403 | 400 | 404 | 409, message: string) {
    super(message);
  }
}

/** Resolve the signed-in household member, checking membership in the DB on every call. */
export async function getMember(): Promise<{ ok: true; ctx: MemberContext } | { ok: false; status: 401 | 403 }> {
  const session = await auth();
  const uid = (session?.user as { id?: string } | undefined)?.id;
  if (!uid) return { ok: false, status: 401 };
  const [row] = await getDb()
    .select({ userId: users.id, email: users.email, name: users.name, role: householdMembers.role, householdId: householdMembers.householdId })
    .from(householdMembers)
    .innerJoin(users, eq(users.id, householdMembers.userId))
    .where(eq(householdMembers.userId, uid))
    .limit(1);
  if (!row) return { ok: false, status: 403 };
  return { ok: true, ctx: { ...row, email: row.email ?? "" } };
}

/** For pages: redirect to login (401) or the no-access page (403). */
export async function requirePageMember(): Promise<MemberContext> {
  const r = await getMember();
  if (!r.ok) redirect(r.status === 401 ? "/login" : "/login?error=AccessDenied");
  return r.ctx;
}

/** For server actions: throw on missing auth. */
export async function requireActionMember(): Promise<MemberContext> {
  const r = await getMember();
  if (!r.ok) throw new HttpError(r.status, r.status === 401 ? "Not signed in" : "Not a household member");
  return r.ctx;
}

export async function requireAdmin(): Promise<MemberContext> {
  const ctx = await requireActionMember();
  if (ctx.role !== "admin") throw new HttpError(403, "Owner (admin) only");
  return ctx;
}

/** For route handlers. */
export function withMember(handler: (ctx: MemberContext, req: Request) => Promise<Response>) {
  return async (req: Request) => {
    const r = await getMember();
    if (!r.ok) return Response.json({ error: r.status === 401 ? "unauthorized" : "forbidden" }, { status: r.status });
    return handler(r.ctx, req);
  };
}
