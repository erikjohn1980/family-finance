"use client";
import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { quickCategorize, undoQuickCategorize } from "@/app/actions";
import type { Chip } from "@/lib/calc/suggest";
import { toast } from "./forms";

export type InboxItem = {
  source: "bank" | "manual";
  txId: string;
  merchant: string;
  dateLabel: string;
  amountLabel: string;
  inflow: boolean;
  pending: boolean;
  accountLabel: string;
};

/**
 * One queue item: tap a chip to categorize. The card hides at once (optimistic) and comes
 * back if the save fails. Every pick can be undone from the toast.
 */
export function InboxCard({ item, chips, children }: { item: InboxItem; chips: Chip[]; children: ReactNode }) {
  const [hidden, setHidden] = useState(false);
  const [pending, start] = useTransition();
  const [more, setMore] = useState(false);

  function pick(chip: Chip) {
    setHidden(true);
    start(async () => {
      const r = await quickCategorize(item.source, item.txId, chip.categoryId);
      if (r?.error) {
        setHidden(false);
        toast({ text: `Didn't save: ${r.error}`, error: true });
        return;
      }
      toast({
        text: `${item.merchant} → ${chip.label}`,
        undo: async () => {
          const u = await undoQuickCategorize(item.source, item.txId);
          if (!u?.error) setHidden(false); // show the card again even if the list has not refreshed yet
          return u;
        },
      });
    });
  }

  if (hidden) return null;
  return (
    <li className="inbox-card" aria-busy={pending} aria-label={`${item.merchant}, ${item.amountLabel}, ${item.dateLabel}`}>
      <Link href={`/transactions/${item.source}/${item.txId}`} className="inbox-head">
        <span className="inbox-avatar" aria-hidden>
          {item.merchant.trim().slice(0, 1).toUpperCase()}
        </span>
        <span className="inbox-main">
          <span className="inbox-merchant">{item.merchant}</span>
          <span className="inbox-meta">
            {item.dateLabel} · {item.accountLabel}
            {item.pending ? <span className="inbox-pending"> · pending at bank</span> : null}
          </span>
        </span>
        <span className={`inbox-amount num ${item.inflow ? "pos" : ""}`}>{item.amountLabel}</span>
      </Link>
      <div className="chip-row" role="group" aria-label={`Quick categories for ${item.merchant}`}>
        {chips.map((c) => (
          <button key={c.categoryId} type="button" className={`chip ${c.suggested ? "chip-suggested" : ""}`} onClick={() => pick(c)} disabled={pending}>
            {c.suggested ? <span aria-hidden>✓ </span> : null}
            {c.label}
            {c.suggested ? <span className="sr-only"> (suggested)</span> : null}
          </button>
        ))}
        <button type="button" className="chip chip-more" aria-expanded={more} onClick={() => setMore((m) => !m)}>
          More…
        </button>
      </div>
      {more ? <div className="inbox-more">{children}</div> : null}
    </li>
  );
}
