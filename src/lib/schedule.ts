// Schedule engine — turns the program TEMPLATE into a dated, day-by-day plan of
// staffable SHIFTS.
//
// A "session" in the template is what ONE student attends. Scaled by enrollment
// it becomes N sections (= ROUNDUP(enrollment / max-per-section)). Each section,
// on its week + day, is a SHIFT that a real instructor (class/lab) or preceptor
// (clinical) has to work. This module expands the template into those shifts and
// gives the calendar + staffing views something concrete to lay out and assign.

import { roundUpInt } from "./service";

export type ShiftKind = "CLASS" | "LAB" | "CLINICAL";
export type StaffType = "instructor" | "preceptor";

export const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** A planned staff member on a session, and the share of contact hours they
 *  cover (co-teaching splits a session across two instructors). */
export interface PlannedStaff {
  personId: string;
  name: string;
  role: string; // instructor | preceptor | support
  contactHours: number;
  segment?: string | null;
}

export interface ScheduleSession {
  id: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  kind: ShiftKind;
  title?: string | null;
  lengthHours: number;
  maxStudents: number;
  facultyNeeded: number;
  preceptorsNeeded: number;
  week?: number | null;
  dayOfWeek?: string | null;
  startTime?: string | null; // "HH:MM"
  location?: string | null;
  rotationType?: string | null;
  clinicalMode?: string | null;
  homework?: string | null;
  staff?: PlannedStaff[]; // default (seeded) staffing, incl. co-teaching splits
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Real calendar date for (week, dayIndex) anchored on the term's start date. */
function shiftDate(termStartISO: string, week: number, dayIndex: number): Date {
  const start = new Date(termStartISO);
  const sinceMonday = (start.getUTCDay() + 6) % 7; // 0 if Monday
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() - sinceMonday + (week - 1) * 7 + dayIndex));
  return d;
}
/** "09:00" + 3.5h → "12:30". */
export function addHoursToTime(hhmm: string, hours: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + Math.round(hours * 60);
  const hh = Math.floor((total % (24 * 60)) / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
export function formatTime12(hhmm?: string | null): string {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

export interface Shift {
  id: string; // sessionId + section index — stable, used as the assignment key
  sessionId: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  kind: ShiftKind;
  title: string;
  week: number;
  day: string;
  dayIndex: number;
  lengthHours: number;
  location: string | null;
  rotationType: string | null;
  clinicalMode: string | null;
  sectionIndex: number; // 1-based
  sections: number; // total sections for this session
  staffType: StaffType;
  /** Staff of `staffType` needed to run ONE section/shift (lab can be 2). */
  staffPerShift: number;
  homework: string | null;
  /** Default (seeded) staffing for the session, incl. co-teaching splits. */
  staff: PlannedStaff[];
  // Real calendar placement (populated when a term start date is provided).
  dateISO: string | null; // "2025-09-15"
  dateLabel: string | null; // "Mon, Sep 15, 2025"
  monthKey: string | null; // "2025-09"
  monthLabel: string | null; // "September 2025"
  startTime: string | null; // "09:00"
  endTime: string | null; // "12:00"
}

function staffFor(s: ScheduleSession): { type: StaffType; per: number } {
  if (s.kind === "CLINICAL" && s.preceptorsNeeded > 0) {
    return { type: "preceptor", per: Math.max(1, Math.round(s.preceptorsNeeded)) };
  }
  return { type: "instructor", per: Math.max(1, Math.round(s.facultyNeeded || 1)) };
}

/** Expand template sessions into the full list of dated, staffable shifts.
 *  Pass `opts.termStart` (ISO date of the term's first day) to land shifts on
 *  real calendar dates with times. */
export function expandSchedule(sessions: ScheduleSession[], enrollment: number, opts: { termStart?: string | null } = {}): Shift[] {
  const shifts: Shift[] = [];
  for (const s of sessions) {
    const sections = s.maxStudents > 0 && enrollment > 0 ? roundUpInt(enrollment / s.maxStudents) : 0;
    if (sections <= 0) continue;
    const week = s.week ?? 1;
    const day = s.dayOfWeek ?? "Mon";
    const dayIndex = DAY_ORDER.indexOf(day) === -1 ? 0 : DAY_ORDER.indexOf(day);
    const { type, per } = staffFor(s);

    let dateISO: string | null = null, dateLabel: string | null = null, monthKey: string | null = null, monthLabel: string | null = null;
    if (opts.termStart) {
      const d = shiftDate(opts.termStart, week, dayIndex);
      dateISO = d.toISOString().slice(0, 10);
      dateLabel = `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
      monthKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      monthLabel = `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    }
    const startTime = s.startTime ?? null;
    const endTime = startTime ? addHoursToTime(startTime, s.lengthHours) : null;

    for (let i = 1; i <= sections; i++) {
      shifts.push({
        id: `${s.id}#${i}`,
        sessionId: s.id,
        courseId: s.courseId,
        courseCode: s.courseCode,
        courseName: s.courseName,
        kind: s.kind,
        title: s.title ?? `${s.courseCode} ${s.kind.toLowerCase()}`,
        week,
        day,
        dayIndex,
        lengthHours: s.lengthHours,
        location: s.location ?? null,
        rotationType: s.rotationType ?? null,
        clinicalMode: s.clinicalMode ?? null,
        sectionIndex: i,
        sections,
        staffType: type,
        staffPerShift: per,
        homework: s.homework ?? null,
        staff: s.staff ?? [],
        dateISO,
        dateLabel,
        monthKey,
        monthLabel,
        startTime,
        endTime,
      });
    }
  }
  return shifts.sort((a, b) => a.week - b.week || a.dayIndex - b.dayIndex || (a.startTime ?? "").localeCompare(b.startTime ?? "") || a.courseCode.localeCompare(b.courseCode) || a.sectionIndex - b.sectionIndex);
}

export interface ScheduleSummary {
  totalShifts: number;
  classShifts: number;
  labShifts: number;
  clinicalShifts: number;
  /** Distinct staff slots to fill (a lab shift needing 2 instructors counts as 2). */
  instructorSlots: number;
  preceptorSlots: number;
  weeks: number[];
  days: string[];
}

export function summarize(shifts: Shift[]): ScheduleSummary {
  const weeks = [...new Set(shifts.map((s) => s.week))].sort((a, b) => a - b);
  const days = DAY_ORDER.filter((d) => shifts.some((s) => s.day === d));
  let instructorSlots = 0;
  let preceptorSlots = 0;
  for (const s of shifts) {
    if (s.staffType === "instructor") instructorSlots += s.staffPerShift;
    else preceptorSlots += s.staffPerShift;
  }
  return {
    totalShifts: shifts.length,
    classShifts: shifts.filter((s) => s.kind === "CLASS").length,
    labShifts: shifts.filter((s) => s.kind === "LAB").length,
    clinicalShifts: shifts.filter((s) => s.kind === "CLINICAL").length,
    instructorSlots,
    preceptorSlots,
    weeks,
    days,
  };
}

/** Group shifts into week → day → shifts for the calendar grid. */
export function gridByWeekDay(shifts: Shift[]): Map<number, Map<string, Shift[]>> {
  const grid = new Map<number, Map<string, Shift[]>>();
  for (const s of shifts) {
    if (!grid.has(s.week)) grid.set(s.week, new Map());
    const wk = grid.get(s.week)!;
    if (!wk.has(s.day)) wk.set(s.day, []);
    wk.get(s.day)!.push(s);
  }
  return grid;
}

/** Per-staff workload from an assignment map (shiftId → personId). Counts shifts
 *  and contact hours so you can see who is over/under-loaded. */
export interface StaffLoad {
  personId: string;
  shifts: number;
  hours: number;
}
export function staffLoads(shifts: Shift[], assignments: Record<string, string[]>): StaffLoad[] {
  const byPerson = new Map<string, StaffLoad>();
  for (const s of shifts) {
    for (const personId of assignments[s.id] ?? []) {
      const cur = byPerson.get(personId) ?? { personId, shifts: 0, hours: 0 };
      cur.shifts += 1;
      cur.hours += s.lengthHours;
      byPerson.set(personId, cur);
    }
  }
  return [...byPerson.values()].sort((a, b) => b.hours - a.hours);
}

/** Detailed per-person workload: total contact hours, weekly average, and a
 *  class/lab/clinical breakdown — what the user wants to see when staffing. */
export interface StaffLoadDetail {
  personId: string;
  shifts: number;
  contactHours: number;
  weeklyAvgHours: number;
  classHours: number;
  labHours: number;
  clinicalHours: number;
  distinctDays: number;
}
/** Contact hours a person works on a single shift. With co-teaching, a session
 *  is split, so the person only earns their planned share of the length. */
export function shiftHoursFor(shift: Shift, personId: string): number {
  const planned = shift.staff.find((p) => p.personId === personId);
  if (planned) return Math.min(planned.contactHours, shift.lengthHours);
  return shift.lengthHours;
}

export function staffLoadDetail(shifts: Shift[], assignments: Record<string, string[]>, termWeeks: number, hoursFor: (shift: Shift, personId: string) => number = shiftHoursFor): StaffLoadDetail[] {
  const map = new Map<string, StaffLoadDetail & { _days: Set<string> }>();
  for (const s of shifts) {
    for (const personId of assignments[s.id] ?? []) {
      const cur = map.get(personId) ?? { personId, shifts: 0, contactHours: 0, weeklyAvgHours: 0, classHours: 0, labHours: 0, clinicalHours: 0, distinctDays: 0, _days: new Set<string>() };
      const hrs = hoursFor(s, personId);
      cur.shifts += 1;
      cur.contactHours += hrs;
      if (s.kind === "CLASS") cur.classHours += hrs;
      else if (s.kind === "LAB") cur.labHours += hrs;
      else cur.clinicalHours += hrs;
      cur._days.add(s.dateISO ?? `${s.week}-${s.day}`);
      map.set(personId, cur);
    }
  }
  const weeks = Math.max(1, termWeeks);
  return [...map.values()]
    .map(({ _days, ...d }) => ({
      ...d,
      contactHours: Math.round(d.contactHours * 10) / 10,
      classHours: Math.round(d.classHours * 10) / 10,
      labHours: Math.round(d.labHours * 10) / 10,
      clinicalHours: Math.round(d.clinicalHours * 10) / 10,
      distinctDays: _days.size,
      weeklyAvgHours: d.contactHours / weeks,
    }))
    .sort((a, b) => b.contactHours - a.contactHours);
}

/** A named student placed into a cohort section. */
export interface SectionStudent {
  id: string;
  name: string;
  sectionIndex: number;
  stageKey?: string | null;
  status?: string | null;
  clinicalSite?: string | null;
}

/** Which students sit in a given shift: those whose cohort section maps onto
 *  this shift's section (round-robin across the session's section count). For a
 *  single-section session (e.g. a 40-seat lecture) that's everyone. */
export function studentsForShift(shift: Shift, students: SectionStudent[]): SectionStudent[] {
  const sections = Math.max(1, shift.sections);
  return students.filter((s) => ((Math.max(1, s.sectionIndex) - 1) % sections) + 1 === shift.sectionIndex);
}

/** Group shifts by real month → date → shifts for a month-grid calendar. */
export function gridByMonth(shifts: Shift[]): Map<string, { label: string; days: Map<string, Shift[]> }> {
  const months = new Map<string, { label: string; days: Map<string, Shift[]> }>();
  for (const s of shifts) {
    if (!s.monthKey || !s.dateISO) continue;
    if (!months.has(s.monthKey)) months.set(s.monthKey, { label: s.monthLabel ?? s.monthKey, days: new Map() });
    const m = months.get(s.monthKey)!;
    if (!m.days.has(s.dateISO)) m.days.set(s.dateISO, []);
    m.days.get(s.dateISO)!.push(s);
  }
  return new Map([...months.entries()].sort());
}
