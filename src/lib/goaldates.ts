// WHEN A PLANNED OFFERING STARTS, so that it graduates in the goal year.
//
// The goal planner's year is the year a class FINISHES (the offerings listed under 2029 are the ones
// graduating in 2029). So a start the planner suggests is one whose last term, aligned to the college's
// calendar the same way the offering page aligns it, ends inside that year — never a start worked
// back from some later "productive by" date. The end shown beside a start is that same alignment, so
// the planner and the offering page never disagree.
//
//   continuous (a continuing-education class): any open Monday works; the candidates are every Monday
//     from the start of the year before through the goal year whose aligned end lands in the goal year.
//   semester: the coded semester starts (else the college's pattern anchors) whose aligned end lands in
//     the goal year, and — when the template codes term 1's season — of that season only.
//
// Several offerings are spaced evenly across the candidates, so eight CNA classes for 2029 run through
// 2029 rather than piling up in one month.

import { alignOffering, endYearOf, type CodedEventLite, type TermLite } from "./termalign";
import { closedWeek, seasonOfName, type SemesterAnchors } from "./term";

export interface PlannerCalendar { anchors: SemesterAnchors; events: CodedEventLite[] }
export interface PlannerModel { calendarMode: "semester" | "continuous"; terms: TermLite[] }

const DAY = 86400000;
const dateOf = (s: string) => new Date(s + "T00:00:00Z");
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(dateOf(s).getTime() + n * DAY));
const seasonOfIso = (s: string) => { const m = Number(s.slice(5, 7)); return m <= 4 ? "Spring" : m <= 7 ? "Summer" : "Fall"; };
const mondayOnOrAfter = (s: string) => { const d = dateOf(s); return addDays(s, (8 - d.getUTCDay()) % 7); };

/** The aligned end of an offering that starts on `startIso`, and the year it graduates. */
export function offeringEnd(startIso: string, m: PlannerModel, cal: PlannerCalendar): { endIso: string; endYear: number; warnings: string[] } {
  const a = alignOffering({ startIso, terms: m.terms, courses: [], anchors: cal.anchors, events: cal.events, calendarMode: m.calendarMode });
  const endIso = a.terms.map((t) => t.endIso).sort().at(-1) ?? startIso;
  return { endIso, endYear: endYearOf(a.terms), warnings: a.warnings };
}

const holidayMapOf = (events: CodedEventLite[]): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const e of events) { if (e.kind !== "holiday") continue; let d = e.iso; const end = e.endIso ?? e.iso; while (d <= end) { out[d] = e.label; d = addDays(d, 1); } }
  return out;
};

/** Every start on or after `todayIso` whose aligned end lands in `year`, earliest first. */
export function candidateStarts(year: number, m: PlannerModel, cal: PlannerCalendar, todayIso: string): string[] {
  const out: string[] = [];
  if (m.calendarMode === "continuous") {
    const holidays = holidayMapOf(cal.events);
    let d = mondayOnOrAfter(`${year - 1}-01-01`);
    const last = `${year}-12-31`;
    while (d <= last) {
      if (d >= todayIso && !closedWeek(dateOf(d), holidays) && offeringEnd(d, m, cal).endYear === year) out.push(d);
      d = addDays(d, 7);
    }
    return out;
  }
  const wanted = m.terms.length ? seasonOfName(m.terms[0].semester ?? m.terms[0].name) : null;
  const seen = new Set<string>();
  for (let y = year - 4; y <= year; y++) {
    const coded = cal.events.filter((e) => e.kind === "term_start" && e.iso.startsWith(`${y}-`)).map((e) => e.iso);
    const starts = coded.length ? coded : [`${y}-${cal.anchors.springStart}`, `${y}-${cal.anchors.summerStart}`, `${y}-${cal.anchors.fallStart}`];
    for (const s of starts) {
      if (seen.has(s) || s < todayIso) continue;
      seen.add(s);
      if (wanted && seasonOfIso(s) !== wanted) continue;
      if (offeringEnd(s, m, cal).endYear === year) out.push(s);
    }
  }
  return out.sort();
}

/** `n` starts spread evenly over the candidates (the first and last always used when n ≥ 2). An empty
 *  candidate list gives an empty answer: no start left can graduate in that year. */
export function spacedStarts(candidates: string[], n: number): string[] {
  if (!candidates.length || n <= 0) return [];
  if (n === 1) return [candidates[0]];
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(candidates[Math.round((i * (candidates.length - 1)) / (n - 1))]);
  return out;
}

/** The starts for `n` offerings graduating in `year`. */
export const suggestedStarts = (year: number, n: number, m: PlannerModel, cal: PlannerCalendar, todayIso: string): string[] => spacedStarts(candidateStarts(year, m, cal, todayIso), n);
