// Clinical analytics for a program design — template OR instantiation.
//
// Reads the session rows (the Raw Data & Calculations sheet) and answers, top
// line and per course: how many clinical hours a student sits through, in
// which SETTINGS (rotation type), in which MODES (instructor-led,
// preceptor-led …), on which SHIFTS (day / evening / night, from the start
// time and length), on which DAYS of the week, delivered how, and what that
// becomes at a given enrollment (sections, student-hours, preceptor-shifts).
// Pure functions — no React, no Prisma — so both design pages and tests share
// one set of numbers.

export type Kind = "CLASS" | "LAB" | "CLINICAL";
export type Shift = "Day" | "Evening" | "Night";

export interface AnalyticsSession {
  id: string;
  kind: string;
  lengthHours: number;
  maxStudents: number;
  preceptorsNeeded?: number | null;
  facultyNeeded?: number | null;
  deliveryMode?: string | null;
  location?: string | null;
  rotationType?: string | null;
  clinicalMode?: string | null;
  startTime?: string | null;
  dayOfWeek?: string | null;
  week?: number | null;
  /** Which term the week number counts from — weeks restart every term. */
  termIndex?: number | null;
  termName?: string | null;
}
export interface AnalyticsCourse {
  id: string;
  code: string | null;
  name: string;
  termName: string;
  termIndex: number;
  weeks: number;
  sessions: AnalyticsSession[];
}

/** One row of a breakdown table: a label, what it adds up to, and its share of the whole. */
export interface Slice {
  key: string;
  sessions: number;
  hours: number;          // hours a single student attends
  share: number;          // of clinical hours (0–1)
  sections: number;       // at the enrollment used
  studentHours: number;   // hours × enrollment
  preceptorShifts: number;// sections × preceptors per section (each session is one shift)
  starts: string[];       // distinct start times seen (for the shift table)
}

export interface ClinicalProfile {
  enrollment: number;
  totalHours: number;      // all kinds, per student
  clinicalHours: number;
  clinicalShare: number;   // clinicalHours / totalHours
  clinicalSessions: number;
  settings: Slice[];
  modes: Slice[];
  shifts: Slice[];
  days: Slice[];
  delivery: Slice[];       // deliveryMode across ALL kinds, by hours
  locations: Slice[];      // location across ALL kinds, by hours
  avgShiftHours: number;
  longestShiftHours: number;
  shortestShiftHours: number;
  unscheduled: number;     // clinical sessions with no start time
  sectionsAtEnrollment: number;
  studentHoursAtEnrollment: number;
  preceptorShiftsAtEnrollment: number;
  facultyShiftsAtEnrollment: number;
  weeksWithClinical: number;
  peakWeekHours: number;   // most clinical hours a student has in any single week of any term
  peakWeek: string | null; // e.g. "First Fall wk 3"
}

export const NOT_SET = "(not set)";
export const SHIFT_ORDER: Shift[] = ["Day", "Evening", "Night"];
export const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Same thresholds as the supply side (clinicalsupply.shiftBlockOf): 07–15 Day, 15–23 Evening, else Night. */
export function shiftOf(startTime: string | null | undefined): Shift | null {
  if (!startTime) return null;
  const h = Number(startTime.split(":")[0]);
  if (!Number.isFinite(h)) return null;
  if (h >= 7 && h < 15) return "Day";
  if (h >= 15 && h < 23) return "Evening";
  return "Night";
}

export const sectionsFor = (enrollment: number, maxStudents: number) => (enrollment > 0 && maxStudents > 0 ? Math.ceil(enrollment / maxStudents) : 0);

const isClinical = (s: AnalyticsSession) => s.kind === "CLINICAL";

function slices(rows: AnalyticsSession[], keyOf: (s: AnalyticsSession) => string, enrollment: number, denom: number, order?: string[]): Slice[] {
  const m = new Map<string, Slice>();
  for (const s of rows) {
    const key = keyOf(s) || NOT_SET;
    const cur = m.get(key) ?? { key, sessions: 0, hours: 0, share: 0, sections: 0, studentHours: 0, preceptorShifts: 0, starts: [] };
    const sec = sectionsFor(enrollment, s.maxStudents);
    cur.sessions += 1; cur.hours += s.lengthHours; cur.sections += sec; cur.studentHours += s.lengthHours * enrollment; cur.preceptorShifts += sec * (s.preceptorsNeeded ?? 0);
    if (s.startTime && !cur.starts.includes(s.startTime)) cur.starts.push(s.startTime);
    m.set(key, cur);
  }
  const out = [...m.values()].map((x) => ({ ...x, share: denom > 0 ? x.hours / denom : 0, starts: x.starts.sort() }));
  if (order) return out.sort((a, b) => { const ia = order.indexOf(a.key), ib = order.indexOf(b.key); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || b.hours - a.hours; });
  return out.sort((a, b) => b.hours - a.hours || a.key.localeCompare(b.key));
}

export function clinicalProfile(sessions: AnalyticsSession[], enrollment: number): ClinicalProfile {
  const clin = sessions.filter(isClinical);
  const totalHours = sessions.reduce((n, s) => n + s.lengthHours, 0);
  const clinicalHours = clin.reduce((n, s) => n + s.lengthHours, 0);
  const lens = clin.map((s) => s.lengthHours).filter((h) => h > 0);
  // Weeks restart each term, so a "program week" is (term, week).
  const byWeek = new Map<string, { hours: number; label: string }>();
  for (const s of clin) if (s.week != null) { const k = `${s.termIndex ?? 0}|${s.week}`; const cur = byWeek.get(k) ?? { hours: 0, label: s.termName ? `${s.termName} wk ${s.week}` : `wk ${s.week}` }; cur.hours += s.lengthHours; byWeek.set(k, cur); }
  let peakWeek: string | null = null, peakWeekHours = 0;
  for (const v of byWeek.values()) if (v.hours > peakWeekHours) { peakWeekHours = v.hours; peakWeek = v.label; }
  let sectionsAtEnrollment = 0, preceptorShiftsAtEnrollment = 0, facultyShiftsAtEnrollment = 0;
  for (const s of clin) { const sec = sectionsFor(enrollment, s.maxStudents); sectionsAtEnrollment += sec; preceptorShiftsAtEnrollment += sec * (s.preceptorsNeeded ?? 0); facultyShiftsAtEnrollment += sec * (s.facultyNeeded ?? 0); }
  return {
    enrollment,
    totalHours, clinicalHours, clinicalShare: totalHours > 0 ? clinicalHours / totalHours : 0, clinicalSessions: clin.length,
    settings: slices(clin, (s) => s.rotationType?.trim() ?? "", enrollment, clinicalHours),
    modes: slices(clin, (s) => s.clinicalMode?.trim() ?? "", enrollment, clinicalHours),
    shifts: slices(clin, (s) => shiftOf(s.startTime) ?? "", enrollment, clinicalHours, [...SHIFT_ORDER, NOT_SET]),
    days: slices(clin, (s) => s.dayOfWeek?.trim() ?? "", enrollment, clinicalHours, [...DAY_ORDER, NOT_SET]),
    delivery: slices(sessions, (s) => s.deliveryMode?.trim() ?? "", enrollment, totalHours),
    locations: slices(sessions, (s) => s.location?.trim() ?? "", enrollment, totalHours),
    avgShiftHours: lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0,
    longestShiftHours: lens.length ? Math.max(...lens) : 0,
    shortestShiftHours: lens.length ? Math.min(...lens) : 0,
    unscheduled: clin.filter((s) => !s.startTime).length,
    sectionsAtEnrollment, studentHoursAtEnrollment: clinicalHours * enrollment, preceptorShiftsAtEnrollment, facultyShiftsAtEnrollment,
    weeksWithClinical: byWeek.size, peakWeekHours, peakWeek,
  };
}

export interface CourseProfile extends ClinicalProfile { courseId: string; code: string | null; name: string; termName: string; termIndex: number; weeks: number; hoursPerWeek: number }

/** Flatten courses to sessions, stamping each with its term so week numbers don't collide across terms. */
export const sessionsOf = (courses: AnalyticsCourse[]): AnalyticsSession[] => courses.flatMap((c) => c.sessions.map((s) => ({ ...s, termIndex: c.termIndex, termName: c.termName })));

export function courseProfiles(courses: AnalyticsCourse[], enrollment: number): CourseProfile[] {
  return courses.map((c) => { const p = clinicalProfile(sessionsOf([c]), enrollment); return { ...p, courseId: c.id, code: c.code, name: c.name, termName: c.termName, termIndex: c.termIndex, weeks: c.weeks, hoursPerWeek: c.weeks > 0 ? p.clinicalHours / c.weeks : 0 }; });
}

/** Rows = courses with clinical hours, columns = every setting used anywhere — "which settings for which courses, how many hours". */
export function settingMatrix(courses: AnalyticsCourse[]): { settings: string[]; rows: { courseId: string; code: string | null; name: string; termName: string; hours: Record<string, number>; total: number }[]; totals: Record<string, number> } {
  const settings: string[] = [];
  const rows = [];
  const totals: Record<string, number> = {};
  for (const c of courses) {
    const hours: Record<string, number> = {};
    let total = 0;
    for (const s of c.sessions) {
      if (!isClinical(s)) continue;
      const k = s.rotationType?.trim() || NOT_SET;
      if (!settings.includes(k)) settings.push(k);
      hours[k] = (hours[k] ?? 0) + s.lengthHours; totals[k] = (totals[k] ?? 0) + s.lengthHours; total += s.lengthHours;
    }
    if (total > 0) rows.push({ courseId: c.id, code: c.code, name: c.name, termName: c.termName, hours, total });
  }
  settings.sort((a, b) => (a === NOT_SET ? 1 : b === NOT_SET ? -1 : (totals[b] ?? 0) - (totals[a] ?? 0)));
  return { settings, rows, totals };
}

/** Plain-English top line for the whole program or one course. */
export function clinicalStatement(p: ClinicalProfile, subject: string): string {
  if (p.clinicalSessions === 0) return `${subject} has no clinical sessions yet.`;
  const settings = p.settings.filter((s) => s.key !== NOT_SET);
  const modes = p.modes.filter((s) => s.key !== NOT_SET);
  const shifts = p.shifts.filter((s) => s.key !== NOT_SET);
  const pct = Math.round(p.clinicalShare * 100);
  const parts = [
    `A student in ${subject} sits through ${fmt(p.clinicalHours)} clinical hours (${pct}% of ${fmt(p.totalHours)} total) over ${p.clinicalSessions} clinical sessions`,
    settings.length ? `in ${settings.length} setting${settings.length === 1 ? "" : "s"} (${settings.slice(0, 4).map((s) => `${s.key} ${fmt(s.hours)}h`).join(", ")}${settings.length > 4 ? ", …" : ""})` : "with no setting assigned",
    modes.length ? `${modes.map((m) => `${Math.round(m.share * 100)}% ${m.key.toLowerCase()}`).join(", ")}` : "",
    shifts.length ? `on ${shifts.map((s) => `${s.key.toLowerCase()} shift${s.key === "Day" ? "s" : "s"} ${Math.round(s.share * 100)}%`).join(", ")}` : "",
    `shifts average ${fmt1(p.avgShiftHours)} h (${fmt1(p.shortestShiftHours)}–${fmt1(p.longestShiftHours)})`,
  ].filter(Boolean);
  const at = `At ${p.enrollment} students that is ${fmt(p.studentHoursAtEnrollment)} student-hours, ${fmt(p.sectionsAtEnrollment)} clinical sections and ${fmt(p.preceptorShiftsAtEnrollment)} preceptor-shifts.`;
  return `${parts.join("; ")}. ${at}${p.unscheduled ? ` ${p.unscheduled} clinical session${p.unscheduled === 1 ? " has" : "s have"} no start time yet, so its shift is unknown.` : ""}`;
}

const fmt = (v: number) => Math.round(v).toLocaleString();
const fmt1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 });
