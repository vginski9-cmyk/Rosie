// Number formatting — the one place a figure becomes text. Figures are STORED and ENTERED at up
// to six decimal places (PRECISION); nothing is rounded on its way into a form value, a file or
// the database. On SCREEN each kind of figure has its own rule (docs/metrics-audit.md, Phase 1):
//   people and other counts → whole numbers; a required-pipeline count rounds UP ("at least 83")
//   percentages → 0–1 decimal · FTE → 1–2 decimals · hours → 0–1 decimal · age → 1 decimal
//   multipliers → 2 decimals
// The calculation keeps its precision; the page does not show it.

/** Decimal places carried on every input, file and stored value. */
export const PRECISION = 6;
/** The most decimals any figure shows on screen. */
export const DISPLAY = 2;

const loc = (n: number, max: number, min = 0) => n.toLocaleString("en-US", { maximumFractionDigits: max, minimumFractionDigits: Math.min(min, max) });
const bad = (n: number | null | undefined): n is null | undefined => n == null || Number.isNaN(n);

/** A number for display: at most `max` decimals (DISPLAY by default), trailing zeros dropped, thousands separated. */
export const dec = (n: number | null | undefined, minDigits = 0, max = DISPLAY): string => (bad(n) ? "—" : loc(n, max, minDigits));

/** A number for a form value or a file: plain digits (no separators), PRECISION decimals at most. */
export const numInput = (n: number | null | undefined): number | "" => (bad(n) ? "" : Number(n.toFixed(PRECISION)));

export const fmt = {
  /** A count of people or things: a whole number. */
  num(n: number | null | undefined, _digits = 0): string { void _digits; return bad(n) ? "—" : loc(Math.round(n), 0); },
  /** A count that must be met (a pipeline target): rounded UP, never down. */
  atLeast(n: number | null | undefined): string { return bad(n) ? "—" : loc(Math.ceil(n - 1e-9), 0); },
  /** A share (0–1) as a percentage with at most one decimal. */
  pct(n: number | null | undefined, _digits = 0): string { void _digits; return bad(n) ? "—" : `${loc(n * 100, 1)}%`; },
  /** A full-time-equivalent: one to two decimals. */
  fte(n: number | null | undefined): string { return bad(n) ? "—" : loc(n, 2, 1); },
  /** Hours: at most one decimal. */
  hours(n: number | null | undefined): string { return bad(n) ? "—" : loc(n, 1); },
  /** An age in years: one decimal. */
  age(n: number | null | undefined): string { return bad(n) ? "—" : loc(n, 1, 1); },
  /** A multiplier or rate: two decimals. */
  mult(n: number | null | undefined): string { return bad(n) ? "—" : loc(n, 2, 2); },
  /** A figure with up to two decimals (the general case). */
  dec,
};
