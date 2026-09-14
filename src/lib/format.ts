// Number formatting. Figures are STORED and ENTERED at up to six decimal places
// (PRECISION) — nothing is rounded on its way into a form value, a file or the
// database. On SCREEN a figure reads with at most two decimals (DISPLAY): the
// calculation keeps its precision, the page does not show it.

/** Decimal places carried on every input, file and stored value. */
export const PRECISION = 6;
/** Decimal places a figure shows on screen. */
export const DISPLAY = 2;

/** A number for display: at most DISPLAY decimals, trailing zeros dropped, thousands separated. */
export const dec = (n: number | null | undefined, minDigits = 0): string =>
  n == null || Number.isNaN(n) ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: DISPLAY, minimumFractionDigits: Math.min(minDigits, DISPLAY) });

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
