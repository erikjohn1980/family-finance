export function LoadingState() {
  return (
    <div aria-busy="true" aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <span className="sr-only">Loading…</span>
      <div className="skeleton" style={{ height: 34, width: 260 }} />
      <div className="grid grid-kpi">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton" style={{ height: 130 }} />
        ))}
      </div>
      <div className="skeleton" style={{ height: 260 }} />
    </div>
  );
}
