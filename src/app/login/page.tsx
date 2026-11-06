import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn, testAuthEnabled } from "@/auth";
import { getMember } from "@/lib/session";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  AccessDenied: "This Google account is not a member of the household. Ask the owner for an invite.",
  Configuration: "Sign-in is not configured yet. The owner must set the Google OAuth credentials on the server.",
  CredentialsSignin: "That email is not invited.",
};

export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const m = await getMember();
  if (m.ok) redirect("/");
  const err = sp.error ? ERRORS[sp.error] ?? "Sign-in failed. Try again." : m.status === 403 ? ERRORS.AccessDenied : null;
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 }}>
      <div className="card" style={{ width: "min(420px, 100%)", display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="brand" style={{ padding: 0 }}>
          <span className="brand-mark" aria-hidden>
            FF
          </span>
          Family Finance
        </div>
        <h1>Sign in</h1>
        <p className="muted">A private household ledger. Access requires an invitation from the owner.</p>
        {err ? (
          <p className="form-msg err" role="alert">
            {err}
          </p>
        ) : null}
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
        {testAuthEnabled() ? (
          <form
            action={async (fd: FormData) => {
              "use server";
              try {
                await signIn("test-login", { email: String(fd.get("email") ?? ""), redirectTo: "/" });
              } catch (e) {
                if (e instanceof AuthError) redirect(`/login?error=${e.type}`);
                throw e;
              }
            }}
            style={{ borderTop: "1px solid var(--border)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}
          >
            <p className="small muted">Local test sign-in (disabled in production)</p>
            <label>
              Email
              <input name="email" type="email" required />
            </label>
            <button className="btn" type="submit">
              Test sign-in
            </button>
          </form>
        ) : null}
      </div>
    </main>
  );
}
