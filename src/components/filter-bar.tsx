"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { setPref } from "@/app/actions";

const SCOPES: [string, string][] = [
  ["default", "Default view"],
  ["household", "Household only"],
  ["business", "Business only"],
  ["trust", "Trust"],
  ["all", "Everything"],
];

/** Month + scope filters. Changes persist per user (survive reload) and are reflected in the URL. */
export function FilterBar({ month, scope, showScope = true, showMonth = true }: { month: string; scope: string; showScope?: boolean; showMonth?: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  function update(next: { month?: string; scope?: string }) {
    const m = next.month ?? month;
    const s = next.scope ?? scope;
    start(async () => {
      await setPref("filters", { month: m, scope: s });
      const p = new URLSearchParams(sp.toString());
      p.set("month", m);
      p.set("scope", s);
      router.push(`${path}?${p}`);
    });
  }
  return (
    <div className="filters" aria-busy={pending}>
      {showMonth ? (
        <label>
          Month
          <input type="month" value={month} onChange={(e) => e.target.value && update({ month: e.target.value })} />
        </label>
      ) : null}
      {showScope ? (
        <label>
          Scope
          <select value={scope} onChange={(e) => update({ scope: e.target.value })}>
            {SCOPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {pending ? <span className="small muted">Updating…</span> : null}
    </div>
  );
}
