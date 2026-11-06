/** Money helpers. All amounts are integer cents. */
export function parseMoneyToCents(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const s = String(input).trim().replace(/[$,\s]/g, "");
  if (s === "") return null;
  let neg = false;
  let body = s;
  if (body.startsWith("(") && body.endsWith(")")) {
    neg = true;
    body = body.slice(1, -1);
  }
  if (body.startsWith("-")) {
    neg = !neg;
    body = body.slice(1);
  } else if (body.startsWith("+")) body = body.slice(1);
  if (!/^\d+(\.\d{0,2})?$/.test(body)) return null;
  const [whole, frac = ""] = body.split(".");
  const c = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(c)) return null;
  return neg ? -c : c;
}

const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const fmt0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function formatCents(c: number | null | undefined, opts: { whole?: boolean; sign?: boolean } = {}): string {
  if (c === null || c === undefined) return "—";
  const s = (opts.whole ? fmt0 : fmt).format(Math.abs(c) / 100);
  if (c < 0) return `−${s}`;
  if (opts.sign && c > 0) return `+${s}`;
  return s;
}

export function centsToDecimalString(c: number): string {
  const neg = c < 0;
  const a = Math.abs(c);
  return `${neg ? "-" : ""}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}
