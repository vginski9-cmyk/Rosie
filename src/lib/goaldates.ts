// WHEN A PLANNED OFFERING STARTS, so that it graduates in the goal year.
//
// The goal planner's year is the year a class FINISHES (the offerings listed under 2029 are the ones
// graduating in 2029). So a start the planner offers is one whose last term, aligned to the college's
// calendar the same way the offering page aligns it, ends inside that year — never a start worked
// back from some later "productive by" date. The end shown beside a start is that same alignment, so
// the planner and the offering page never disagree.
//
//   continuous (a continuing-education class): the college's own coded starts (the semester and every
//     later session — 16-week, first 10-week, second 8-week …, each with its length when the calendar
//     gives its end) and any open Monday, from the start of the year before through the goal year,
//     whose aligned end lands in the goal year.
//   semester: the coded semester starts — and, for a season and year the calendar does not code, the
//     college's pattern (the Monday on or after its anchor, the rule every other reader uses) — whose
//     aligned end lands in the goal year, and, when the template codes term 1's season (else the
//     program's launch seasons), of those seasons only.
//
// A start is never cut at today: a class that already started, or already finished, is still a start
// of that year — the reader records what ran and compares it with the plan — and says so. The SUGGESTED
// starts (a new allocation's slots) prefer the starts still ahead, and, for a continuing-education
// class, the college's sessions whose length fits the program (an 8-week class starts with an 8-week
// session), then any session long enough, then any coded start, then any Monday.
//
// Several offerings are spaced evenly across the candidates, so eight CNA classes for 2029 run through
// 2029 rather than piling up in one month.

import { alignOffering, endYearOf, type CodedEventLite, type TermLite } from "./termalign";
import { closedWeek, seasonOfName, type SemesterAnchors } from "./term";
import { sessionWeeksOf } from "./academiccalendar";
import { cohortStatusOn } from "./cohortscope";

export interface PlannerCalendar { anchors: SemesterAnchors; events: CodedEventLite[] }
export interface PlannerModel {
  calendarMode: "semester" | "continuous";
  terms: TermLite[];
  /** The seasons the program launches in (FALL, SPRING, SUMMER), read when term 1 codes no season. */
  launchTerms?: string[] | null;
}

/** Where a start comes from: a coded start on the college's calendar (the semester or a later session), any open Monday, or the college's semester pattern for a season the calendar does not code. */
export type StartSource = "calendar" | "monday" | "pattern";
/** Where the start sits against today: still ahead, already started, or already finished. */
export type StartTiming = "ahead" | "started" | "finished";
export interface StartOption {
  iso: string;
  source: StartSource;
  /** The coded event's label ("Second 8 week classes"); null for a Monday or a pattern date. */
  label: string | null;
  /** The coded session's length in weeks (the label's own count); null when the calendar gives no end — never 0. */
  sessionWeeks: number | null;
  /** The session's length equals the program's first term (an 8-week class on an 8-week session). */
  fits: boolean;
  /** The aligned last day of an offering starting here. */
  endIso: string;
  timing: StartTiming;
}

const DAY = 86400000;
const dateOf = (s: string) => new Date(s + "T00:00:00Z");
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(dateOf(s).getTime() + n * DAY));
const seasonOfIso = (s: string) => { const m = Number(s.slice(5, 7)); return m <= 4 ? "Spring" : m <= 7 ? "Summer" : "Fall"; };
const mondayOnOrAfter = (s: string) => { const d = dateOf(s); return addDays(s, (8 - d.getUTCDay()) % 7); };
const SEASONS = ["Spring", "Summer", "Fall"] as const;
const anchorOf = (cal: PlannerCalendar, season: string) => (season === "Spring" ? cal.anchors.springStart : season === "Summer" ? cal.anchors.summerStart : cal.anchors.fallStart);
const isStart = (e: CodedEventLite) => e.kind === "term_start" || e.kind === "session_start";
/** Term 1's length in the template (lib/termalign weeksOf). */
export const term1Weeks = (m: PlannerModel): number => { const t = [...m.terms].sort((a, b) => a.index - b.index)[0]; return t ? Math.max(1, (t.endWeek ?? 16) - (t.startWeek ?? 1) + 1) : 1; };
const timingOf = (startIso: string, endIso: string, todayIso: string): StartTiming => { const s = cohortStatusOn(startIso, endIso, todayIso); return s === "completed" ? "finished" : s === "active" ? "started" : "ahead"; };

/** The aligned end of an offering that starts on `startIso`, the year it graduates, and where term 1
 *  actually lands (a semester program's typed date snaps to the coded semester start it means). */
export function offeringEnd(startIso: string, m: PlannerModel, cal: PlannerCalendar): { endIso: string; endYear: number; warnings: string[]; alignedStartIso: string } {
  const a = alignOffering({ startIso, terms: m.terms, courses: [], anchors: cal.anchors, events: cal.events, calendarMode: m.calendarMode });
  const endIso = a.terms.map((t) => t.endIso).sort().at(-1) ?? startIso;
  return { endIso, endYear: endYearOf(a.terms), warnings: a.warnings, alignedStartIso: a.terms[0]?.startIso ?? startIso };
}

const holidayMapOf = (events: CodedEventLite[]): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const e of events) { if (e.kind !== "holiday") continue; let d = e.iso; const end = e.endIso ?? e.iso; while (d <= end) { out[d] = e.label; d = addDays(d, 1); } }
  return out;
};

/** Of several coded starts on one day (the 16-week, first 10-week and first 8-week sessions all begin with
 *  the semester), the one to name: the session whose length fits the program, else the shortest that is
 *  long enough, else the longest. */
function pickForDay(events: CodedEventLite[], weeks: number): CodedEventLite {
  const withLen = events.map((e) => ({ e, w: sessionWeeksOf(e) }));
  return withLen.find((x) => x.w === weeks)?.e
    ?? withLen.filter((x) => x.w != null && x.w >= weeks).sort((a, b) => a.w! - b.w!)[0]?.e
    ?? withLen.filter((x) => x.w != null).sort((a, b) => b.w! - a.w!)[0]?.e
    ?? events[0];
}

/** Every start whose aligned end lands in `year`, earliest first — never cut at today. */
export function candidateStarts(year: number, m: PlannerModel, cal: PlannerCalendar, todayIso: string): StartOption[] {
  const weeks = term1Weeks(m);
  const seen = new Set<string>();
  const out: StartOption[] = [];
  const add = (isoDate: string, source: StartSource, ev: CodedEventLite | null) => {
    if (seen.has(isoDate)) return;
    seen.add(isoDate);
    const e = offeringEnd(isoDate, m, cal);
    if (e.endYear !== year) return;
    const sessionWeeks = ev ? sessionWeeksOf(ev) : null;
    out.push({ iso: isoDate, source, label: ev?.label ?? null, sessionWeeks, fits: sessionWeeks != null && sessionWeeks === weeks, endIso: e.endIso, timing: timingOf(isoDate, e.endIso, todayIso) });
  };
  if (m.calendarMode === "continuous") {
    const from = `${year - 1}-01-01`, to = `${year}-12-31`;
    const byDay = new Map<string, CodedEventLite[]>();
    for (const e of cal.events) if (isStart(e) && e.iso >= from && e.iso <= to) byDay.set(e.iso, [...(byDay.get(e.iso) ?? []), e]);
    for (const [d, evs] of byDay) add(d, "calendar", pickForDay(evs, weeks));
    const holidays = holidayMapOf(cal.events);
    for (let d = mondayOnOrAfter(from); d <= to; d = addDays(d, 7)) if (!closedWeek(dateOf(d), holidays)) add(d, "monday", null);
    return out.sort((a, b) => a.iso.localeCompare(b.iso));
  }
  const term1 = [...m.terms].sort((a, b) => a.index - b.index)[0];
  const coded1 = term1 ? seasonOfName(term1.semester ?? term1.name) : null;
  const launch = (m.launchTerms ?? []).map((c) => seasonOfName(c)).filter((s): s is NonNullable<typeof s> => !!s);
  const wanted = coded1 ? [coded1] : launch.length ? launch : null;
  // Coverage per season AND year, as lib/term nextSemesterStart reads it: a season-year the calendar codes
  // uses its exact dates; every other one follows the pattern.
  for (let y = year - 4; y <= year; y++) {
    for (const season of SEASONS) {
      if (wanted && !wanted.includes(season)) continue;
      const coded = cal.events.filter((e) => e.kind === "term_start" && e.iso.startsWith(`${y}-`) && seasonOfIso(e.iso) === season);
      if (coded.length) for (const e of coded) add(e.iso, "calendar", e);
      else add(mondayOnOrAfter(`${y}-${anchorOf(cal, season)}`), "pattern", null);
    }
  }
  return out.sort((a, b) => a.iso.localeCompare(b.iso));
}

/** `n` starts spread evenly over the candidates (the first and last always used when n ≥ 2). An empty
 *  candidate list gives an empty answer: no start can graduate in that year. */
export function spacedStarts<T>(candidates: T[], n: number): T[] {
  if (!candidates.length || n <= 0) return [];
  if (n === 1) return [candidates[0]];
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(candidates[Math.round((i * (candidates.length - 1)) / (n - 1))]);
  return out;
}

/** The starts for `n` offerings graduating in `year`: the starts still ahead when any are (else every start of
 *  the year — a year already run), and for a continuing-education class the college's sessions that fit the
 *  program's length first, then any session long enough, then any coded start, then any Monday. */
export function suggestedStarts(year: number, n: number, m: PlannerModel, cal: PlannerCalendar, todayIso: string): StartOption[] {
  const all = candidateStarts(year, m, cal, todayIso);
  const ahead = all.filter((o) => o.timing === "ahead");
  const pool = ahead.length ? ahead : all;
  if (m.calendarMode !== "continuous") return spacedStarts(pool, n);
  const weeks = term1Weeks(m);
  const ladder = [pool.filter((o) => o.fits), pool.filter((o) => o.sessionWeeks != null && o.sessionWeeks >= weeks), pool.filter((o) => o.source === "calendar"), pool];
  return spacedStarts(ladder.find((l) => l.length) ?? [], n);
}
