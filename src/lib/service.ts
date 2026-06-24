// Service & FTE engine — the exact "Database for FTEs_Clinicals" formula chain.
//
// This is the model the user's workbook runs: cohort ENROLLMENT drives, for every
// session, the number of sections needed, the space/service hours, and the
// faculty + preceptor contact hours (with weekly and per-semester-FTE views). The
// formulas reference one another exactly as in the sheet:
//
//   sections          = ROUNDUP(enrollment / maxStudentsPerSession)
//   space hours       = sections × sessionLength
//   faculty hours     = sections × facultyPerSession × sessionLength
//     faculty weekly  = faculty hours / termWeeks            (sheet: /18)
//     faculty FTE     = faculty hours / facultyFteSemHours   (sheet: /288 = 16×18)
//   preceptor hours   = sections × preceptorsPerSession × sessionLength
//     preceptor weekly= preceptor hours / preceptorWeeklyHrs (sheet: /40)
//     preceptor FTE   = preceptor hours / preceptorFteSemHrs (sheet: /640 = 40×16)
//
// Pure + fully tested against the real sheet values.

export interface ServiceConstants {
  /** Instructional weeks in a term (sheet divisor for faculty "weekly"). */
  termWeeks: number;
  /** Faculty contact hours that equal 1.0 FTE for a semester (sheet: 288 = 16×18). */
  facultyFteSemesterHours: number;
  /** Preceptor hours per week used for the weekly view (sheet: 40). */
  preceptorWeeklyHours: number;
  /** Preceptor contact hours that equal 1.0 FTE for a semester (sheet: 640 = 40×16). */
  preceptorFteSemesterHours: number;
}

export const DEFAULT_SERVICE: ServiceConstants = {
  termWeeks: 18,
  facultyFteSemesterHours: 288,
  preceptorWeeklyHours: 40,
  preceptorFteSemesterHours: 640,
};

export interface ServiceSession {
  id: string;
  kind: "CLASS" | "LAB" | "CLINICAL";
  title?: string | null;
  lengthHours: number;
  /** Capacity of ONE delivered section of this session. */
  maxStudents: number;
  /** Faculty required to teach one full section (can be fractional, e.g. 0.1/3). */
  facultyNeeded: number;
  /** Preceptors required for one full clinical section. */
  preceptorsNeeded: number;
  week?: number | null;
  dayOfWeek?: string | null;
  location?: string | null;
  rotationType?: string | null;
  clinicalMode?: string | null;
}

export interface SessionService {
  sections: number;
  spaceHours: number;
  facultyContactHours: number;
  facultyWeeklyHours: number;
  facultyFte: number;
  preceptorContactHours: number;
  preceptorWeeklyFte: number;
  preceptorFte: number;
}

/** Excel ROUNDUP(x, 0): round away from zero to the next integer (with an epsilon
 *  so values already integral aren't bumped by float error). */
export function roundUpInt(x: number): number {
  return Math.ceil(x - 1e-9);
}

/** Compute the service requirements a single session creates at `enrollment`. */
export function sessionService(s: ServiceSession, enrollment: number, k: ServiceConstants = DEFAULT_SERVICE): SessionService {
  const sections = s.maxStudents > 0 && enrollment > 0 ? roundUpInt(enrollment / s.maxStudents) : 0;
  const spaceHours = sections * s.lengthHours;
  const facultyContactHours = sections * s.facultyNeeded * s.lengthHours;
  const preceptorContactHours = sections * s.preceptorsNeeded * s.lengthHours;
  return {
    sections,
    spaceHours,
    facultyContactHours,
    facultyWeeklyHours: facultyContactHours / k.termWeeks,
    facultyFte: facultyContactHours / k.facultyFteSemesterHours,
    preceptorContactHours,
    preceptorWeeklyFte: preceptorContactHours / k.preceptorWeeklyHours,
    preceptorFte: preceptorContactHours / k.preceptorFteSemesterHours,
  };
}

export interface ServiceTotals extends SessionService {
  /** Section-count split by session kind. */
  classSections: number;
  labSections: number;
  clinicalSections: number;
}

const ZERO: ServiceTotals = {
  sections: 0, spaceHours: 0, facultyContactHours: 0, facultyWeeklyHours: 0, facultyFte: 0,
  preceptorContactHours: 0, preceptorWeeklyFte: 0, preceptorFte: 0,
  classSections: 0, labSections: 0, clinicalSections: 0,
};

export interface CourseService {
  perSession: (SessionService & { session: ServiceSession })[];
  totals: ServiceTotals;
}

/** Roll a course's sessions up into per-session detail + course totals. */
export function courseService(sessions: ServiceSession[], enrollment: number, k: ServiceConstants = DEFAULT_SERVICE): CourseService {
  const perSession = sessions.map((s) => ({ session: s, ...sessionService(s, enrollment, k) }));
  const totals: ServiceTotals = { ...ZERO };
  for (const p of perSession) {
    totals.sections += p.sections;
    totals.spaceHours += p.spaceHours;
    totals.facultyContactHours += p.facultyContactHours;
    totals.facultyWeeklyHours += p.facultyWeeklyHours;
    totals.facultyFte += p.facultyFte;
    totals.preceptorContactHours += p.preceptorContactHours;
    totals.preceptorWeeklyFte += p.preceptorWeeklyFte;
    totals.preceptorFte += p.preceptorFte;
    if (p.session.kind === "CLASS") totals.classSections += p.sections;
    else if (p.session.kind === "LAB") totals.labSections += p.sections;
    else if (p.session.kind === "CLINICAL") totals.clinicalSections += p.sections;
  }
  return { perSession, totals };
}
