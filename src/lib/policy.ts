/**
 * Scope policy (owner rules). Finance covers OAL, Cue Flow, and personal finances only.
 * Katapult live accounts and Katapult charges are excluded at import time.
 * The single allowed Katapult-related value is the owner-entered 51% cleared-cash stake (net_worth_manual_asset).
 */
export const EXCLUDED_PATTERNS = [/katapult/i];

export function isExcludedByPolicy(...fields: (string | null | undefined)[]): boolean {
  return fields.some((f) => !!f && EXCLUDED_PATTERNS.some((p) => p.test(f)));
}

export const KATAPULT_STAKE_KEY = "katapult_51pct_cleared_cash";

/** Business sections shown as scoped (possibly empty) sections. No invented revenue. */
export const BUSINESS_UNITS = ["OAL", "Cue Flow"] as const;

/** Cue Flow data stays unread until the owner explicitly authorizes it. */
export function cueFlowAuthorized(): boolean {
  return process.env.CUE_FLOW_AUTHORIZED === "true";
}
