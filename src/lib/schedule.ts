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
  location?: string | null;
  rotationType?: string | null;
  clinicalMode?: string | null;
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
}

function staffFor(s: ScheduleSession): { type: StaffType; per: number } {
  if (s.kind === "CLINICAL" && s.preceptorsNeeded > 0) {
    return { type: "preceptor", per: Math.max(1, Math.round(s.preceptorsNeeded)) };
  }
  return { type: "instructor", per: Math.max(1, Math.round(s.facultyNeeded || 1)) };
}

/** Expand template sessions into the full list of dated, staffable shifts. */
export function expandSchedule(sessions: ScheduleSession[], enrollment: number): Shift[] {
  const shifts: Shift[] = [];
  for (const s of sessions) {
    const sections = s.maxStudents > 0 && enrollment > 0 ? roundUpInt(enrollment / s.maxStudents) : 0;
    if (sections <= 0) continue;
    const week = s.week ?? 1;
    const day = s.dayOfWeek ?? "Mon";
    const dayIndex = DAY_ORDER.indexOf(day) === -1 ? 0 : DAY_ORDER.indexOf(day);
    const { type, per } = staffFor(s);
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
      });
    }
  }
  return shifts.sort((a, b) => a.week - b.week || a.dayIndex - b.dayIndex || a.courseCode.localeCompare(b.courseCode) || a.kind.localeCompare(b.kind) || a.sectionIndex - b.sectionIndex);
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
