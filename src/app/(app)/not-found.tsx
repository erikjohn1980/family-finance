import Link from "next/link";
export default function NotFound() {
  return (
    <div className="empty" role="status">
      <strong>Not found</strong>
      <span>This item does not exist in the household ledger.</span>
      <Link className="btn" href="/">
        Back to overview
      </Link>
    </div>
  );
}
