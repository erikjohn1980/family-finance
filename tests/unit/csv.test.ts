import { describe, expect, it } from "vitest";
import { escapeFormula, parseCsv, toCsv, unescapeFormula } from "@/lib/csv/csv";
import { parseMoneyToCents } from "@/lib/money";

describe("CSV", () => {
  it("escapes formula-like cells", () => {
    for (const v of ["=1+1", "+SUM(A1)", "-2", "@cmd", "\tx", "\rx"]) expect(escapeFormula(v).startsWith("'")).toBe(true);
    expect(escapeFormula("Groceries")).toBe("Groceries");
  });
  it("writes UTF-8 BOM, quotes, and escapes", () => {
    const out = toCsv(["merchant", "amount"], [['=HYPERLINK("x")', "-12.34"], ["Café, \"Uno\"", "5.00"]]);
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out).toContain(`"'=HYPERLINK(""x"")"`);
    expect(out).toContain("'-12.34");
    expect(out).toContain(`"Café, ""Uno"""`);
  });
  it("round-trips key fields", () => {
    const rows = [["ext-1", "2026-10-01", "-12.34", "=EVIL()", "Café"]];
    const parsed = parseCsv(toCsv(["external_id", "posted_at", "amount", "merchant", "memo"], rows));
    expect(parsed[0]).toEqual(["external_id", "posted_at", "amount", "merchant", "memo"]);
    expect(parsed[1].map(unescapeFormula)).toEqual(rows[0]);
    expect(parseMoneyToCents(unescapeFormula(parsed[1][2]))).toBe(-1234);
  });
  it("parses money safely", () => {
    expect(parseMoneyToCents("$1,234.5")).toBe(123450);
    expect(parseMoneyToCents("(12.00)")).toBe(-1200);
    expect(parseMoneyToCents("1e5")).toBeNull();
    expect(parseMoneyToCents("12.345")).toBeNull();
  });
});
