// CSV cells that a spreadsheet will never execute. A value beginning with = + - @ (or a tab / CR that
// hides one) is a formula to Excel and Sheets; an apostrophe prefix keeps it text. RFC 4180 quoting on top.
export function csvCell(v: string | number | null | undefined): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
/** Text that goes into a spreadsheet CELL (xlsx export): same guard, no CSV quoting. */
export function sheetSafe(v: string | number | null | undefined): string | number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  return /^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v) ? "'" + v : v;
}
