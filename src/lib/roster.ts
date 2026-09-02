// Booked sections as roster rows — who teaches / precepts what. Plain data
// helpers (no React) so server pages and client components share them.

import type { CapacityCohort } from "@/components/CapacityBoard";

export interface RosterMeeting {
  id: string; cohort: string; program: string; courseCode: string | null; courseTitle: string;
  kind: string; sectionIndex: number; sectionCount: number; dayOfWeek: string; startTime: string; lengthHours: number;
  termIndex: number; staffPersonId: string | null; staffName: string | null; loc: string | null;
}
export interface RosterPerson { id: string; name: string; role: string }

/** Every booked section of these cohorts, as roster rows. */
export function rosterFromCohorts(cohorts: CapacityCohort[]): RosterMeeting[] {
  const out: RosterMeeting[] = [];
  for (const c of cohorts) {
    const courseById = new Map(c.courses.filter((x) => x.courseId).map((x) => [x.courseId!, x]));
    for (const m of c.meetings ?? []) {
      const course = courseById.get(m.courseId);
      out.push({
        id: m.id, cohort: c.cohort, program: c.program, courseCode: course?.code ?? null, courseTitle: course?.title ?? "course",
        kind: m.kind, sectionIndex: m.sectionIndex, sectionCount: m.sectionCount, dayOfWeek: m.dayOfWeek, startTime: m.startTime, lengthHours: m.lengthHours ?? 1,
        termIndex: m.termIndex ?? 1, staffPersonId: m.staffPersonId, staffName: m.staffName, loc: m.loc,
      });
    }
  }
  return out.sort((a, b) => a.termIndex - b.termIndex || a.courseTitle.localeCompare(b.courseTitle) || a.kind.localeCompare(b.kind) || a.sectionIndex - b.sectionIndex);
}
