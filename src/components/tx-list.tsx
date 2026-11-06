import Link from "next/link";
import type { EffectiveLine } from "@/lib/calc/ledger";
import { shortDate } from "@/lib/dates";
import { Empty, Money, Pill } from "./ui";

export function TxList({ lines, categoryName, accountName, empty }: { lines: EffectiveLine[]; categoryName: (id: string | null) => string | null; accountName: (id: string | null) => string; empty?: React.ReactNode }) {
  if (!lines.length) return <>{empty ?? <Empty title="No transactions match">Try another month or clear filters.</Empty>}</>;
  return (
    <div className="list" role="list" aria-label="Transactions">
      <div className="row row-head" aria-hidden>
        <span>Date</span>
        <span>Merchant</span>
        <span>Category</span>
        <span>Account</span>
        <span style={{ textAlign: "right" }}>Amount</span>
      </div>
      {lines.map((l) => {
        const cat = categoryName(l.categoryId);
        return (
          <Link role="listitem" key={l.key} className="row" href={`/transactions/${l.source}/${l.txId}`}>
            <span className="small muted">{shortDate(l.date)}</span>
            <span className="cell-main">
              {l.merchant}
              {l.pending ? (
                <>
                  {" "}
                  <Pill tone="pend">Bank-pending</Pill>
                </>
              ) : null}
              {l.source === "manual" ? (
                <>
                  {" "}
                  <Pill tone="plan">Manual</Pill>
                </>
              ) : null}
              {l.isSplit ? (
                <>
                  {" "}
                  <Pill tone="due">Split</Pill>
                </>
              ) : null}
            </span>
            <span className="cell-main">{cat ? <>{cat}{l.categorySource === "rule" ? <span className="small muted"> · rule</span> : null}</> : <Pill tone="late">Needs category</Pill>}</span>
            <span className="cell-main small muted">{accountName(l.accountId)}</span>
            <Money className={`amt ${l.amountCents > 0 ? "pos" : ""}`} cents={l.amountCents} sign />
          </Link>
        );
      })}
    </div>
  );
}
