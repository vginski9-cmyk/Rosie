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

/** A contiguous run of `count` academic terms starting at (code, fallYear). */
export function academicTermSequence(code: TermCode, fallYear: number, count: number): AcademicTerm[] {
  const start = ordinalOf(code, fallYear);
  return Array.from({ length: count }, (_, i) => termFromOrdinal(start + i));
}
