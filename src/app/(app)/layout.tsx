import Link from "next/link";
import { Suspense } from "react";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { householdMembers, users } from "@/db/schema";
import { Crumbs, ExportButton, MenuButton, SearchBox, Sidebar, ThemeToggle } from "@/components/shell";
import { Icon } from "@/components/icons";
import { Toaster } from "@/components/forms";
import { demoMode, ledgerFor, pageMember } from "@/lib/page";
import { needsCategory } from "@/lib/calc/ledger";
import { signOutAction } from "../actions";

export const dynamic = "force-dynamic";

function initials(name: string | null, email: string) {
  const src = (name || email).trim();
  return src.slice(0, 1).toUpperCase();
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await pageMember();
  const [data, members] = await Promise.all([
    ledgerFor(ctx.householdId),
    getDb()
      .select({ name: users.name, email: users.email })
      .from(householdMembers)
      .innerJoin(users, eq(users.id, householdMembers.userId))
      .where(eq(householdMembers.householdId, ctx.householdId)),
  ]);
  const needs = needsCategory(data.lines).length;
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <div className="shell">
        <Sidebar
          counts={{ "/needs-category": needs }}
          footer={
            <>
              <ThemeToggle />
              <div className="user-card">
                <span className="avatar" aria-hidden>
                  {initials(ctx.name, ctx.email)}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="cell-main" style={{ fontWeight: 600 }}>
                    {ctx.name || ctx.email}
                  </div>
                  <div className="small muted cell-main">{ctx.role === "admin" ? "Owner" : "Member"}</div>
                </div>
              </div>
              <form action={signOutAction}>
                <button className="btn btn-sm" type="submit" style={{ width: "100%" }}>
                  Sign out
                </button>
              </form>
            </>
          }
        />
        <div className="main">
          <header className="topbar">
            <MenuButton />
            <Crumbs />
            <div className="topbar-actions">
              <Suspense fallback={<div className="search" style={{ width: 240 }} />}>
                <SearchBox />
              </Suspense>
              <Suspense fallback={null}>
                <ExportButton />
              </Suspense>
              <Link className="btn" href="/share">
                <Icon name="share" />
                Share
              </Link>
              <Link className="btn btn-primary" href="/transactions/new" aria-label="Add transaction">
                <Icon name="plus" />
                Add<span className="hide-sm"> transaction</span>
              </Link>
            </div>
          </header>
          <main id="main" className="content" tabIndex={-1}>
            {demoMode() ? (
              <div className="banner banner-demo" role="note">
                <strong>DEMO DATA</strong>
                <span>Every amount, account and merchant on this instance is fictional. Do not enter real financial data here.</span>
              </div>
            ) : null}
            <div className="form-actions" aria-label="Household members">
              <span className="avatars">
                {members.map((m) => (
                  <span key={m.email} className="avatar" title={m.name || m.email || ""}>
                    {initials(m.name, m.email ?? "?")}
                  </span>
                ))}
              </span>
              <span className="small muted">Shared household · {members.length} member{members.length === 1 ? "" : "s"}</span>
            </div>
            {children}
          </main>
          <Toaster />
        </div>
      </div>
    </>
  );
}
