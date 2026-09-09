// Term & course alignment — put every offering's real dates on the coded
// academic calendar, automatically.
//
// Given the institution's coded calendar events (semester starts / ends, later
// session starts, holidays), the semester pattern, a program's template terms
// (week spans) and courses (session weeks), and the offering's chosen first
// day, produce for each term its real start AND end date (with where each came
// from) and for each shorter-than-term course its real window. Pure functions,
// no I/O — the actions persist the result; the calendar import, lock-in and the
// "re-align" buttons all call the same thing, so nothing needs typing twice.

import { nextSemesterStart, patternSemesterEnd, calendarWeeksBetween, fitWeek, type SemesterAnchors } from "./term";

export interface CodedEventLite { iso: string; endIso: string | null; label: string; kind: string; season: string | null }
export interface TermLite { id: string; index: number; name: string; startWeek: number | null; endWeek: number | null }
export interface CourseLite { id: string; termId: string; code: string | null; name: string; sessions: { week: number | null }[] }

export type DateSource = "calendar" | "pattern" | "template" | "chosen" | "manual";

export interface AlignedTerm {
  termId: string; index: number; name: string;
  /** First instructional day (ISO). */
  startIso: string;
  /** Last instructional day (ISO). */
  endIso: string;
  startSource: DateSource; endSource: DateSource;
  /** The coded semester this term sits in, e.g. "Fall 2026". */
  semester: string;
  /** Template weeks vs the weeks the calendar actually gives the term. */
  templateWeeks: number; calendarWeeks: number;
  /** Which coded event(s) it followed, for trust. */
  startLabel: string | null; endLabel: string | null;
  /** Term 1 only: the chosen first day was moved onto the coded semester start. */
  movedFrom?: string;
}

export interface AlignedCourse {
  courseId: string; termId: string; code: string | null; name: string;
  startIso: string; endIso: string;
  /** Session weeks the window spans. */
  firstWeek: number; lastWeek: number;
  /** A coded later-session start the course snapped to, when one matched. */
  snappedTo: string | null;
}

export interface Alignment { terms: AlignedTerm[]; courses: AlignedCourse[]; warnings: string[] }

const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dateOf = (s: string) => new Date(s + "T00:00:00Z");
const addDays = (s: string, n: number) => iso(new Date(dateOf(s).getTime() + n * DAY));
const daysBetween = (a: string, b: string) => Math.round((dateOf(b).getTime() - dateOf(a).getTime()) / DAY);
export const weeksOf = (t: { startWeek: number | null; endWeek: number | null }) => Math.max(1, (t.endWeek ?? 16) - (t.startWeek ?? 1) + 1);
const seasonOfIso = (s: string) => { const m = Number(s.slice(5, 7)); return m <= 4 ? "Spring" : m <= 7 ? "Summer" : "Fall"; };
const fmt = (s: string) => dateOf(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Nearest event of a kind within ±`within` days of `target` (ties → earliest). */
function nearest(events: CodedEventLite[], kind: string, target: string, within: number): CodedEventLite | null {
  let best: CodedEventLite | null = null; let bestGap = Infinity;
  for (const e of events) {
    if (e.kind !== kind) continue;
    const gap = Math.abs(daysBetween(target, e.iso));
    if (gap <= within && (gap < bestGap || (gap === bestGap && best && e.iso < best.iso))) { best = e; bestGap = gap; }
  }
  return best;
}

/** Align a program's terms and courses to the calendar from the offering's chosen first day. */
export function alignOffering(input: {
  startIso: string;
  terms: TermLite[];
  courses: CourseLite[];
  anchors: SemesterAnchors;
  events: CodedEventLite[];
  /** Terms whose dates were typed by hand — kept as they are (start required). */
  manual?: Record<string, { startIso: string; endIso: string | null }>;
}): Alignment {
  const warnings: string[] = [];
  const terms = [...input.terms].sort((a, b) => a.index - b.index);
  const starts = input.events.filter((e) => e.kind === "term_start");
  const anchors: SemesterAnchors = { ...input.anchors, knownStarts: starts.map((e) => e.iso).sort() };
  const out: AlignedTerm[] = [];
  let cursor = input.startIso; // the earliest a term may start

  for (let i = 0; i < terms.length; i++) {
    const t = terms[i];
    const templateWeeks = weeksOf(t);
    const manual = input.manual?.[t.id];
    let startIso: string; let startSource: DateSource; let startLabel: string | null = null; let movedFrom: string | undefined;
    if (manual) {
      startIso = manual.startIso; startSource = "manual";
    } else if (i === 0) {
      // Term 1: the chosen day, snapped to the coded semester start it clearly means.
      const hit = nearest(input.events, "term_start", input.startIso, 21);
      const late = nearest(input.events, "session_start", input.startIso, 3);
      if (hit && hit.iso === input.startIso) { startIso = hit.iso; startSource = "calendar"; startLabel = hit.label; }
      else if (late) { startIso = late.iso; startSource = "calendar"; startLabel = late.label; }
      else if (hit) { startIso = hit.iso; startSource = "calendar"; startLabel = hit.label; movedFrom = input.startIso; warnings.push(`${t.name}: chosen start ${fmt(input.startIso)} moved to the coded semester start ${fmt(hit.iso)} (${hit.label}).`); }
      else { startIso = input.startIso; startSource = "chosen"; }
    } else {
      const next = iso(nextSemesterStart(dateOf(cursor), anchors));
      const hit = starts.find((e) => e.iso === next);
      startIso = next; startSource = hit ? "calendar" : "pattern"; startLabel = hit?.label ?? null;
    }

    // End: the coded "semester ends" for this semester (the first one after the
    // start within a plausible span), else the last template week's Friday.
    const templateEnd = addDays(startIso, templateWeeks * 7 - 3);
    let endIso = manual?.endIso ?? templateEnd; let endSource: DateSource = manual?.endIso ? "manual" : "template"; let endLabel: string | null = null;
    if (!manual?.endIso) {
      const ends = input.events.filter((e) => e.kind === "term_end" && e.iso > startIso && daysBetween(startIso, e.iso) <= (templateWeeks + 6) * 7).sort((a, b) => a.iso.localeCompare(b.iso));
      const startEvent = starts.find((e) => e.iso === startIso);
      const sameSemester = startEvent ? ends.filter((e) => e.season === startEvent.season && e.iso.slice(0, 4) === startEvent.iso.slice(0, 4)) : [];
      const pick = sameSemester[0] ?? ends[0] ?? null;
      if (pick) { endIso = pick.iso; endSource = "calendar"; endLabel = pick.label; }
      else {
        // No coded end: the term still ends with its semester — before the next
        // one starts under the pattern (a summer term ends in the summer).
        const bound = patternSemesterEnd(startIso, anchors);
        if (bound < endIso) { endIso = bound; endSource = "pattern"; }
      }
    }
    // Instructional weeks the semester touches (week 1 = the start's week).
    const calendarWeeks = calendarWeeksBetween(startIso, endIso);
    if (calendarWeeks < templateWeeks) {
      warnings.push(`${t.name}: the template plans ${templateWeeks} weeks but ${seasonOfIso(startIso)} ${startIso.slice(0, 4)} gives only ${calendarWeeks} (${fmt(startIso)} → ${fmt(endIso)}); its sessions are fitted into those ${calendarWeeks} weeks, in order.`);
    }
    const semester = `${startEvent(starts, startIso)?.season ?? seasonOfIso(startIso)} ${startIso.slice(0, 4)}`;
    out.push({ termId: t.id, index: t.index, name: t.name, startIso, endIso, startSource, endSource, semester, templateWeeks, calendarWeeks, startLabel, endLabel, ...(movedFrom ? { movedFrom } : {}) });
    // The next term may start only after this one's last template week — the
    // calendar's shorter semester never pulls the next term earlier.
    cursor = addDays(startIso, Math.max(templateWeeks, calendarWeeks) * 7);
  }

  // Courses that don't span the whole term get their own window: the weeks
  // their sessions occupy, snapped to a coded later-session start when one
  // matches (a "2nd 8-week session begins" on the calendar).
  const courses: AlignedCourse[] = [];
  for (const c of input.courses) {
    const term = out.find((t) => t.termId === c.termId);
    if (!term) continue;
    const weeks = c.sessions.map((s) => s.week).filter((w): w is number => w != null && w > 0);
    if (!weeks.length) continue;
    const firstWeek = Math.min(...weeks); const lastWeek = Math.max(...weeks);
    const spansTerm = firstWeek <= 1 && lastWeek >= term.templateWeeks;
    if (spansTerm) continue;
    // Template weeks → the term's real weeks (fitted when the semester is shorter).
    const f0 = fitWeek(firstWeek, term.templateWeeks, term.calendarWeeks), f1 = fitWeek(lastWeek, term.templateWeeks, term.calendarWeeks);
    let startIso = addDays(term.startIso, (f0 - 1) * 7); let snappedTo: string | null = null;
    if (firstWeek > 1) {
      const hit = nearest(input.events.filter((e) => e.iso > term.startIso && e.iso <= term.endIso), "session_start", startIso, 7);
      if (hit) { startIso = hit.iso; snappedTo = hit.label; }
    }
    const endIso = [addDays(startIso, (f1 - f0 + 1) * 7 - 3), term.endIso].sort()[0];
    courses.push({ courseId: c.id, termId: c.termId, code: c.code, name: c.name, startIso, endIso, firstWeek, lastWeek, snappedTo });
  }
  return { terms: out, courses, warnings };
}

const startEvent = (starts: CodedEventLite[], isoDate: string) => starts.find((e) => e.iso === isoDate) ?? null;

/** The year an offering finishes, from its aligned terms. */
export const endYearOf = (terms: { endIso: string }[]) => Number(terms.map((t) => t.endIso).sort().at(-1)?.slice(0, 4) ?? NaN);

export const SOURCE_LABEL: Record<DateSource, string> = {
  calendar: "from the academic calendar", pattern: "semester pattern (no coded date for this semester)", template: "template weeks (no coded semester end)", chosen: "the chosen start", manual: "typed by hand",
};
