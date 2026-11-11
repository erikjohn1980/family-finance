import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { authAccounts, sessions, users, verificationTokens } from "@/db/schema";
import { ensureMembership, isEmailAllowed, normEmail } from "@/lib/household";

/**
 * Test-only sign-in for automated e2e tests. Hard-disabled in production builds and
 * for any non-local database, so it can never be enabled on a deployed instance.
 */
export function testAuthEnabled(): boolean {
  if (process.env.AUTH_TEST_MODE !== "true") return false;
  if (process.env.NODE_ENV === "production") return false;
  const url = process.env.DATABASE_URL ?? "";
  return /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);
}

const providers = [
  Google({
    // Only verified Google emails are accepted (see signIn callback).
    allowDangerousEmailAccountLinking: false,
  }),
  ...(testAuthEnabled()
    ? [
        Credentials({
          id: "test-login",
          name: "Test login (local only)",
          credentials: { email: { label: "Email", type: "email" } },
          async authorize(creds) {
            if (!testAuthEnabled()) return null;
            const email = normEmail(String(creds?.email ?? ""));
            const db = getDb();
            if (!(await isEmailAllowed(db, email))) return null;
            const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
            const u = existing ?? (await db.insert(users).values({ email, name: email.split("@")[0] }).returning())[0];
            return { id: u.id, email: u.email, name: u.name };
          },
        }),
      ]
    : []),
];

export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  adapter: DrizzleAdapter(getDb(), {
    usersTable: users,
    accountsTable: authAccounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 14 },
  // Dev-only preview pane support: the pane may embed the app cross-site. Never active in production.
  ...(process.env.PREVIEW_MODE === "true" && process.env.NODE_ENV !== "production"
    ? { cookies: { sessionToken: { options: { httpOnly: true, sameSite: "none" as const, secure: true, path: "/", partitioned: true } } } }
    : {}),
  trustHost: true,
  pages: { signIn: "/login", error: "/login" },
  providers,
  callbacks: {
    async signIn({ user, account, profile }) {
      const email = normEmail(user.email ?? profile?.email);
      if (account?.provider === "google" && profile?.email_verified !== true) return false;
      return isEmailAllowed(getDb(), email); // invite-only household
    },
    async jwt({ token, user }) {
      if (user?.id) {
        token.uid = user.id;
        await ensureMembership(getDb(), user.id, normEmail(user.email));
      }
      return token;
    },
    async session({ session, token }) {
      if (token.uid && session.user) (session.user as { id?: string }).id = token.uid as string;
      return session;
    },
  },
}));
