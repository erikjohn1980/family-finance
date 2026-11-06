"use client";
export function ErrorState({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="empty" role="alert">
      <strong style={{ color: "var(--late)" }}>This screen failed to load.</strong>
      <span>No data was changed. {error.digest ? <span className="small">Ref {error.digest}</span> : null}</span>
      <button className="btn" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
