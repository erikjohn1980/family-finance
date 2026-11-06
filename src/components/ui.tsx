import type { ReactNode } from "react";
import { formatCents } from "@/lib/money";

export type Tone = "ok" | "due" | "late" | "pend" | "plan";
export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export function Money({ cents, whole, sign, className = "" }: { cents: number | null | undefined; whole?: boolean; sign?: boolean; className?: string }) {
  return <span className={`num ${className}`}>{formatCents(cents, { whole, sign })}</span>;
}

export function Progress({ pct, state, label }: { pct: number | null; state?: "ok" | "near" | "over" | "accent"; label: string }) {
  const v = pct === null ? 0 : Math.max(0, Math.min(1, pct));
  return (
    <div className={`progress ${state ?? ""}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}>
      <span style={{ width: `${v * 100}%` }} />
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty" role="status">
      <strong style={{ color: "var(--text)" }}>{title}</strong>
      {children}
    </div>
  );
}

export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub ? <p className="sub">{sub}</p> : null}
      </div>
      {children ? <div className="form-actions">{children}</div> : null}
    </div>
  );
}

export function Card({ title, icon, action, children, className = "" }: { title?: ReactNode; icon?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {title ? (
        <div className="card-head">
          <h2 className="card-title">
            {icon}
            {title}
          </h2>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function FreshBadge({ freshness, source }: { freshness: "fresh" | "stale" | "unknown"; source: "import" | "manual" }) {
  return (
    <span style={{ display: "inline-flex", gap: 6 }}>
      {freshness === "fresh" ? <Pill tone="ok">Fresh</Pill> : freshness === "stale" ? <Pill tone="late">Stale</Pill> : <Pill tone="plan">No balance</Pill>}
      <Pill tone="plan">{source === "import" ? "Import" : "Manual"}</Pill>
    </span>
  );
}

export function ProposedTag() {
  return (
    <span className="pill pill-plan" title="App default awaiting owner approval">
      Proposed
    </span>
  );
}

export function BillPill({ status }: { status: "paid" | "due" | "overdue" | "awaiting" }) {
  return status === "paid" ? <Pill tone="ok">Paid</Pill> : status === "due" ? <Pill tone="due">Due</Pill> : status === "overdue" ? <Pill tone="late">Overdue</Pill> : <Pill tone="plan">Awaiting charge</Pill>;
}
