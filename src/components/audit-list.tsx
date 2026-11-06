import type { auditEvents } from "@/db/schema";
import { Empty } from "./ui";

type Row = typeof auditEvents.$inferSelect & { actorName: string | null };

export function AuditList({ rows }: { rows: Row[] }) {
  if (!rows.length) return <Empty title="No history yet" />;
  return (
    <ol className="list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {rows.map((r) => (
        <li key={r.id} className="row" style={{ gridTemplateColumns: "170px 120px minmax(0,1fr)" }}>
          <span className="small muted">{r.at.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC</span>
          <span>{r.actorName ?? "system"}</span>
          <span className="cell-main">
            <strong>{r.action}</strong> <span className="muted small">{r.entity}</span>
            <details className="details">
              <summary className="small muted">Before / after</summary>
              <pre className="small" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: 0 }}>{JSON.stringify({ before: r.before, after: r.after }, null, 2)}</pre>
            </details>
          </span>
        </li>
      ))}
    </ol>
  );
}
