// The master calendar's pure half: the six views and the date range each one covers, the month
// grid, what an event is once it is dated, how a search narrows the events to one student,
// instructor, preceptor, site, room, offering, program or course, and the per-day roll-ups the
// coarser views draw. No I/O — lib/calendarquery loads the data, the component draws it.

import { semesterAt, nextSemesterStart, DEFAULT_ANCHORS, type SemesterAnchors } from "./term";

export type CalView = "day" | "week" | "month" | "quarter" | "semester" | "year";
export const CAL_VIEWS: { key: CalView; label: string }[] = [
  { key: "day", label: "Day" }, { key: "week", label: "Week" }, { key: "month", label: "Month" },
  { key: "quarter", label: "Quarter" }, { key: "semester", label: "Semester" }, { key: "year", label: "Year" },
];
export const isCalView = (v: unknown): v is CalView => CAL_VIEWS.some((x) => x.key === v);
/** The views that ship every event; the coarser ones ship day roll-ups and drill in. */
export const EVENT_VIEWS: CalView[] = ["day", "week", "month"];

export type EventKind = "CLASS" | "LAB" | "CLINICAL";
export const KIND_LABEL: Record<EventKind, string> = { CLASS: "Class", LAB: "Lab", CLINICAL: "Clinical" };

/** One section of a session on one date: where it is, who staffs it, who is in it. */
export interface CalSection {
  index: number;
  count: number;
  seats: number;
  /** The weekly booking (MeetingPattern) this section runs under, when one exists — what the pattern editor edits. */
  patternId: string | null;
  roomId: string | null; room: string | null;
  siteId: string | null; site: string | null;
  /** The site is booked on an asset for this date (the scheduler's plan or a hand booking), not only the section's weekly site. */
  booked: boolean;
  staff: { id: string; name: string; role: string }[];
  /** Clinical: the students on the shift; class and lab: the section's roster. */
  students: { id: string; name: string; status: string | null }[];
  /** A per-occurrence move put this section on this date (from its pattern date), or on another time. */
  moved: { fromIso: string; startTime: string | null } | null;
}

/** One session of one offering on one date — the unit everything on the calendar is made of. */
export interface CalEvent {
  id: string;
  date: string; dayOfWeek: string;
  startTime: string | null; endTime: string | null; hours: number;
  kind: EventKind;
  online: boolean;
  title: string | null;
  courseId: string; courseCode: string | null; courseName: string;
  cohortId: string; cohortName: string; cohortStatus: string;
  programId: string; programName: string;
  termName: string; weekOfTerm: number;
  /** The holiday rule moved the whole session off a holiday to this date. */
  holidayMoved: { fromIso: string; holiday: string } | null;
  /** Still on a holiday the rule could not resolve. */
  holiday: string | null;
  sections: CalSection[];
  /** Students across sections (clinical: on the shifts; class/lab: on the rosters). */
  students: number;
}

export type EntityKind = "student" | "person" | "site" | "room" | "cohort" | "program" | "course";
export const ENTITY_LABEL: Record<EntityKind, string> = { student: "Student", person: "Instructor / preceptor", site: "Clinical site", room: "Room", cohort: "Offering", program: "Program", course: "Course" };
/** One searchable thing on the calendar. */
export interface CalEntity { kind: EntityKind; id: string; name: string; sub: string | null }
export const entityKey = (e: { kind: EntityKind; id: string }) => `${e.kind}:${e.id}`;
export function parseEntityKey(s: string | null | undefined): { kind: EntityKind; id: string } | null {
  if (!s) return null;
  const i = s.indexOf(":"); if (i <= 0) return null;
  const kind = s.slice(0, i) as EntityKind; const id = s.slice(i + 1);
  return (["student", "person", "site", "room", "cohort", "program", "course"] as EntityKind[]).includes(kind) && id ? { kind, id } : null;
}

// ── Dates ───────────────────────────────────────────────────────────────────────────────────────
const DAY = 86400000;
export const dateOfIso = (iso: string) => new Date(iso + "T00:00:00Z");
export const isoOfDate = (d: Date) => d.toISOString().slice(0, 10);
export const addDaysIso = (iso: string, n: number) => isoOfDate(new Date(dateOfIso(iso).getTime() + n * DAY));
/** Monday = 0 … Sunday = 6. */
export const dowIndex = (iso: string) => (dateOfIso(iso).getUTCDay() + 6) % 7;
export const mondayIso = (iso: string) => addDaysIso(iso, -dowIndex(iso));
export const DOW_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const dowShort = (iso: string) => DOW_SHORT[dowIndex(iso)];
export const isValidIso = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(dateOfIso(s).getTime());
const monthStart = (iso: string) => iso.slice(0, 8) + "01";
const monthEnd = (iso: string) => { const d = dateOfIso(monthStart(iso)); return isoOfDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))); };
const addMonths = (iso: string, n: number) => { const d = dateOfIso(iso); return isoOfDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))); };
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (iso: string, long = true) => { const d = dateOfIso(iso); return `${(long ? MONTH_LONG : MONTH_SHORT)[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
export const dayLabel = (iso: string) => dateOfIso(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
export const shortDate = (iso: string) => dateOfIso(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export interface CalRange {
  view: CalView;
  /** The date the view is anchored on (normalised: the range's first day for every view but day and week). */
  dateIso: string;
  fromIso: string; toIso: string;
  label: string;
  /** Anchor dates for the previous and next range. */
  prevIso: string; nextIso: string;
  /** For semester: the season and year. */
  semester?: { season: string; year: number };
}

/** The date range a view covers around a date, and where ← and → go. */
export function rangeFor(view: CalView, dateIso: string, anchors: SemesterAnchors = DEFAULT_ANCHORS): CalRange {
  switch (view) {
    case "day": return { view, dateIso, fromIso: dateIso, toIso: dateIso, label: dayLabel(dateIso), prevIso: addDaysIso(dateIso, -1), nextIso: addDaysIso(dateIso, 1) };
    case "week": { const mon = mondayIso(dateIso); const sun = addDaysIso(mon, 6); return { view, dateIso, fromIso: mon, toIso: sun, label: `Week of ${shortDate(mon)}${mon.slice(0, 4) !== sun.slice(0, 4) ? ` ${mon.slice(0, 4)}` : ""} – ${shortDate(sun)}, ${sun.slice(0, 4)}`, prevIso: addDaysIso(dateIso, -7), nextIso: addDaysIso(dateIso, 7) }; }
    case "month": { const from = monthStart(dateIso); return { view, dateIso: from, fromIso: from, toIso: monthEnd(from), label: monthLabel(from), prevIso: addMonths(from, -1), nextIso: addMonths(from, 1) }; }
    case "quarter": { const d = dateOfIso(dateIso); const q = Math.floor(d.getUTCMonth() / 3); const from = isoOfDate(new Date(Date.UTC(d.getUTCFullYear(), q * 3, 1))); const to = monthEnd(addMonths(from, 2)); return { view, dateIso: from, fromIso: from, toIso: to, label: `Q${q + 1} ${d.getUTCFullYear()} · ${MONTH_SHORT[q * 3]}–${MONTH_SHORT[q * 3 + 2]}`, prevIso: addMonths(from, -3), nextIso: addMonths(from, 3) }; }
    case "semester": {
      const d = dateOfIso(dateIso);
      const sem = semesterAt(d, anchors);
      const start = semesterStartIso(sem.season, sem.year, anchors);
      const next = isoOfDate(nextSemesterStart(dateOfIso(addDaysIso(start, 1)), anchors));
      const to = addDaysIso(next, -1);
      return { view, dateIso: start, fromIso: start, toIso: to, label: `${sem.season} ${sem.year} · ${shortDate(start)} – ${shortDate(to)}`, prevIso: addDaysIso(start, -1), nextIso: next, semester: sem };
    }
    case "year": { const y = dateIso.slice(0, 4); return { view, dateIso: `${y}-01-01`, fromIso: `${y}-01-01`, toIso: `${y}-12-31`, label: y, prevIso: `${Number(y) - 1}-01-01`, nextIso: `${Number(y) + 1}-01-01` }; }
  }
}
function semesterStartIso(season: string, year: number, anchors: SemesterAnchors): string {
  const mmdd = season === "Spring" ? anchors.springStart || DEFAULT_ANCHORS.springStart : season === "Summer" ? anchors.summerStart || DEFAULT_ANCHORS.summerStart : anchors.fallStart || DEFAULT_ANCHORS.fallStart;
  // The semester starts on the Monday on or after its anchor date (lib/term mondayOnOrAfter).
  const d = dateOfIso(`${year}-${mmdd}`);
  const off = (8 - d.getUTCDay()) % 7;
  return isoOfDate(new Date(d.getTime() + off * DAY));
}

/** The months a range spans, first day of each. */
export function monthsIn(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  for (let m = monthStart(fromIso); m <= toIso; m = addMonths(m, 1)) out.push(m);
  return out;
}
/** A month as rows of seven ISO dates, Monday first; days outside the month are marked. */
export function monthGrid(monthIso: string): { iso: string; inMonth: boolean }[][] {
  const first = monthStart(monthIso), last = monthEnd(first);
  const start = mondayIso(first);
  const rows: { iso: string; inMonth: boolean }[][] = [];
  for (let d = start; d <= last || rows.length === 0; d = addDaysIso(d, 7)) {
    rows.push(Array.from({ length: 7 }, (_, i) => { const iso = addDaysIso(d, i); return { iso, inMonth: iso >= first && iso <= last }; }));
    if (addDaysIso(d, 7) > last) break;
  }
  return rows;
}

// ── Narrowing to one thing ──────────────────────────────────────────────────────────────────────
/** True when the event touches the entity; sections are narrowed to the ones that do. */
export function narrowEvent(e: CalEvent, who: { kind: EntityKind; id: string } | null): CalEvent | null {
  if (!who) return e;
  switch (who.kind) {
    case "cohort": return e.cohortId === who.id ? e : null;
    case "program": return e.programId === who.id ? e : null;
    case "course": return e.courseId === who.id ? e : null;
    case "student": { const s = e.sections.filter((x) => x.students.some((st) => st.id === who.id)); return s.length ? { ...e, sections: s, students: s.reduce((n, x) => n + x.students.length, 0) } : null; }
    case "person": { const s = e.sections.filter((x) => x.staff.some((p) => p.id === who.id)); return s.length ? { ...e, sections: s, students: s.reduce((n, x) => n + x.students.length, 0) } : null; }
    case "site": { const s = e.sections.filter((x) => x.siteId === who.id); return s.length ? { ...e, sections: s, students: s.reduce((n, x) => n + x.students.length, 0) } : null; }
    case "room": { const s = e.sections.filter((x) => x.roomId === who.id); return s.length ? { ...e, sections: s, students: s.reduce((n, x) => n + x.students.length, 0) } : null; }
  }
}
export function narrowEvents(events: CalEvent[], who: { kind: EntityKind; id: string } | null, kind?: EventKind | null, programId?: string | null): CalEvent[] {
  const out: CalEvent[] = [];
  for (const e of events) {
    if (kind && e.kind !== kind) continue;
    if (programId && e.programId !== programId) continue;
    const n = narrowEvent(e, who); if (n) out.push(n);
  }
  return out;
}

// ── Roll-ups ────────────────────────────────────────────────────────────────────────────────────
export interface CalDayAgg { date: string; sessions: number; classes: number; labs: number; clinicals: number; studentShifts: number; hours: number; sites: number; rooms: number }
export function aggregateDays(events: CalEvent[]): Record<string, CalDayAgg> {
  const out: Record<string, CalDayAgg> = {};
  const sitesBy = new Map<string, Set<string>>(), roomsBy = new Map<string, Set<string>>();
  for (const e of events) {
    const a = (out[e.date] ??= { date: e.date, sessions: 0, classes: 0, labs: 0, clinicals: 0, studentShifts: 0, hours: 0, sites: 0, rooms: 0 });
    a.sessions++; if (e.kind === "CLASS") a.classes++; else if (e.kind === "LAB") a.labs++; else a.clinicals++;
    a.hours += e.hours;
    if (e.kind === "CLINICAL") a.studentShifts += e.students;
    for (const s of e.sections) { if (s.siteId) (sitesBy.get(e.date) ?? sitesBy.set(e.date, new Set()).get(e.date)!).add(s.siteId); if (s.roomId) (roomsBy.get(e.date) ?? roomsBy.set(e.date, new Set()).get(e.date)!).add(s.roomId); }
  }
  for (const [d, s] of sitesBy) out[d].sites = s.size;
  for (const [d, s] of roomsBy) out[d].rooms = s.size;
  return out;
}
export interface CalTotals { sessions: number; classes: number; labs: number; clinicals: number; studentShifts: number; hours: number; sites: number; rooms: number; people: number; students: number; days: number; movedByRule: number; onHoliday: number; unbookedClinical: number; unstaffed: number }
export function totalsOf(events: CalEvent[]): CalTotals {
  const sites = new Set<string>(), rooms = new Set<string>(), people = new Set<string>(), students = new Set<string>(), days = new Set<string>();
  const t: CalTotals = { sessions: 0, classes: 0, labs: 0, clinicals: 0, studentShifts: 0, hours: 0, sites: 0, rooms: 0, people: 0, students: 0, days: 0, movedByRule: 0, onHoliday: 0, unbookedClinical: 0, unstaffed: 0 };
  for (const e of events) {
    t.sessions++; if (e.kind === "CLASS") t.classes++; else if (e.kind === "LAB") t.labs++; else t.clinicals++;
    t.hours += e.hours; days.add(e.date);
    if (e.kind === "CLINICAL") t.studentShifts += e.students;
    if (e.holidayMoved) t.movedByRule++; if (e.holiday) t.onHoliday++;
    let staffed = false;
    for (const s of e.sections) {
      if (s.siteId) sites.add(s.siteId); if (s.roomId) rooms.add(s.roomId);
      for (const p of s.staff) { people.add(p.id); staffed = true; }
      for (const st of s.students) students.add(st.id);
      if (e.kind === "CLINICAL" && !s.booked) t.unbookedClinical++;
    }
    if (!staffed && !e.online) t.unstaffed++;
  }
  t.sites = sites.size; t.rooms = rooms.size; t.people = people.size; t.students = students.size; t.days = days.size;
  return t;
}

/** Events grouped by week Monday, for the week strip of the coarser views. */
export function byWeek(events: CalEvent[]): Map<string, CalEvent[]> {
  const m = new Map<string, CalEvent[]>();
  for (const e of events) { const k = mondayIso(e.date); const l = m.get(k) ?? []; l.push(e); m.set(k, l); }
  return m;
}

/** Search: case-insensitive, every word must appear in the name or its sub-line; best matches first. */
export function searchEntities(entities: CalEntity[], q: string, limit = 12): CalEntity[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored: { e: CalEntity; score: number }[] = [];
  for (const e of entities) {
    const name = e.name.toLowerCase(), sub = (e.sub ?? "").toLowerCase();
    if (!words.every((w) => name.includes(w) || sub.includes(w))) continue;
    const score = (name.startsWith(words[0]) ? 2 : name.includes(words[0]) ? 1 : 0) - name.length / 100;
    scored.push({ e, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name)).slice(0, limit).map((x) => x.e);
}
