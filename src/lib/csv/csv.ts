/** RFC 4180 CSV parse/serialize with spreadsheet formula-injection escaping. */

const FORMULA_START = /^[=+\-@\t\r]/;

/** Prefix cells that a spreadsheet could interpret as a formula with a single quote. */
export function escapeFormula(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

export function quoteCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const line = (cells: (string | number | null | undefined)[]) =>
    cells.map((c) => quoteCell(escapeFormula(c === null || c === undefined ? "" : String(c)))).join(",");
  // UTF-8 BOM so spreadsheets detect encoding.
  return "﻿" + [line(header), ...rows.map(line)].join("\r\n") + "\r\n";
}

export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell === "") {
      inQuotes = true;
      i++;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
      i++;
    } else if (ch === "\r" || ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      if (ch === "\r" && text[i + 1] === "\n") i++;
      i++;
    } else {
      cell += ch;
      i++;
    }
  }
  if (inQuotes) throw new Error("Unterminated quoted field");
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/** Reverse escapeFormula for re-import of our own exports. */
export function unescapeFormula(value: string): string {
  return value.length > 1 && value[0] === "'" && FORMULA_START.test(value.slice(1)) ? value.slice(1) : value;
}
