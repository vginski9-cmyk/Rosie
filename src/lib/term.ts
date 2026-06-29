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
