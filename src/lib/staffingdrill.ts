// WHO FILLS A STAFFING BAR. A bar on the instructors-and-preceptors page is a set of dated session
// instances and the FTE they demand (faculty: Σ AB weekly or Σ AA semesterly; preceptors: Σ AE or
// Σ AD). The people behind it are the staff assignments on those same sessions on those same dates,
// each converted to FTE with the same divisor that produced the bar (the cohort's full-time contact
// hours a week, × weeks in a term for a semester bar). What is left is unfilled. Pure.

import type { DatedInstance, WorkloadAssumptions } from "./capacitymodel";

export interface DrillAssignment {
  personId: string; personName: string; role: string; employerName?: string | null; employmentType?: string | null;
  contactHours: number; sessionId: string; sectionIndex: number; dateIso: string | null; cohortId: string; cohortName?: string; courseCode: string | null; kind: string;
}
export type DrillScale = "weekly" | "semesterly";
export interface DrillPerson {
  personId: string; name: string; role: string; side: "faculty" | "preceptor"; employer: string | null; employmentType: string | null;
  contactHours: number; fte: number; shifts: number; courses: string[]; cohorts: string[]; days: string[];
}
export interface DrillResult {
  scale: DrillScale;
  need: { faculty: number; preceptor: number; facultyHeads: number; preceptorHeads: number; instances: number; shifts: number };
  assigned: { faculty: number; preceptor: number; facultyPeople: number; preceptorPeople: number; contactHours: number };
  unfilled: { faculty: number; preceptor: number };
  people: DrillPerson[];
  /** Sessions in the bar with no one assigned at all (course · session · date). */
  uncovered: { courseCode: string | null; title: string | null; kind: string; dateIso: string | null; sections: number; cohort: string }[];
}

export const mondayOf = (iso: string) => { const d = new Date(iso + "T00:00:00Z"); const back = (d.getUTCDay() + 6) % 7; return new Date(d.getTime() - back * 86400000).toISOString().slice(0, 10); };
const nz = (v: number | null | undefined) => v ?? 0;
export const isPreceptorRole = (role: string) => role === "preceptor";

export function drillDown(instances: DatedInstance[], assignments: DrillAssignment[], assumptionsByCohort: Map<string, WorkloadAssumptions>, scale: DrillScale): DrillResult {
  // The bar's sessions, keyed cohort|session → the dates (or weeks) they land on.
  const keys = new Map<string, { dates: Set<string>; weeks: Set<string> }>();
  for (const i of instances) {
    const k = `${i.cohortId}|${i.session.id}`;
    const e = keys.get(k) ?? { dates: new Set(), weeks: new Set() };
    if (i.dateIso) e.dates.add(i.dateIso); else if (i.mondayIso) e.weeks.add(i.mondayIso);
    keys.set(k, e);
  }
  const need = { faculty: 0, preceptor: 0, facultyHeads: 0, preceptorHeads: 0, instances: instances.length, shifts: 0 };
  for (const i of instances) {
    need.faculty += scale === "weekly" ? nz(i.computed.AB) : nz(i.computed.AA);
    need.preceptor += scale === "weekly" ? nz(i.computed.AE) : nz(i.computed.AD);
    need.shifts += nz(i.computed.Y);
  }
  need.facultyHeads = Math.ceil(need.faculty - 1e-9); need.preceptorHeads = Math.ceil(need.preceptor - 1e-9);

  const matched = assignments.filter((a) => {
    const e = keys.get(`${a.cohortId}|${a.sessionId}`);
    if (!e || !a.dateIso) return false;
    return e.dates.has(a.dateIso) || e.weeks.has(mondayOf(a.dateIso));
  });
  const covered = new Set(matched.map((a) => `${a.cohortId}|${a.sessionId}|${a.dateIso}`));
  const byPerson = new Map<string, DrillPerson>();
  const assigned = { faculty: 0, preceptor: 0, facultyPeople: 0, preceptorPeople: 0, contactHours: 0 };
  for (const a of matched) {
    const asm = assumptionsByCohort.get(a.cohortId);
    const pre = isPreceptorRole(a.role);
    const weekly = pre ? asm?.preContactHours ?? 40 : asm?.facContactHours ?? 16;
    const divisor = scale === "weekly" ? weekly : weekly * (pre ? asm?.preTermWeeks ?? 16 : asm?.facTermWeeks ?? 16);
    const fte = divisor > 0 ? a.contactHours / divisor : 0;
    const p = byPerson.get(a.personId) ?? { personId: a.personId, name: a.personName, role: a.role, side: pre ? "preceptor" : "faculty", employer: a.employerName ?? null, employmentType: a.employmentType ?? null, contactHours: 0, fte: 0, shifts: 0, courses: [], cohorts: [], days: [] };
    p.contactHours += a.contactHours; p.fte += fte; p.shifts += 1;
    if (a.courseCode && !p.courses.includes(a.courseCode)) p.courses.push(a.courseCode);
    if (a.cohortName && !p.cohorts.includes(a.cohortName)) p.cohorts.push(a.cohortName);
    if (a.dateIso && !p.days.includes(a.dateIso)) p.days.push(a.dateIso);
    byPerson.set(a.personId, p);
    if (pre) assigned.preceptor += fte; else assigned.faculty += fte;
    assigned.contactHours += a.contactHours;
  }
  const people = [...byPerson.values()].sort((x, y) => y.fte - x.fte || x.name.localeCompare(y.name));
  assigned.facultyPeople = people.filter((p) => p.side === "faculty").length;
  assigned.preceptorPeople = people.filter((p) => p.side === "preceptor").length;
  const uncovered = instances
    .filter((i) => { const d = i.dateIso; if (d) return !covered.has(`${i.cohortId}|${i.session.id}|${d}`); return !matched.some((a) => a.cohortId === i.cohortId && a.sessionId === i.session.id); })
    .map((i) => ({ courseCode: i.courseCode, title: i.session.title, kind: i.session.kind, dateIso: i.dateIso, sections: nz(i.computed.Y), cohort: i.cohort }))
    .sort((a, b) => (a.dateIso ?? "").localeCompare(b.dateIso ?? "") || (a.courseCode ?? "").localeCompare(b.courseCode ?? ""));
  return {
    scale, need, assigned,
    unfilled: { faculty: Math.max(0, need.faculty - assigned.faculty), preceptor: Math.max(0, need.preceptor - assigned.preceptor) },
    people, uncovered,
  };
}
