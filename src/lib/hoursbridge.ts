// Clinical hours, two ways. A program's clinical hours per student come from its clinical session
// rows; the requirement roll-up and the by-setting grid read a second figure, the hours each
// course codes against a setting (CourseClinicalRequirement). When the two disagree the
// difference is hours no setting claims (or hours coded beyond the sessions) — shown, never hidden.

export interface BridgeCourseIn { course: string; sessionHours: number; codedHours: number }
export interface BridgeCourse extends BridgeCourseIn { /** sessionHours − codedHours: positive = hours not assigned to any setting. */ gap: number }
export interface BridgeProgram { programId: string; program: string; sessionHours: number; codedHours: number; /** Courses whose two figures differ. */ unmapped: BridgeCourse[] }

const EPS = 0.01;

/** One program's bridge from its courses' two hour figures. Courses with no clinical hours either way are ignored. */
export function programHoursBridge(programId: string, program: string, courses: BridgeCourseIn[]): BridgeProgram {
  const live = courses.filter((c) => c.sessionHours > 0 || c.codedHours > 0);
  return {
    programId, program,
    sessionHours: live.reduce((n, c) => n + c.sessionHours, 0),
    codedHours: live.reduce((n, c) => n + c.codedHours, 0),
    unmapped: live.filter((c) => Math.abs(c.sessionHours - c.codedHours) > EPS).map((c) => ({ ...c, gap: c.sessionHours - c.codedHours })),
  };
}
