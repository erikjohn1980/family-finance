"use client";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

export type ActionResult = { ok?: string; error?: string; at?: number } | null;
export type FormAction = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;

export function ActionForm({ action, children, className, resetOnSuccess, id, "aria-label": ariaLabel }: { action: FormAction; children: ReactNode; className?: string; resetOnSuccess?: boolean; id?: string; "aria-label"?: string }) {
  // Announce from the action itself so the result survives when revalidation unmounts this form.
  const [state, formAction] = useActionState(async (prev: ActionResult, fd: FormData) => {
    const r = await action(prev, fd);
    if (r?.ok || r?.error) window.dispatchEvent(new CustomEvent("ff:toast", { detail: { text: r.error ?? r.ok, error: !!r.error } }));
    return r;
  }, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className} id={id} aria-label={ariaLabel}>
      {children}
      <div className="form-msg-wrap">
        {state?.error ? (
          <p className="form-msg err">
            {state.error}
          </p>
        ) : state?.ok ? (
          <p className="form-msg ok">{state.ok}</p>
        ) : null}
      </div>
    </form>
  );
}

export function Submit({ children, className = "btn btn-primary", pendingText = "Saving…", name, value }: { children: ReactNode; className?: string; pendingText?: string; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-disabled={pending} name={name} value={value}>
      {pending ? pendingText : children}
    </button>
  );
}

export type ToastDetail = { text: string; error?: boolean; undo?: () => Promise<ActionResult> };
export function toast(detail: ToastDetail) {
  window.dispatchEvent(new CustomEvent<ToastDetail>("ff:toast", { detail }));
}

/** Page-level status region: action results stay visible even when the form's row disappears. Supports Undo. */
export function Toaster() {
  const [msg, setMsg] = useState<(ToastDetail & { id: number }) | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<ToastDetail>).detail;
      const id = Date.now() + Math.random();
      setMsg({ ...d, id });
      setTimeout(() => setMsg((m) => (m?.id === id ? null : m)), d.undo ? 8000 : 6000);
    };
    window.addEventListener("ff:toast", on);
    return () => window.removeEventListener("ff:toast", on);
  }, []);
  return (
    <div className="toast-region" role="status" aria-live="polite" aria-atomic="true">
      {msg ? (
        <div className={`toast ${msg.error ? "toast-err" : ""}`} data-testid="toast">
          <span>{msg.text}</span>
          {msg.undo ? (
            <button
              type="button"
              className="toast-undo"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const r = await msg.undo!();
                setBusy(false);
                toast(r?.error ? { text: r.error, error: true } : { text: r?.ok ?? "Undone" });
              }}
            >
              {busy ? "Undoing…" : "Undo"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
