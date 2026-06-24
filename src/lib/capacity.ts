// Capacity engine.
//
// The planning template captures ONE student's required experience: for each
// course, the sessions (class/lab/clinical) that student must attend, and what
// each session looks like when delivered (length, capacity per instance, faculty
// / support / preceptors needed). This engine takes that archetype plus an
// enrollment number and computes the ACTUAL delivery footprint: how many
// sections, clinical/WBL slots, instructor-hours, FTEs, and room-hours are
// required. No manual scaling — exactly what the instructions promise the model
// will do for the user.

export type SessionKind = "CLASS" | "LAB" | "CLINICAL";

export interface SessionArchetype {
  id: string;
  kind: SessionKind;
  lengthHours: number;
  /** Capacity of ONE delivered instance/section of this session. */
  maxStudents: number;
  facultyNeeded: number;
  supportStaffNeeded: number;
  preceptorsNeeded: number;
  week?: number | null;
}

export interface CourseArchetype {
  id: string;
  code?: string | null;
  name: string;
  sequenceOrder: number;
  sessions: SessionArchetype[];
}

export interface TermArchetype {
  id: string;
  index: number;
  name: string;
  startWeek?: number | null;
  endWeek?: number | null;
  courses: CourseArchetype[];
}

export interface CapacityConfig {
  /**
   * Faculty load standard: weekly contact hours that equal 1.0 instructional
   * FTE. Community-college norms run ~12–21; default 15. Used to convert
   * instructor contact hours into FTE headcount.
   */
  fteWeeklyContactHours: number;
  /** Fallback instructional weeks when a term has no start/end week set. */
  defaultTermWeeks: number;
}

export const DEFAULT_CONFIG: CapacityConfig = {
  fteWeeklyContactHours: 15,
  defaultTermWeeks: 16,
};

export interface SessionDemand {
  sessionId: string;
  kind: SessionKind;
  /** ceil(enrollment / capacity-per-instance). */
  sections: number;
  facultyInstances: number;
  supportInstances: number;
  preceptorInstances: number;
  /** sections × facultyNeeded × lengthHours over the term. */
  facultyContactHours: number;
  /** enrollment × lengthHours (student seat-time). */
  studentContactHours: number;
  /** sections × lengthHours (room / site occupancy). */
  roomHours: number;
  /** Clinical sections == WBL placement slots/groups needed. */
  wblSlots: number;
}

export interface DemandTotals {
  sections: number;
  classSections: number;
  labSections: number;
  clinicalSections: number;
  /** Clinical/work-based-learning placement slots (== clinicalSections). */
  wblSlots: number;
  facultyContactHours: number;
  studentContactHours: number;
  roomHours: number;
  classRoomHours: number;
  labRoomHours: number;
  clinicalRoomHours: number;
  preceptorInstances: number;
  supportInstances: number;
  /** facultyContactHours / weeks / fteWeeklyContactHours. */
  facultyFTE: number;
}

const EMPTY_TOTALS: DemandTotals = {
  sections: 0,
  classSections: 0,
  labSections: 0,
  clinicalSections: 0,
  wblSlots: 0,
  facultyContactHours: 0,
  studentContactHours: 0,
  roomHours: 0,
  classRoomHours: 0,
  labRoomHours: 0,
  clinicalRoomHours: 0,
  preceptorInstances: 0,
  supportInstances: 0,
  facultyFTE: 0,
};

/** Demand created by one session archetype delivered to `enrollment` students. */
export function sessionDemand(s: SessionArchetype, enrollment: number): SessionDemand {
  const capacity = Math.max(1, s.maxStudents || 1);
  const sections = enrollment <= 0 ? 0 : Math.max(1, Math.ceil(enrollment / capacity));
  const facultyInstances = sections * s.facultyNeeded;
  const supportInstances = sections * s.supportStaffNeeded;
  const preceptorInstances = sections * s.preceptorsNeeded;
  return {
    sessionId: s.id,
    kind: s.kind,
    sections,
    facultyInstances,
    supportInstances,
    preceptorInstances,
    facultyContactHours: facultyInstances * s.lengthHours,
    studentContactHours: enrollment * s.lengthHours,
    roomHours: sections * s.lengthHours,
    wblSlots: s.kind === "CLINICAL" ? sections : 0,
  };
}

function termWeeks(term: TermArchetype, cfg: CapacityConfig): number {
  if (term.startWeek != null && term.endWeek != null && term.endWeek >= term.startWeek) {
    return term.endWeek - term.startWeek + 1;
  }
  return cfg.defaultTermWeeks;
}

function addInto(acc: DemandTotals, d: SessionDemand, isClass: boolean, isLab: boolean, isClinical: boolean) {
  acc.sections += d.sections;
  if (isClass) {
    acc.classSections += d.sections;
    acc.classRoomHours += d.roomHours;
  }
  if (isLab) {
    acc.labSections += d.sections;
    acc.labRoomHours += d.roomHours;
  }
  if (isClinical) {
    acc.clinicalSections += d.sections;
    acc.clinicalRoomHours += d.roomHours;
    acc.wblSlots += d.wblSlots;
  }
  acc.facultyContactHours += d.facultyContactHours;
  acc.studentContactHours += d.studentContactHours;
  acc.roomHours += d.roomHours;
  acc.preceptorInstances += d.preceptorInstances;
  acc.supportInstances += d.supportInstances;
}

export interface CourseDemand {
  courseId: string;
  code?: string | null;
  name: string;
  totals: DemandTotals;
}

export interface TermDemand {
  termId: string;
  index: number;
  name: string;
  enrollment: number;
  weeks: number;
  courses: CourseDemand[];
  totals: DemandTotals;
}

/** Compute demand for one term given the students enrolled in it. */
export function termDemand(
  term: TermArchetype,
  enrollment: number,
  cfg: CapacityConfig = DEFAULT_CONFIG,
): TermDemand {
  const weeks = termWeeks(term, cfg);
  const termTotals: DemandTotals = { ...EMPTY_TOTALS };
  const courses: CourseDemand[] = [];

  for (const course of [...term.courses].sort((a, b) => a.sequenceOrder - b.sequenceOrder)) {
    const cTotals: DemandTotals = { ...EMPTY_TOTALS };
    for (const s of course.sessions) {
      const d = sessionDemand(s, enrollment);
      const isClass = s.kind === "CLASS";
      const isLab = s.kind === "LAB";
      const isClinical = s.kind === "CLINICAL";
      addInto(cTotals, d, isClass, isLab, isClinical);
      addInto(termTotals, d, isClass, isLab, isClinical);
    }
    cTotals.facultyFTE = facultyFte(cTotals.facultyContactHours, weeks, cfg);
    courses.push({ courseId: course.id, code: course.code, name: course.name, totals: cTotals });
  }

  termTotals.facultyFTE = facultyFte(termTotals.facultyContactHours, weeks, cfg);
  return { termId: term.id, index: term.index, name: term.name, enrollment, weeks, courses, totals: termTotals };
}

function facultyFte(contactHours: number, weeks: number, cfg: CapacityConfig): number {
  if (weeks <= 0 || cfg.fteWeeklyContactHours <= 0) return 0;
  return contactHours / weeks / cfg.fteWeeklyContactHours;
}

export interface ProgramDemand {
  terms: TermDemand[];
  totals: DemandTotals;
}

/**
 * Compute demand for a whole program. `enrollmentByTermIndex` lets you model
 * attrition — Term 1 carries more students than Term 5. Missing entries fall
 * back to `defaultEnrollment`.
 */
export function programDemand(
  terms: TermArchetype[],
  enrollmentByTermIndex: Record<number, number>,
  defaultEnrollment = 0,
  cfg: CapacityConfig = DEFAULT_CONFIG,
): ProgramDemand {
  const termDemands = [...terms]
    .sort((a, b) => a.index - b.index)
    .map((t) => termDemand(t, enrollmentByTermIndex[t.index] ?? defaultEnrollment, cfg));

  const totals: DemandTotals = { ...EMPTY_TOTALS };
  for (const td of termDemands) {
    for (const k of Object.keys(totals) as (keyof DemandTotals)[]) {
      if (k === "facultyFTE") continue;
      totals[k] += td.totals[k];
    }
  }
  // Program FTE = average concurrent FTE across terms (terms run in parallel
  // across cohorts, so we sum per-term FTE rather than collapsing contact hours).
  totals.facultyFTE = termDemands.reduce((sum, td) => sum + td.totals.facultyFTE, 0);
  return { terms: termDemands, totals };
}
