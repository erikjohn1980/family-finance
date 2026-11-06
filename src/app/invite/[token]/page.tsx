import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { invites } from "@/db/schema";
import { signIn } from "@/auth";

export const metadata = { title: "Invitation" };
export const dynamic = "force-dynamic";

export default async function Invite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const hash = createHash("sha256").update(token).digest("hex");
  const [inv] = await getDb()
    .select({ email: invites.email, expiresAt: invites.expiresAt })
    .from(invites)
    .where(and(eq(invites.tokenHash, hash), isNull(invites.acceptedAt), isNull(invites.revokedAt), gt(invites.expiresAt, new Date())))
    .limit(1);
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 }}>
      <div className="card" style={{ width: "min(440px, 100%)", display: "flex", flexDirection: "column", gap: 14 }}>
        <h1>Family Finance invitation</h1>
        {inv ? (
          <>
            <p>
              You have been invited to the household. Sign in with the Google account <strong>{inv.email.replace(/^(.).*(@.*)$/, "$1•••$2")}</strong>.
            </p>
            <form
              action={async () => {
                "use server";
                await signIn("google", { redirectTo: "/" });
              }}
            >
              <button className="btn btn-primary" type="submit" style={{ width: "100%" }}>
                Continue with Google
              </button>
            </form>
          </>
        ) : (
          <p className="form-msg err" role="alert">
            This invitation is invalid, expired, revoked, or already used. Ask the owner for a new one.
          </p>
        )}
      </div>
    </main>
  );
}
