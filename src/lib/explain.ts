// What the design numbers MEAN — the workbook's ratio inputs translated into
// hours and minutes a real person spends, at every altitude a coordinator asks
// about: this shift, this student, this week, this term, the whole cohort.
//
// The session row says e.g. "0.05 faculty required for a precepted clinical of
// 7.5 h with 1 student per section". The chain is the workbook's own:
//   sections           Y  = ROUNDUP(enrollment ÷ maxStudents)
//   instructor hours   Z  = lengthHours × facultyNeeded × Y      (one occurrence, all sections)
//   preceptor hours    AC = Y × preceptorsNeeded × lengthHours × contactPolicy
// so 0.05 × 7.5 h = 0.375 h = 22 min 30 s of instructor time per section per
// shift; per student that is the same 22.5 min when the section is one
// student; across 41 sections it is 15.375 instructor-hours that day; over a
// 2-shift week and 16 weeks it becomes a term total and an FTE against the
// full-time contact-hour week. Pure, unit-tested.

import { computeColumns, deriveAssumptions, type SessionInput, type WorkloadAssumptions } from "./capacitymodel";
import { PRECISION } from "./format";

export interface ExplainContext {
  /** How many occurrences of this session kind the course runs in a typical week. */
  occurrencesPerWeek: number;
  /** How many weeks the course runs. */
  weeks: number;
  /** Total occurrences of this kind across the course (defaults to occurrencesPerWeek × weeks). */
  occurrencesTotal?: number;
}
export interface RoleMeaning {
  role: "instructor" | "preceptor" | "support";
  /** The ratio as coded on the row. */
  ratio: number;
  /** Hours of this role's time per SECTION per occurrence. */
  perSectionShift: number;
  /** Hours per STUDENT per occurrence. */
  perStudentShift: number;
  perStudentWeek: number;
  perStudentTerm: number;
  /** Hours across ALL sections in one occurrence (the cohort's demand that day). */
  perCohortShift: number;
  perCohortWeek: number;
  perCohortTerm: number;
  /** Full-time equivalents at the assumption's contact-hour week, in a typical week. */
  fteWeek: number;
  /** Whole people that FTE needs at once (each covers one section at a time). */
  headsAtOnce: number;
  /** Plain-language reading. */
  text: string;
}
export interface SessionMeaning {
  sections: number;
  studentsPerSection: number;
  lengthHours: number;
  studentHoursWeek: number;
  studentHoursTerm: number;
  roles: RoleMeaning[];
  headline: string;
}

const r = (x: number) => Number(x.toFixed(PRECISION));
/** "0.375 h (22 min 30 s)" */
export function hm(hours: number): string {
  const totalSec = Math.round(hours * 3600);
  const h = Math.floor(totalSec / 3600), m = Math.floor((totalSec % 3600) / 60), s = totalSec % 60;
  const parts = [h ? `${h} h` : "", m ? `${m} min` : "", s ? `${s} s` : ""].filter(Boolean);
  return `${r(hours)} h${parts.length && !(h && !m && !s) ? ` (${parts.join(" ")})` : ""}`;
}

export function explainSession(s: SessionInput, enrollment: number, a: WorkloadAssumptions, ctx: ExplainContext): SessionMeaning {
  const cols = computeColumns(s, enrollment, a);
  const d = deriveAssumptions(a);
  const L = Math.max(1, s.maxStudents || 1);
  const Y = cols.Y ?? Math.max(1, Math.ceil(enrollment / L));
  const perSec = Math.min(L, Math.max(1, enrollment / Y));
  const T = s.lengthHours || 0;
  const occW = Math.max(0, ctx.occurrencesPerWeek);
  const occT = ctx.occurrencesTotal ?? occW * Math.max(0, ctx.weeks);
  const roles: RoleMeaning[] = [];
  const mk = (role: RoleMeaning["role"], ratio: number, perSectionShift: number, weekly: number, label: string): RoleMeaning => {
    const perStudentShift = perSectionShift / perSec;
    const perCohortShift = perSectionShift * Y;
    const fteWeek = weekly > 0 ? (perCohortShift * occW) / weekly : 0;
    const heads = ratio >= 1 ? Math.ceil(ratio) * Y : Math.ceil(ratio * Y - 1e-9);
    const text = ratio <= 0 ? `No ${label} time is coded on this row.` :
      ratio >= 1
        ? `${r(ratio)} ${label}${ratio > 1 ? "s" : ""} for the whole ${hm(T)} of every section, every time it runs — ${Y} section${Y === 1 ? "" : "s"} means ${heads} ${label}${heads === 1 ? "" : "s"} on duty at once, ${hm(perCohortShift)} of ${label} time per occurrence, ${hm(perCohortShift * occW)} a week, ${hm(perCohortShift * occT)} over the course.`
        : `${r(ratio)} of a ${label} × ${hm(T)} = ${hm(perSectionShift)} of ${label} time per section per occurrence — for ${perSec === 1 ? "the one student" : `each of the ${r(perSec)} students`} in a section that is ${hm(perStudentShift)} per shift, ${hm(perStudentShift * occW)} a week, ${hm(perStudentShift * occT)} over the course. Across all ${Y} section${Y === 1 ? "" : "s"} the cohort needs ${hm(perCohortShift)} of ${label} time every occurrence and ${hm(perCohortShift * occW)} a week — ${r(fteWeek)} FTE at ${a.facContactHours} contact h/week, so ${heads} ${label}${heads === 1 ? "" : "s"} could cover it by visiting ${Y} section${Y === 1 ? "" : "s"} in turn.`;
    return { role, ratio, perSectionShift: r(perSectionShift), perStudentShift: r(perStudentShift), perStudentWeek: r(perStudentShift * occW), perStudentTerm: r(perStudentShift * occT), perCohortShift: r(perCohortShift), perCohortWeek: r(perCohortShift * occW), perCohortTerm: r(perCohortShift * occT), fteWeek: r(fteWeek), headsAtOnce: heads, text };
  };
  roles.push(mk("instructor", s.facultyNeeded || 0, T * (s.facultyNeeded || 0), a.facContactHours, "instructor"));
  const U = s.preceptorContactPolicy == null ? 1 : s.preceptorContactPolicy;
  roles.push(mk("preceptor", s.preceptorsNeeded || 0, T * (s.preceptorsNeeded || 0) * U, d.preWeeklyHours, "preceptor"));
  if ((s.supportStaffNeeded || 0) > 0) roles.push(mk("support", s.supportStaffNeeded || 0, T * (s.supportStaffNeeded || 0), a.facContactHours, "support person"));
  const headline = `${enrollment} students ÷ ${L} per section = ${Y} section${Y === 1 ? "" : "s"} of ${r(perSec)}; each student attends ${hm(T)} per occurrence, ${hm(T * occW)} a week, ${hm(T * occT)} over the course.`;
  return { sections: Y, studentsPerSection: r(perSec), lengthHours: T, studentHoursWeek: r(T * occW), studentHoursTerm: r(T * occT), roles, headline };
}
