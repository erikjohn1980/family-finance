/**
 * Scope policy (owner rules). Finance covers OAL, Cue Flow, and personal finances only.
 * Nothing Katapult-related belongs in this app (owner decision, Nov 2026): Katapult accounts and
 * charges are excluded at import, and accounts, manual entries and assets naming Katapult are refused.
 */
export const EXCLUDED_PATTERNS = [/katapult/i];

export function isExcludedByPolicy(...fields: (string | null | undefined)[]): boolean {
  return fields.some((f) => !!f && EXCLUDED_PATTERNS.some((p) => p.test(f)));
}

/** Business sections shown as scoped (possibly empty) sections. No invented revenue. */
export const BUSINESS_UNITS = ["OAL", "Cue Flow"] as const;

/** Cue Flow data stays unread until the owner explicitly authorizes it. */
export function cueFlowAuthorized(): boolean {
  return process.env.CUE_FLOW_AUTHORIZED === "true";
}
