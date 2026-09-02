// Cohort timing — derive where an instantiation is in its life from the PROGRAM'S
// ACTUAL structure (its terms and week spans) + a real start date + today. No
// assumption about program length. Powers current-term, expected-end, and phase
// ("recruiting" before start, "in-program" between, "graduated" after) everywhere.

export type Phase = "recruiting" | "in-program" | "graduated" | "unscheduled";

export interface TimingTerm {
  index: number;
  name: string;
  startWeek: number | null;
  endWeek: number | null;
}

export interface CohortTiming {
  startDate: Date | null;
  endDate: Date | null;          // expected end (start + program span)
  totalWeeks: number;
  currentTermIndex: number | null;
  currentTermName: string | null;
  weeksElapsed: number | null;
  pctElapsed: number | null;     // 0..1
  phase: Phase;
}

const WEEK_MS = 7 * 24 * 3600 * 1000;
const DEFAULT_TERM_WEEKS = 16;

export function termWeeks(t: TimingTerm): number {
  if (t.startWeek != null && t.endWeek != null && t.endWeek >= t.startWeek) return t.endWeek - t.startWeek + 1;
  return DEFAULT_TERM_WEEKS;
}

/** Whether the terms form a well-laid-out calendar: every term has a week span and
 *  the start weeks strictly increase (so range-matching is reliable). Degenerate
 *  data — e.g. every term defaulted to weeks 1–16 — fails this and we fall back to
 *  cumulative term lengths. */
export function isWellFormed(terms: TimingTerm[]): boolean {
  const ordered = [...terms].sort((a, b) => a.index - b.index);
  if (ordered.length === 0) return false;
  if (!ordered.every((t) => t.startWeek != null && t.endWeek != null)) return false;
  for (let i = 1; i < ordered.length; i++) {
    if ((ordered[i].startWeek as number) <= (ordered[i - 1].startWeek as number)) return false;
  }
  return true;
}

/** Program calendar span in weeks. Uses the last instructional week when terms are
 *  well-formed (respects gaps), but never less than the sum of term lengths — so
 *  degenerate/overlapping week data still yields a sensible program length. */
export function programSpanWeeks(terms: TimingTerm[]): number {
  const ordered = [...terms].sort((a, b) => a.index - b.index);
  if (ordered.length === 0) return DEFAULT_TERM_WEEKS;
  const sum = ordered.reduce((n, t) => n + termWeeks(t), 0);
  const maxEnd = Math.max(0, ...ordered.map((t) => t.endWeek ?? 0));
  return Math.max(sum, maxEnd) || DEFAULT_TERM_WEEKS;
}

export function computeCohortTiming(
  startDate: Date | null,
  terms: TimingTerm[],
  today: Date,
  /** Real calendar start dates per term, aligned to `terms` sorted by index. When
   *  supplied (from CohortTerm rows), the lifecycle is derived from the ACTUAL
   *  academic calendar — respecting the real gaps between terms — instead of
   *  assuming the instructional weeks run back-to-back. This is the accurate path
   *  and keeps "expected to finish {year}" consistent with the cohort's grad year. */
  realTermStarts?: (Date | null)[],
): CohortTiming {
  const ordered = [...terms].sort((a, b) => a.index - b.index);

  // --- Real-calendar path: terms anchored to actual dates (preferred) ----------
  if (realTermStarts && realTermStarts.length === ordered.length && realTermStarts.some((d) => d)) {
    const items = ordered
      .map((t, i) => ({ t, start: realTermStarts[i], weeks: termWeeks(t) }))
      .filter((x): x is { t: TimingTerm; start: Date; weeks: number } => x.start != null)
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    if (items.length) {
      const first = items[0].start;
      const lastItem = items[items.length - 1];
      const endDate = new Date(lastItem.start.getTime() + lastItem.weeks * WEEK_MS);
      const totalWeeks = Math.max(1, Math.round((endDate.getTime() - first.getTime()) / WEEK_MS));
      if (today < first) {
        return { startDate: first, endDate, totalWeeks, currentTermIndex: null, currentTermName: null, weeksElapsed: null, pctElapsed: null, phase: "recruiting" };
      }
      if (today >= endDate) {
        return { startDate: first, endDate, totalWeeks, currentTermIndex: null, currentTermName: null, weeksElapsed: totalWeeks, pctElapsed: 1, phase: "graduated" };
      }
      let currentTermIndex: number | null = null;
      let currentTermName: string | null = null;
      for (const it of items) {
        const e = new Date(it.start.getTime() + it.weeks * WEEK_MS);
        if (today >= it.start && today < e) { currentTermIndex = it.t.index; currentTermName = it.t.name; break; }
      }
      if (currentTermName == null) {
        const next = items.find((it) => it.start > today);
        currentTermName = next ? `Break before ${next.t.name}` : "Between terms";
      }
      const weeksElapsed = Math.floor((today.getTime() - first.getTime()) / WEEK_MS);
      return { startDate: first, endDate, totalWeeks, currentTermIndex, currentTermName, weeksElapsed, pctElapsed: weeksElapsed / totalWeeks, phase: "in-program" };
    }
  }

  // --- Synthetic-weeks fallback (no real per-term dates) ------------------------
  const totalWeeks = programSpanWeeks(ordered);

  if (!startDate) {
    return { startDate: null, endDate: null, totalWeeks, currentTermIndex: null, currentTermName: null, weeksElapsed: null, pctElapsed: null, phase: "unscheduled" };
  }
  const endDate = new Date(startDate.getTime() + totalWeeks * WEEK_MS);

  if (today < startDate) {
    return { startDate, endDate, totalWeeks, currentTermIndex: null, currentTermName: null, weeksElapsed: null, pctElapsed: null, phase: "recruiting" };
  }
  if (today >= endDate) {
    return { startDate, endDate, totalWeeks, currentTermIndex: null, currentTermName: null, weeksElapsed: totalWeeks, pctElapsed: 1, phase: "graduated" };
  }

  const weeksElapsed = Math.floor((today.getTime() - startDate.getTime()) / WEEK_MS);
  const weekNow = weeksElapsed + 1; // 1-based instructional week
  let currentTermIndex: number | null = null;
  let currentTermName: string | null = null;
  if (isWellFormed(ordered)) {
    const t = ordered.find((x) => (x.startWeek as number) <= weekNow && weekNow <= (x.endWeek as number));
    if (t) { currentTermIndex = t.index; currentTermName = t.name; }
    else {
      // In a gap/break — name it relative to the next upcoming term.
      const next = ordered.find((x) => (x.startWeek as number) > weekNow);
      currentTermName = next ? `Break before ${next.name}` : "Between terms";
    }
  } else {
    // Degenerate week data — place "today" by cumulative term length instead.
    let acc = 0;
    for (const t of ordered) { const w = termWeeks(t); if (weeksElapsed < acc + w) { currentTermIndex = t.index; currentTermName = t.name; break; } acc += w; }
  }

  return { startDate, endDate, totalWeeks, currentTermIndex, currentTermName, weeksElapsed, pctElapsed: weeksElapsed / totalWeeks, phase: "in-program" };
}

/** Tense-aware verb for a graduation year relative to today (kills "yet" language). */
export function gradVerb(gradYear: number, today: Date): string {
  const y = today.getUTCFullYear();
  if (gradYear < y) return "graduated";
  if (gradYear === y) return "graduating";
  return "expected to graduate";
}

// ---------------------------------------------------------------------------
// Legit semester boundaries — derived term dates snap to these, because no
// Spring semester starts in December and no Summer term starts in April.
// ---------------------------------------------------------------------------

export interface SemesterAnchors {
  springStart: string; summerStart: string; fallStart: string;
  /** Exact semester-start dates (ISO) imported from the academic calendar; for the
   *  years they cover they replace the MM-DD pattern. */
  knownStarts?: string[];
}
export const DEFAULT_ANCHORS: SemesterAnchors = { springStart: "01-08", summerStart: "05-28", fallStart: "08-15" };

const seasonOfMonth = (m: number) => (m <= 4 ? "Spring" : m <= 7 ? "Summer" : "Fall");

/** The Monday on/after `year-MM-DD` (UTC). */
function mondayOnOrAfter(year: number, mmdd: string): Date {
  const [mm, dd] = mmdd.split("-").map(Number);
  const d = new Date(Date.UTC(year, (mm || 1) - 1, dd || 1));
  const toMonday = (8 - d.getUTCDay()) % 7;
  return new Date(d.getTime() + toMonday * 86400000);
}

/** The next real semester start ON OR AFTER `d`, following the institution's
 *  academic-calendar anchors (each semester starts on the Monday on/after its
 *  MM-DD anchor). Defaults: Spring Jan 8 · Summer May 28 · Fall Aug 15. */
export function nextSemesterStart(d: Date, anchors: SemesterAnchors = DEFAULT_ANCHORS): Date {
  const cands: Date[] = [];
  // Imported exact dates first; a season-year they cover skips the pattern.
  const known = (anchors.knownStarts ?? []).map((s) => new Date(s + "T00:00:00Z"));
  const covered = new Set(known.map((k) => `${seasonOfMonth(k.getUTCMonth() + 1)}|${k.getUTCFullYear()}`));
  cands.push(...known);
  for (const y of [d.getUTCFullYear(), d.getUTCFullYear() + 1]) {
    if (!covered.has(`Spring|${y}`)) cands.push(mondayOnOrAfter(y, anchors.springStart || DEFAULT_ANCHORS.springStart));
    if (!covered.has(`Summer|${y}`)) cands.push(mondayOnOrAfter(y, anchors.summerStart || DEFAULT_ANCHORS.summerStart));
    if (!covered.has(`Fall|${y}`)) cands.push(mondayOnOrAfter(y, anchors.fallStart || DEFAULT_ANCHORS.fallStart));
  }
  cands.sort((a, b) => a.getTime() - b.getTime());
  return cands.find((c) => c.getTime() >= d.getTime()) ?? cands[cands.length - 1];
}

/** Term start dates for a program from a chosen first day: term 1 on that day,
 *  every later term on the next semester boundary after the previous term ends. */
export function deriveTermStarts(startIso: string, termWeeks: number[], anchors: SemesterAnchors = DEFAULT_ANCHORS): Date[] {
  const out: Date[] = [];
  let cursor = new Date(startIso);
  for (let i = 0; i < termWeeks.length; i++) {
    const start = i === 0 ? new Date(cursor) : nextSemesterStart(cursor, anchors);
    out.push(start);
    cursor = new Date(start.getTime() + termWeeks[i] * 7 * 86400000);
  }
  return out;
}
