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
  /** A required count as a phrase: "at least 83" when the calculation is fractional, plain "29" when it is whole. */
  atLeastPhrase(n: number | null | undefined): string { return bad(n) ? "—" : Math.abs(n - Math.round(n)) < 1e-9 ? loc(Math.round(n), 0) : `at least ${loc(Math.ceil(n - 1e-9), 0)}`; },
  /** The unrounded calculation, for a hover or a detail view only — never the headline figure. */
  exact(n: number | null | undefined): string { return bad(n) ? "—" : loc(n, PRECISION); },
  /** A hover title pairing the shown figure with its calculation: "calculated 82.214082 · shown as at least 83". */
  calcTitle(n: number | null | undefined, shown: string): string { return bad(n) ? "" : Math.abs(n - Math.round(n)) < 1e-9 ? `exactly ${loc(n, 0)}` : `calculated ${loc(n, PRECISION)} · shown as ${shown}`; },
  /** A share (0–1) as a percentage with at most one decimal. */
  pct(n: number | null | undefined, _digits = 0): string { void _digits; return bad(n) ? "—" : `${loc(n * 100, 1)}%`; },
  /** A change as a signed percentage ("+12.5%", "−3%"). */
  pctSigned(n: number | null | undefined): string { return bad(n) ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${loc(Math.abs(n) * 100, 1)}%`; },
  /** Minutes (drive time): a whole number with its unit. */
  minutes(n: number | null | undefined): string { return bad(n) ? "—" : `${loc(Math.round(n), 0)} min`; },
  /** A timestamp for a footer ("Sep 18, 3:05 PM UTC"). */
  dateTime(d: Date | null | undefined): string { return d == null || Number.isNaN(d.getTime()) ? "—" : `${d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" })} UTC`; },
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
