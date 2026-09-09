// Number formatting. Every figure the app shows or writes keeps at least seven
// decimal places of precision: nothing is rounded to one or two places on its way
// to the screen, a file or the database — a value is shown with as many decimals
// as it has (up to PRECISION), and integers stay integers.

/** Decimal places carried on every input and output. */
export const PRECISION = 7;

/** A number for display: up to PRECISION decimals, trailing zeros dropped, thousands separated. */
export const dec = (n: number | null | undefined, minDigits = 0): string =>
  n == null || Number.isNaN(n) ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: PRECISION, minimumFractionDigits: minDigits });

/** A number for a form value or a file: plain digits (no separators), PRECISION decimals at most. */
export const numInput = (n: number | null | undefined): number | "" => (n == null || Number.isNaN(n) ? "" : Number(n.toFixed(PRECISION)));

export const fmt = {
  num(n: number | null | undefined, _digits = 0): string { void _digits; return dec(n); },
  pct(n: number | null | undefined, _digits = 0): string {
    void _digits;
    if (n == null || Number.isNaN(n)) return "—";
    return `${dec(n * 100)}%`;
  },
  fte(n: number | null | undefined): string { return dec(n); },
};
