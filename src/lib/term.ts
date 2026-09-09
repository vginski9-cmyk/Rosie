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

/** THE season rule, everywhere: a term that starts January–April is Spring,
 *  May–July is Summer, August–December is Fall. (Sandhills' summer term starts
 *  late May / early June — it is Summer, never a late Spring.) */
export type Season = "Spring" | "Summer" | "Fall";
export const SEASONS: Season[] = ["Spring", "Summer", "Fall"];
export const SEASON_ORDER: Record<string, number> = { Spring: 0, Summer: 1, Fall: 2 };
export const seasonOfMonth = (m: number): Season => (m <= 4 ? "Spring" : m <= 7 ? "Summer" : "Fall");
export const seasonOfDate = (d: Date): Season => seasonOfMonth(d.getUTCMonth() + 1);
/** A season named in free text ("Summer 2027", "Term 3-Su1", "FALL"), else null. */
export const seasonOfName = (name: string | null | undefined): Season | null => {
  const n = (name ?? "").toLowerCase();
  if (/\bfall\b|\bautumn\b|-f\d/.test(n)) return "Fall";
  if (/\bspring\b|-sp\d/.test(n)) return "Spring";
  if (/\bsummer\b|-su\d/.test(n)) return "Summer";
  return null;
};
/** Best season for a term: the one stored on it, else named in it, else its start date, else null. */
export const seasonOfTerm = (t: { semester?: string | null; name?: string | null }, start?: Date | null): Season | null =>
  (t.semester && SEASONS.includes(t.semester as Season) ? (t.semester as Season) : null) ?? seasonOfName(t.name) ?? (start ? seasonOfDate(start) : null);

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

/** The last instructional day a semester can have under the pattern: the Friday
 *  at least nine days before the NEXT semester starts (a week-plus break). A
 *  16-week template term that starts late May therefore ends in early August,
 *  not mid-September — the summer term ends with the summer. */
export function patternSemesterEnd(startIso: string, anchors: SemesterAnchors = DEFAULT_ANCHORS): string {
  const start = new Date(startIso + "T00:00:00Z");
  const next = nextSemesterStart(new Date(start.getTime() + 7 * 86400000), anchors);
  let d = new Date(next.getTime() - 9 * 86400000);
  while (d.getUTCDay() !== 5) d = new Date(d.getTime() - 86400000);
  return d.toISOString().slice(0, 10);
}

/** Instructional weeks between a term's first and last day (week 1 = the start's week). */
export const calendarWeeksBetween = (start: Date | string, end: Date | string): number => {
  const s = typeof start === "string" ? new Date(start + "T00:00:00Z") : start;
  const e = typeof end === "string" ? new Date(end + "T00:00:00Z") : end;
  return Math.max(1, Math.floor((e.getTime() - s.getTime()) / (7 * 86400000)) + 1);
};

/** THE week rule: template week w lands on calendar week w of its term — the
 *  weekly pattern the sheet describes is never squeezed or smeared. When the
 *  calendar gives the term fewer weeks than the template plans (a 10-week
 *  summer for a 16-week template), sessions in the template weeks past the
 *  term's last week are BEYOND the term: they get no date and are flagged for
 *  the configurer to move or drop. Course windows clamp to the term's last week. */
export const beyondTerm = (week: number, templateWeeks: number, calendarWeeks: number): boolean =>
  templateWeeks > 0 && calendarWeeks > 0 && calendarWeeks < templateWeeks && week > calendarWeeks;
/** A template week clamped to the weeks the term has (for windows and labels). */
export function fitWeek(week: number, templateWeeks: number, calendarWeeks: number): number {
  if (!(templateWeeks > 0) || !(calendarWeeks > 0) || calendarWeeks >= templateWeeks) return week;
  return Math.min(Math.max(1, week), calendarWeeks);
}

/** What a session week is anchored to: the term (its real first and last day and
 *  the weeks the template plans) and, for a shorter course with its own window,
 *  the course's first day and the template week it begins in. */
export interface WeekAnchor {
  termStart: Date | string | null | undefined;
  termEnd?: Date | string | null;
  templateWeeks?: number | null;
  courseStart?: Date | string | null;
  courseFirstWeek?: number | null;
}
const asDate = (d: Date | string | null | undefined): Date | null => (d == null ? null : typeof d === "string" ? new Date(d.length === 10 ? d + "T00:00:00Z" : d) : d);
/** The Monday of a session's week, everywhere: buildInstances, the design page, student itineraries, the master calendar. */
export function weekMonday(a: WeekAnchor, week: number | null | undefined): Date | null {
  const w = week && week > 0 ? week : 1;
  const termStart = asDate(a.termStart), termEnd = asDate(a.termEnd), courseStart = asDate(a.courseStart);
  const tpl = a.templateWeeks && a.templateWeeks > 0 ? a.templateWeeks : 16;
  const cal = termStart && termEnd ? calendarWeeksBetween(termStart, termEnd) : tpl;
  if (beyondTerm(w, tpl, cal)) return null; // after the term's last day — undated, flagged
  if (courseStart) { const f0 = a.courseFirstWeek && a.courseFirstWeek > 0 ? a.courseFirstWeek : 1; return new Date(courseStart.getTime() + Math.max(0, w - f0) * 7 * 86400000); }
  if (!termStart) return null;
  return new Date(termStart.getTime() + (w - 1) * 7 * 86400000);
}
export const DAY_OFFSET: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6, Monday: 0, Tuesday: 1, Wednesday: 2, Thursday: 3, Friday: 4, Saturday: 5, Sunday: 6 };
/** The exact date of a session (its week's Monday + its weekday), or null when it has no day. */
export function sessionDate(a: WeekAnchor, week: number | null | undefined, dayOfWeek: string | null | undefined): Date | null {
  const mon = weekMonday(a, week);
  const off = dayOfWeek != null ? DAY_OFFSET[dayOfWeek] : undefined;
  return mon && off != null ? new Date(mon.getTime() + off * 86400000) : null;
}

/** The semester a DATE sits in under the pattern: the latest semester start on
 *  or before it (Spring from early January, Summer from late May, Fall from
 *  mid-August), so the first days of August still belong to the summer term. */
export function semesterAt(d: Date, anchors: SemesterAnchors = DEFAULT_ANCHORS): { season: Season; year: number } {
  let best: { start: Date; season: Season } | null = null;
  for (const y of [d.getUTCFullYear() - 1, d.getUTCFullYear()]) {
    const cands: { start: Date; season: Season }[] = [
      { start: mondayOnOrAfter(y, anchors.springStart || DEFAULT_ANCHORS.springStart), season: "Spring" },
      { start: mondayOnOrAfter(y, anchors.summerStart || DEFAULT_ANCHORS.summerStart), season: "Summer" },
      { start: mondayOnOrAfter(y, anchors.fallStart || DEFAULT_ANCHORS.fallStart), season: "Fall" },
    ];
    for (const c of cands) if (c.start.getTime() <= d.getTime() && (!best || c.start > best.start)) best = c;
  }
  if (!best) return { season: seasonOfDate(d), year: d.getUTCFullYear() };
  return { season: best.season, year: best.start.getUTCFullYear() };
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
