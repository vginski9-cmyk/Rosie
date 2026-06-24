// Academic calendar sequence.
//
// Programs are authored as an ordered list of program-terms (Term 1..N). To
// overlay multiple cohorts on a real calendar we need to place each program-term
// on an actual academic term (Fall 2026, Spring 2027, …). This module gives a
// clean linear "term ordinal" space so we can advance and compare terms.

export type TermCode = "FALL" | "SPRING" | "SUMMER";

/** Academic cycle order within a year band: Fall → Spring → Summer. */
export const CYCLE: TermCode[] = ["FALL", "SPRING", "SUMMER"];

export interface AcademicTerm {
  /** Linear ordinal in the academic term space (monotonic, comparable). */
  ordinal: number;
  code: TermCode;
  /** The Fall-anchored academic year (Fall 2026 / Spring 2027 share fallYear 2026). */
  fallYear: number;
  /** Calendar year the term actually occurs in. */
  calendarYear: number;
  key: string; // e.g. "2026-FALL"
  label: string; // e.g. "Fall 2026"
}

const cap = (c: TermCode) => c.charAt(0) + c.slice(1).toLowerCase();

/** Build an AcademicTerm from a linear ordinal. */
export function termFromOrdinal(ordinal: number): AcademicTerm {
  const fallYear = Math.floor(ordinal / 3);
  const pos = ((ordinal % 3) + 3) % 3;
  const code = CYCLE[pos];
  const calendarYear = code === "FALL" ? fallYear : fallYear + 1;
  return {
    ordinal,
    code,
    fallYear,
    calendarYear,
    key: `${fallYear}-${code}`,
    label: `${cap(code)} ${calendarYear}`,
  };
}

/** The ordinal for a given term code + Fall-anchored year. */
export function ordinalOf(code: TermCode, fallYear: number): number {
  return fallYear * 3 + CYCLE.indexOf(code);
}

/**
 * The ordinal for a term identified by its CALENDAR year (the year it actually
 * happens). Fall 2026, Spring 2027 and Summer 2027 all belong to Fall-year 2026.
 */
export function ordinalOfCalendar(code: TermCode, calendarYear: number): number {
  const fallYear = code === "FALL" ? calendarYear : calendarYear - 1;
  return ordinalOf(code, fallYear);
}

/** A contiguous run of `count` academic terms starting at (code, fallYear). */
export function academicTermSequence(code: TermCode, fallYear: number, count: number): AcademicTerm[] {
  const start = ordinalOf(code, fallYear);
  return Array.from({ length: count }, (_, i) => termFromOrdinal(start + i));
}

/** Parse a CSV of term codes (e.g. "FALL,SPRING") into a validated list. */
export function parseTermCodes(csv: string | null | undefined): TermCode[] {
  const out = (csv ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is TermCode => (CYCLE as string[]).includes(s));
  return out.length ? out : [...CYCLE];
}

/**
 * Walk the program's DELIVERY calendar: starting at `entryOrdinal`, return the
 * ordinals of the next `count` terms whose code is in `activeCodes`, skipping
 * inactive slots (e.g. a program that doesn't run in summer). The entry term is
 * snapped forward to the first active slot if it isn't already active.
 */
export function deliveryOrdinals(entryOrdinal: number, count: number, activeCodes: TermCode[]): number[] {
  const active = new Set(activeCodes.length ? activeCodes : CYCLE);
  const out: number[] = [];
  let o = entryOrdinal;
  // Snap entry to first active slot.
  while (!active.has(termFromOrdinal(o).code)) o++;
  while (out.length < count) {
    if (active.has(termFromOrdinal(o).code)) out.push(o);
    o++;
  }
  return out;
}
