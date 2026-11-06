"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./icons";

export type NavItem = { href: string; label: string; icon: string; count?: number; section?: string };

export const NAV: NavItem[] = [
  { href: "/", label: "Overview", icon: "overview" },
  { href: "/analytics", label: "Analytics", icon: "analytics" },
  { href: "/transactions", label: "All transactions", icon: "list", section: "Transactions" },
  { href: "/income", label: "Income", icon: "income" },
  { href: "/expenses", label: "Expenses", icon: "expense" },
  { href: "/needs-category", label: "Needs category", icon: "tag" },
  { href: "/recurring", label: "Recurring bills", icon: "calendar" },
  { href: "/accounts", label: "Cards & bank", icon: "card", section: "Accounts" },
  { href: "/savings", label: "Savings", icon: "savings" },
  { href: "/investments", label: "Investments", icon: "invest" },
  { href: "/budgets", label: "Budget Limits", icon: "limit", section: "Planning" },
  { href: "/goals", label: "Goals", icon: "goal" },
];

export const TITLES: [string, string][] = [
  ["/transactions/new", "Add transaction"],
  ["/settings/audit", "Audit history"],
  ["/settings", "Settings"],
  ["/share", "Share"],
  ...NAV.map((n) => [n.href, n.label] as [string, string]),
];

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
}

export function Sidebar({ counts, footer }: { counts: Record<string, number>; footer: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    const onToggle = () => setOpen((o) => !o);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("ff:toggle-nav", onToggle);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("ff:toggle-nav", onToggle);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLElement>("a")?.focus();
  }, [open]);
  return (
    <nav ref={ref} className="sidebar" data-open={open} aria-label="Main" id="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden>
          FF
        </span>
        Family Finance
      </div>
      {NAV.map((n) => (
        <div key={n.href}>
          {n.section ? <div className="nav-section">{n.section}</div> : null}
          <Link href={n.href} className="nav-link" aria-current={isActive(path, n.href) ? "page" : undefined}>
            <Icon name={n.icon} />
            {n.label}
            {counts[n.href] ? (
              <span className="count" aria-label={`${counts[n.href]} items`}>
                {counts[n.href]}
              </span>
            ) : null}
          </Link>
        </div>
      ))}
      <div className="nav-section">Household</div>
      <Link href="/settings" className="nav-link" aria-current={isActive(path, "/settings") ? "page" : undefined}>
        <Icon name="settings" />
        Settings
      </Link>
      <div className="sidebar-foot">{footer}</div>
    </nav>
  );
}

export function MenuButton() {
  return (
    <button type="button" className="btn btn-ghost menu-btn" aria-controls="sidebar" aria-label="Open navigation" onClick={() => window.dispatchEvent(new Event("ff:toggle-nav"))}>
      <Icon name="menu" />
    </button>
  );
}

export function Crumbs() {
  const path = usePathname();
  const title = TITLES.find(([href]) => isActive(path, href))?.[1] ?? "Family Finance";
  return (
    <div className="crumbs">
      <span>Family Finance</span>
      <span aria-hidden>›</span>
      <strong aria-current="page">{title}</strong>
    </div>
  );
}

export function SearchBox() {
  const router = useRouter();
  const sp = useSearchParams();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <form
      role="search"
      className="search"
      onSubmit={(e) => {
        e.preventDefault();
        const q = ref.current?.value.trim() ?? "";
        router.push(`/transactions${q ? `?q=${encodeURIComponent(q)}` : ""}`);
      }}
    >
      <Icon name="search" className="nav-icon" />
      <label className="sr-only" htmlFor="global-search">
        Search transactions
      </label>
      <input ref={ref} id="global-search" name="q" placeholder="Search transactions…" defaultValue={sp.get("q") ?? ""} autoComplete="off" />
      <span className="kbd" aria-hidden>
        ⌘K
      </span>
    </form>
  );
}

/** Export the current filters (transactions page params or persisted month/scope). */
export function ExportButton() {
  const path = usePathname();
  const sp = useSearchParams();
  const params = new URLSearchParams();
  for (const k of ["month", "scope", "account", "category", "q", "status"]) {
    const v = sp.get(k);
    if (v) params.set(k, v);
  }
  if (path.startsWith("/expenses") && !params.has("status")) params.set("status", "posted");
  const href = `/api/household/export${params.size ? `?${params}` : ""}`;
  return (
    <a className="btn" href={href} download aria-label="Export CSV">
      <Icon name="download" />
      Export<span className="hide-sm"> CSV</span>
    </a>
  );
}

export function ThemeToggle() {
  return (
    <button
      type="button"
      className="btn btn-sm btn-ghost"
      onClick={() => {
        const root = document.documentElement;
        const cur = root.dataset.theme ?? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
        const next = cur === "light" ? "dark" : "light";
        root.dataset.theme = next;
        document.cookie = `ff-theme=${next}; path=/; max-age=31536000; samesite=lax`;
      }}
    >
      Toggle light / dark
    </button>
  );
}
