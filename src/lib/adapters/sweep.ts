/**
 * Sweep cash correction (owner rule). Adapter-owned.
 *
 * For a designated sweep checking account:
 *   reported cash = available_balance + |newest unmatched overnight sweep purchase|
 * If a bank-pending redemption matches that purchase, the sweep component is 0
 * (available already includes it). Purchase+redemption pairs that both posted are ignored.
 * Never double-count.
 */
export type SweepEvent = {
  id: string;
  date: string; // YYYY-MM-DD
  type: "purchase" | "redemption";
  amountCents: number; // sign ignored; absolute value used
  pending: boolean;
};

export function sweepComponent(events: SweepEvent[]): { componentCents: number; purchaseId: string | null; reason: string } {
  const purchases = events.filter((e) => e.type === "purchase" && !e.pending).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const postedRedemptions = events.filter((e) => e.type === "redemption" && !e.pending);
  const pendingRedemptions = events.filter((e) => e.type === "redemption" && e.pending);
  const usedRedemptions = new Set<string>();

  // Pair posted purchase with a posted redemption of the same amount on/after its date → ignored.
  const unmatched: SweepEvent[] = [];
  for (const p of purchases) {
    const r = postedRedemptions.find((x) => !usedRedemptions.has(x.id) && Math.abs(x.amountCents) === Math.abs(p.amountCents) && x.date >= p.date);
    if (r) usedRedemptions.add(r.id);
    else unmatched.push(p);
  }
  if (unmatched.length === 0) return { componentCents: 0, purchaseId: null, reason: "no unmatched sweep purchase" };
  const newest = unmatched[unmatched.length - 1];
  const pendingMatch = pendingRedemptions.find((x) => Math.abs(x.amountCents) === Math.abs(newest.amountCents) && x.date >= newest.date);
  if (pendingMatch) return { componentCents: 0, purchaseId: newest.id, reason: "pending redemption matches newest purchase; available already includes it" };
  return { componentCents: Math.abs(newest.amountCents), purchaseId: newest.id, reason: "newest unmatched sweep purchase added" };
}

/** Extract sweep events from imported bank rows. CSV column `sweep_type` (purchase|redemption) marks them. */
export function sweepEventsFromRows(rows: { id: string; postedAt: string; amountCents: number; pending: boolean; payload: Record<string, unknown> }[]): SweepEvent[] {
  const out: SweepEvent[] = [];
  for (const r of rows) {
    const t = String(r.payload?.sweep_type ?? "").toLowerCase();
    if (t === "purchase" || t === "redemption") out.push({ id: r.id, date: r.postedAt, type: t, amountCents: r.amountCents, pending: r.pending });
  }
  return out;
}
