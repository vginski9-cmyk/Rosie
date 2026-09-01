// Clinical Capacity Model engine — a faithful port of the Surgical Technologist
// clinical-capacity workbook (Raw Data & Calculations sheet + FTEs per Week /
// FTEs per Setting / # of Shifts pivots), generalized to any program template.
//
// The workbook's spine:
//
//   SESSION TABLE (Table1, columns A–AE). One row per session of every course.
//   Columns D–W are editable inputs; A (Term Number) and B (Semester) come from
//   the course sequence; C (Enrollment) comes from the per-term enrollment
//   sheet; X–AE are live formulas:
//     Y  = ROUNDUP(C / L, 0)     sections required to service hour requirements
//     X  = K × Y                 total space hours
//     Z  = K × M × Y             total faculty contact hours
//     AA = Z / $AM$2             … semesterly (AM2 = faculty term weeks × contact hrs)
//     AB = Z / $AI$2             … weekly (AI2 = full-time faculty contact hrs)
//     AC = Y × T × K × U         total preceptor contact hours
//     AD = AC / $AM$5            … semesterly
//     AE = AC / $AN$5            … weekly (AN5 = full-time preceptor contact hrs)
//
//   WORKLOAD ASSUMPTIONS (cells AH–AN). Faculty row 2, preceptor row 5:
//     AK = AJ / AI   (contact-hour conversion)
//     AM = AL × AI   (total semesterly contact hours)
//     AN = AI        (weekly contact hours)
//
//   CALENDAR LAYER. Each cohort instantiates the template with real term start
//   dates, so "Week 3 · Wednesday" becomes an actual date; the pivots then
//   aggregate the formula columns per calendar week (instructor/preceptor FTE),
//   per clinical setting (site asks), and per date (shifts to cover).

// ---------------------------------------------------------------------------
// Exact workbook column headers — word for word, typos and all.
// ---------------------------------------------------------------------------

export const CAPACITY_HEADERS = {
  A: "Term Number",
  B: "Semester",
  C: "Enrollment",
  D: "Course Code",
  E: "Course Title",
  F: "Session Type",
  G: "Session Number",
  H: "Session title (if used)",
  I: "Session Delivery Mode",
  J: "Session Location",
  K: "Session length (in hours)",
  L: "Max number of students that ONE session can accommodate",
  M: "Number of faculty required to teach full session",
  N: "Contact hour policy for faculty during session (___hrs per contact hour)",
  O: "Number of support staff required to teach full session",
  P: "Contact hour policy for support staff during session (___hrs per contact hour)",
  Q: "This session occurs during Week __ of term",
  R: "This session occurs on ____.",
  S: "Notes",
  T: "Number of preceptors required to teach full clinical session",
  U: "Contact hour policy for preceptors during session (___hrs per contact hour)",
  V: "Clinical Rotation Type",
  W: "Clinical Mode",
  X: "Total space hours to service hour requirements",
  Y: "Number of sections required to service hour requirements",
  Z: "Total number of faculty contact hours",
  AA: "Total number of faculty contact hours (semesterly)",
  AB: "Total number of faculty contact hours (weekly)",
  AC: "Total number of preceptor contact hours",
  AD: "Total number of preceptor contact hours (semesterly)",
  AE: "Total number of preceptor contact hours (weekly)",
} as const;

/** The formula behind each computed column, for hover/lineage UI. */
export const CAPACITY_FORMULAS: Record<string, string> = {
  A: "Set by the course sequence (the term this course is assigned to)",
  B: "Semester of the term in the cohort's calendar",
  C: "Enrollment for the session's term (per-term enrollment sheet)",
  X: "= K × Y",
  Y: "= ROUNDUP(C ÷ L, 0)",
  Z: "= K × M × Y",
  AA: "= Z ÷ $AM$2  (total semesterly faculty contact hours)",
  AB: "= Z ÷ $AI$2  (full-time faculty student contact hours)",
  AC: "= Y × T × K × U",
  AD: "= AC ÷ $AM$5  (total semesterly preceptor contact hours)",
  AE: "= AC ÷ $AN$5  (weekly preceptor contact hours)",
};

// ---------------------------------------------------------------------------
// Workload assumptions (cells AI/AJ/AL editable; AK/AM/AN derived).
// ---------------------------------------------------------------------------

export interface WorkloadAssumptions {
  /** AI2 — Full time faculty student contact hours. */
  facContactHours: number;
  /** AJ2 — Number of hours in work week (faculty). */
  facWorkWeekHours: number;
  /** AL2 — Number of weeks in Term (faculty). */
  facTermWeeks: number;
  /** AI5 — Full time preceptor contact hours. */
  preContactHours: number;
  /** AJ5 — Number of hours in work week (preceptor). */
  preWorkWeekHours: number;
  /** AL5 — Number of weeks in Term (preceptor). */
  preTermWeeks: number;
}

/** The workbook's default assumption values. */
export const DEFAULT_ASSUMPTIONS: WorkloadAssumptions = {
  facContactHours: 16, facWorkWeekHours: 40, facTermWeeks: 18,
  preContactHours: 40, preWorkWeekHours: 40, preTermWeeks: 18,
};

export interface DerivedAssumptions {
  /** AK2 = AJ2 ÷ AI2 — Full Time Faculty Contact Hour Conversion. */
  facConversion: number;
  /** AM2 = AL2 × AI2 — Total Semesterly Faculty Contact Hours. */
  facSemesterHours: number;
  /** AN2 = AI2 — Weekly Faculty Contact Hours. */
  facWeeklyHours: number;
  /** AK5 = AJ5 ÷ AI5 — Full Time Preceptor Contact Hour Conversion. */
  preConversion: number;
  /** AM5 = AL5 × AI5 — Total Semesterly Preceptor Contact Hours. */
  preSemesterHours: number;
  /** AN5 = AI5 — Weekly Preceptor Contact Hours. */
  preWeeklyHours: number;
}

export function deriveAssumptions(a: WorkloadAssumptions): DerivedAssumptions {
  return {
    facConversion: a.facContactHours > 0 ? a.facWorkWeekHours / a.facContactHours : 0,
    facSemesterHours: a.facTermWeeks * a.facContactHours,
    facWeeklyHours: a.facContactHours,
    preConversion: a.preContactHours > 0 ? a.preWorkWeekHours / a.preContactHours : 0,
    preSemesterHours: a.preTermWeeks * a.preContactHours,
    preWeeklyHours: a.preContactHours,
  };
}

// ---------------------------------------------------------------------------
// The session row (input columns) and its computed columns.
// ---------------------------------------------------------------------------

export interface SessionInput {
  id: string;
  /** F — Session Type (Class | Lab | Clinical). */
  kind: "CLASS" | "LAB" | "CLINICAL";
  /** G — Session Number. */
  number: number;
  /** H — Session title (if used). */
  title: string | null;
  /** I — Session Delivery Mode. */
  deliveryMode: string | null;
  /** J — Session Location. */
  location: string | null;
  /** K — Session length (in hours). */
  lengthHours: number;
  /** L — Max number of students that ONE session can accommodate. */
  maxStudents: number;
  /** M — Number of faculty required to teach full session. */
  facultyNeeded: number;
  /** N — Contact hour policy for faculty during session. */
  facultyContactPolicy: number | null;
  /** O — Number of support staff required to teach full session. */
  supportStaffNeeded: number;
  /** P — Contact hour policy for support staff during session. */
  supportContactPolicy: number | null;
  /** Q — This session occurs during Week __ of term. */
  week: number | null;
  /** R — This session occurs on ____. */
  dayOfWeek: string | null;
  /** Booked start time for this session's meeting, when calendarized (HH:MM). */
  startTime?: string | null;
  /** Booked instructor / preceptor name, when assigned. */
  staffName?: string | null;
  /** S — Notes. */
  notes: string | null;
  /** T — Number of preceptors required to teach full clinical session. */
  preceptorsNeeded: number;
  /** U — Contact hour policy for preceptors during session. */
  preceptorContactPolicy: number | null;
  /** V — Clinical Rotation Type. */
  rotationType: string | null;
  /** W — Clinical Mode. */
  clinicalMode: string | null;
}

export interface ComputedColumns {
  /** C — Enrollment feeding this row. */
  C: number;
  /** Y = ROUNDUP(C ÷ L, 0); null when L = 0 (the workbook's #DIV/0!). */
  Y: number | null;
  /** X = K × Y. */
  X: number | null;
  /** Z = K × M × Y. */
  Z: number | null;
  /** AA = Z ÷ AM2. */
  AA: number | null;
  /** AB = Z ÷ AI2. */
  AB: number | null;
  /** AC = Y × T × K × U. */
  AC: number | null;
  /** AD = AC ÷ AM5. */
  AD: number | null;
  /** AE = AC ÷ AN5. */
  AE: number | null;
  /** True when L = 0 made Y a #DIV/0!. */
  divByZero: boolean;
}

const nz = (v: number | null | undefined) => (v == null ? 0 : v); // Excel: blank in arithmetic = 0

/** Compute the formula columns for one session row at a given enrollment — the exact workbook chain. */
export function computeColumns(s: SessionInput, enrollment: number, a: WorkloadAssumptions = DEFAULT_ASSUMPTIONS): ComputedColumns {
  const d = deriveAssumptions(a);
  const L = nz(s.maxStudents);
  if (L === 0) {
    return { C: enrollment, Y: null, X: null, Z: null, AA: null, AB: null, AC: null, AD: null, AE: null, divByZero: true };
  }
  const Y = Math.ceil(enrollment / L);                       // =ROUNDUP(C/L,0)
  const X = nz(s.lengthHours) * Y;                           // =K*Y
  const Z = nz(s.lengthHours) * nz(s.facultyNeeded) * Y;     // =K*M*Y
  const AA = d.facSemesterHours > 0 ? Z / d.facSemesterHours : null;   // =Z/$AM$2
  const AB = a.facContactHours > 0 ? Z / a.facContactHours : null;     // =Z/$AI$2
  const AC = Y * nz(s.preceptorsNeeded) * nz(s.lengthHours) * nz(s.preceptorContactPolicy); // =Y*T*K*U
  const AD = d.preSemesterHours > 0 ? AC / d.preSemesterHours : null;  // =AC/$AM$5
  const AE = d.preWeeklyHours > 0 ? AC / d.preWeeklyHours : null;      // =AC/$AN$5
  return { C: enrollment, Y, X, Z, AA, AB, AC, AD, AE, divByZero: false };
}

// ---------------------------------------------------------------------------
// Course + per-term rollups for the design surface.
// ---------------------------------------------------------------------------

export interface CourseRollup {
  sessions: number;
  spaceHours: number;        // Σ X
  sections: number;          // Σ Y
  facultyHours: number;      // Σ Z
  facultyWeekly: number;     // Σ AB
  preceptorHours: number;    // Σ AC
  preceptorWeekly: number;   // Σ AE
  divByZero: number;
}

export function rollupSessions(rows: { computed: ComputedColumns }[]): CourseRollup {
  const out: CourseRollup = { sessions: rows.length, spaceHours: 0, sections: 0, facultyHours: 0, facultyWeekly: 0, preceptorHours: 0, preceptorWeekly: 0, divByZero: 0 };
  for (const { computed: c } of rows) {
    if (c.divByZero) { out.divByZero++; continue; }
    out.spaceHours += nz(c.X); out.sections += nz(c.Y);
    out.facultyHours += nz(c.Z); out.facultyWeekly += nz(c.AB);
    out.preceptorHours += nz(c.AC); out.preceptorWeekly += nz(c.AE);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Calendar layer — dated instances per cohort (the pivots' data source).
// ---------------------------------------------------------------------------

export const CAPACITY_DAY_OFFSET: Record<string, number> = {
  Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
  Monday: 0, Tuesday: 1, Wednesday: 2, Thursday: 3, Friday: 4, Saturday: 5, Sunday: 6,
};

export interface DatedInstance {
  session: SessionInput;
  computed: ComputedColumns;
  cohortId: string;
  cohort: string;
  programId: string;
  program: string;
  courseCode: string | null;
  courseTitle: string;
  /** DB course id when known — joins a shift back to its per-section booking. */
  courseId: string | null;
  termIndex: number;      // 1-based
  termName: string;
  semester: string;       // Fall | Spring | Summer (best effort from the term start month)
  weekOfTerm: number;     // Q (defaulted to 1 when unset)
  /** Monday of the calendar week this session lands in; null when the term has no date. */
  monday: Date | null;
  mondayIso: string | null;
  /** The exact date (monday + day offset); null for async / unset-day sessions. */
  date: Date | null;
  dateIso: string | null;
  month: string | null;   // "YYYY-MM"
  /** Observed holiday this session lands on, if any — flag it, let people adjust. */
  holiday: string | null;
}

export interface CohortCalendarInput {
  cohortId: string;
  cohort: string;
  programId: string;
  program: string;
  /** Enrollment per term index (1-based); missing terms fall back to the last known value. */
  enrollmentByTerm: Record<number, number>;
  /** Real start date per term index (1-based); null terms produce undated instances. */
  termStartByIndex: Record<number, Date | null>;
  courses: {
    code: string | null;
    title: string;
    /** DB course id (optional) — lets calendar shifts join their bookings. */
    courseId?: string | null;
    termIndex: number;
    termName: string;
    /** Per-offering course window: when set, THIS anchors the course's session
     *  weeks instead of the term start (8-week course inside a 16-week term).
     *  Accepts a Date or ISO string (props cross the server/client boundary). */
    startDate?: Date | string | null;
    endDate?: Date | string | null;
    sessions: SessionInput[];
  }[];
}

/** U.S. observed holidays + common institutional breaks a session might land on
 *  (flagged, never silently moved — the configurer decides what shifts). */
export function usHoliday(d: Date): string | null {
  const m = d.getUTCMonth() + 1, day = d.getUTCDate(), wd = d.getUTCDay();
  if (m === 1 && day === 1) return "New Year's Day";
  if (m === 1 && wd === 1 && day >= 15 && day <= 21) return "MLK Day";
  if (m === 5 && wd === 1 && day >= 25) return "Memorial Day";
  if (m === 6 && day === 19) return "Juneteenth";
  if (m === 7 && day === 4) return "Independence Day";
  if (m === 9 && wd === 1 && day <= 7) return "Labor Day";
  if (m === 10 && wd === 1 && day >= 8 && day <= 14) return "Indigenous Peoples' / Columbus Day";
  if (m === 11 && day === 11) return "Veterans Day";
  if (m === 11 && (wd === 4 || wd === 5)) { const thu = wd === 4 ? day : day - 1; if (thu >= 22 && thu <= 28) return wd === 4 ? "Thanksgiving" : "Day after Thanksgiving"; }
  if (m === 12 && (day === 24 || day === 25)) return day === 25 ? "Christmas Day" : "Christmas Eve";
  if (m === 12 && day >= 26) return "Winter break";
  return null;
}

const seasonOfMonth = (m: number) => (m >= 1 && m <= 5 ? "Spring" : m <= 7 ? "Summer" : "Fall");
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const isoOf = (d: Date) => d.toISOString().slice(0, 10);
const mondayOfWeek = (termStart: Date, week: number) => addDays(termStart, (week - 1) * 7);

/** Expand one cohort's template into dated session instances with computed columns. */
export function buildInstances(input: CohortCalendarInput, a: WorkloadAssumptions = DEFAULT_ASSUMPTIONS): DatedInstance[] {
  const out: DatedInstance[] = [];
  let lastEnrollment = 0;
  const enrollFor = (ti: number) => {
    const e = input.enrollmentByTerm[ti];
    if (e != null) { lastEnrollment = e; return e; }
    return lastEnrollment;
  };
  const termIdxs = [...new Set(input.courses.map((c) => c.termIndex))].sort((x, y) => x - y);
  const enrollment: Record<number, number> = {};
  for (const ti of termIdxs) enrollment[ti] = enrollFor(ti);

  for (const c of input.courses) {
    const courseStart = c.startDate ? (c.startDate instanceof Date ? c.startDate : new Date(c.startDate)) : null;
    const start = courseStart ?? input.termStartByIndex[c.termIndex] ?? null;
    const semester = start ? seasonOfMonth(start.getUTCMonth() + 1) : "—";
    for (const s of c.sessions) {
      const computed = computeColumns(s, enrollment[c.termIndex] ?? 0, a);
      const week = s.week && s.week > 0 ? s.week : 1;
      const monday = start ? mondayOfWeek(start, week) : null;
      const off = s.dayOfWeek != null ? CAPACITY_DAY_OFFSET[s.dayOfWeek] : undefined;
      const date = monday != null && off != null ? addDays(monday, off) : null;
      out.push({
        session: s, computed,
        cohortId: input.cohortId, cohort: input.cohort, programId: input.programId, program: input.program,
        courseCode: c.code, courseTitle: c.title, courseId: c.courseId ?? null, termIndex: c.termIndex, termName: c.termName, semester,
        weekOfTerm: week,
        monday, mondayIso: monday ? isoOf(monday) : null,
        date, dateIso: date ? isoOf(date) : null,
        month: monday ? isoOf(monday).slice(0, 7) : null,
        holiday: date ? usHoliday(date) : null,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pivots over dated instances (FTEs per Week · FTEs per Setting · # of Shifts).
// ---------------------------------------------------------------------------

export type CapacityMeasure = "facWeekly" | "preWeekly" | "sections" | "space" | "facTotal" | "preTotal" | "students";

/** Exact pivot value-field labels from the workbook (plus the student-days measure the site sheets use). */
export const CAPACITY_MEASURES: Record<CapacityMeasure, { label: string; of: (i: DatedInstance) => number }> = {
  facWeekly: { label: "Sum of Total number of faculty contact hours (weekly)", of: (i) => nz(i.computed.AB) },
  preWeekly: { label: "Sum of Total number of preceptor contact hours (weekly)", of: (i) => nz(i.computed.AE) },
  sections: { label: "Sum of Number of sections required to service hour requirements", of: (i) => nz(i.computed.Y) },
  space: { label: "Sum of Total space hours to service hour requirements", of: (i) => nz(i.computed.X) },
  facTotal: { label: "Sum of Total number of faculty contact hours", of: (i) => nz(i.computed.Z) },
  preTotal: { label: "Sum of Total number of preceptor contact hours", of: (i) => nz(i.computed.AC) },
  students: { label: "Students on site (enrollment)", of: (i) => i.computed.C },
};

export function sumBy<K>(rows: DatedInstance[], keyFn: (i: DatedInstance) => K | null, measure: CapacityMeasure): Map<K, number> {
  const M = CAPACITY_MEASURES[measure];
  const m = new Map<K, number>();
  for (const r of rows) {
    const k = keyFn(r);
    if (k == null) continue;
    m.set(k, (m.get(k) ?? 0) + M.of(r));
  }
  return m;
}

export function peakOf<K>(m: Map<K, number>): { key: K; value: number } | null {
  let best: { key: K; value: number } | null = null;
  for (const [key, value] of m) if (!best || value > best.value) best = { key, value };
  return best;
}

/** Weekly instructor + preceptor need — the "FTEs per Week" view. */
export interface WeeklyNeedRow {
  mondayIso: string;
  facultyFte: number;    // Σ AB ÷ AI2… careful: AB is already hours ÷ AI2 = FTE-weeks
  preceptorFte: number;  // Σ AE (already FTE at the preceptor weekly hours)
  facultyHeads: number;  // ceil of FTE — whole people to schedule
  preceptorHeads: number;
  sections: number;
}

export function weeklyNeed(rows: DatedInstance[]): WeeklyNeedRow[] {
  const fac = sumBy(rows, (i) => i.mondayIso, "facWeekly");
  const pre = sumBy(rows, (i) => i.mondayIso, "preWeekly");
  const sec = sumBy(rows, (i) => i.mondayIso, "sections");
  const keys = [...new Set([...fac.keys(), ...pre.keys()])].filter((k): k is string => k != null).sort();
  return keys.map((k) => {
    const f = fac.get(k) ?? 0, p = pre.get(k) ?? 0;
    return { mondayIso: k, facultyFte: f, preceptorFte: p, facultyHeads: Math.ceil(f - 1e-9), preceptorHeads: Math.ceil(p - 1e-9), sections: sec.get(k) ?? 0 };
  });
}

/** Per-setting site request rollup — the "FTEs per Setting" view. */
export interface SettingAsk {
  setting: string;              // Clinical Rotation Type (V)
  studentPeakDay: number;       // max students on site on any one date
  sectionsTotal: number;        // Σ Y across the slice
  preceptorHours: number;       // Σ AC
  preceptorPeakWeekFte: number; // peak week Σ AE
  weeks: number;                // distinct calendar weeks with demand
  firstIso: string | null;
  lastIso: string | null;
  days: string[];               // distinct weekdays used
}

export function settingAsks(rows: DatedInstance[]): SettingAsk[] {
  const clinical = rows.filter((r) => r.session.kind === "CLINICAL");
  const settings = [...new Set(clinical.map((r) => r.session.rotationType ?? "(unspecified)"))].sort();
  return settings.map((setting) => {
    const rs = clinical.filter((r) => (r.session.rotationType ?? "(unspecified)") === setting);
    const byDate = new Map<string, number>();
    for (const r of rs) if (r.dateIso) byDate.set(r.dateIso, (byDate.get(r.dateIso) ?? 0) + Math.min(r.computed.C, nz(r.computed.Y) * nz(r.session.maxStudents)));
    const weeks = [...new Set(rs.map((r) => r.mondayIso).filter(Boolean))].sort() as string[];
    const preWeek = sumBy(rs, (i) => i.mondayIso, "preWeekly");
    const peak = peakOf(preWeek);
    return {
      setting,
      studentPeakDay: Math.max(0, ...byDate.values()),
      sectionsTotal: rs.reduce((s, r) => s + nz(r.computed.Y), 0),
      preceptorHours: rs.reduce((s, r) => s + nz(r.computed.AC), 0),
      preceptorPeakWeekFte: peak?.value ?? 0,
      weeks: weeks.length,
      firstIso: weeks[0] ?? null,
      lastIso: weeks[weeks.length - 1] ?? null,
      days: [...new Set(rs.map((r) => r.session.dayOfWeek).filter((d): d is string => !!d))],
    };
  });
}

/** Shift coverage per date — the "# of Shifts" board. One shift = one section meeting. */
export interface ShiftDay {
  dateIso: string;
  shifts: number;               // Σ Y that date
  studentsOnSite: number;       // Σ min(C, Y×L) that date — people, not shifts
  preceptorsOnSite: number;     // Σ Y × T
  holiday: string | null;
  details: {
    cohort: string; program: string;
    courseCode: string | null; courseTitle: string;
    sessionTitle: string | null; kind: string;
    students: number; sections: number; lengthHours: number;
    setting: string | null; startTime: string | null;
  }[];
}

export function shiftBoard(rows: DatedInstance[]): ShiftDay[] {
  const dated = rows.filter((r) => r.dateIso);
  const byDate = new Map<string, DatedInstance[]>();
  for (const r of dated) {
    const list = byDate.get(r.dateIso!) ?? [];
    list.push(r);
    byDate.set(r.dateIso!, list);
  }
  return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([dateIso, rs]) => ({
    dateIso,
    shifts: rs.reduce((s, r) => s + nz(r.computed.Y), 0),
    studentsOnSite: rs.reduce((s, r) => s + Math.min(r.computed.C, nz(r.computed.Y) * nz(r.session.maxStudents)), 0),
    preceptorsOnSite: rs.reduce((s, r) => s + nz(r.computed.Y) * nz(r.session.preceptorsNeeded), 0),
    holiday: rs[0]?.holiday ?? null,
    details: rs.map((r) => ({
      cohort: r.cohort, program: r.program,
      courseCode: r.courseCode, courseTitle: r.courseTitle,
      sessionTitle: r.session.title, kind: r.session.kind,
      students: Math.min(r.computed.C, nz(r.computed.Y) * nz(r.session.maxStudents)),
      sections: nz(r.computed.Y), lengthHours: r.session.lengthHours,
      setting: r.session.rotationType, startTime: r.session.startTime ?? null,
    })),
  }));
}

/** The LAST day anything happens — final class, lab, clinical or exam. This is
 *  the offering's real expected end (a date, not a month). */
export function lastSessionDate(rows: DatedInstance[]): Date | null {
  let best: Date | null = null;
  for (const r of rows) {
    const d = r.date ?? (r.monday ? new Date(r.monday.getTime() + 4 * 86400000) : null);
    if (d && (!best || d.getTime() > best.getTime())) best = d;
  }
  return best;
}

/** Weekly staffing need broken out by session type — how many class, lab, and
 *  clinical faculty (and preceptors) are needed each calendar week. Faculty
 *  FTE per kind = Σ AB of that kind's rows in the week; preceptors = Σ AE. */
export interface WeeklyKindRow {
  mondayIso: string;
  classFte: number;
  labFte: number;
  clinicalFacFte: number;
  preceptorFte: number;
  totalFacFte: number;
  facultyHeads: number;
  preceptorHeads: number;
  sections: number;
}

export function weeklyNeedByKind(rows: DatedInstance[]): WeeklyKindRow[] {
  const byWeek = new Map<string, { c: number; l: number; cf: number; p: number; s: number }>();
  for (const r of rows) {
    if (!r.mondayIso) continue;
    const w = byWeek.get(r.mondayIso) ?? { c: 0, l: 0, cf: 0, p: 0, s: 0 };
    const ab = nz(r.computed.AB);
    if (r.session.kind === "CLASS") w.c += ab;
    else if (r.session.kind === "LAB") w.l += ab;
    else w.cf += ab;
    w.p += nz(r.computed.AE);
    w.s += nz(r.computed.Y);
    byWeek.set(r.mondayIso, w);
  }
  return [...byWeek.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([mondayIso, w]) => {
    const total = w.c + w.l + w.cf;
    return {
      mondayIso, classFte: w.c, labFte: w.l, clinicalFacFte: w.cf, preceptorFte: w.p,
      totalFacFte: total, facultyHeads: Math.ceil(total - 1e-9), preceptorHeads: Math.ceil(w.p - 1e-9),
      sections: w.s,
    };
  });
}
