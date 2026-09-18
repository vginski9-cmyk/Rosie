// Goal timing (Phase 6 of docs/metrics-audit.md): a North-Star goal is "fully productive workers
// in year Y". Working backward from the end of that year through ramp-to-productive, placement,
// licensure and the program's length gives the date a cohort must START to deliver it — and the
// earliest year any cohort starting today could deliver. A goal set for a year before that is not
// a plan; it is a wish, and the planner says so.
//
// The lags are DEFAULT ASSUMPTIONS, not measured: they come from the workbook's ladder stages
// (complete → licensed → placed → productive) with typical NC allied-health timing. They are
// named on screen wherever they are used.

export interface TimingAssumptions {
  /** Months from completion to a first-time licensure pass (exam scheduling and results). */
  licensureMonths: number;
  /** Months from licensure to a regional job. */
  placementMonths: number;
  /** Months from hire to full productivity (orientation and ramp). */
  rampMonths: number;
  /** Weeks of break between terms (the program's instructional weeks do not include them). */
  breakWeeksBetweenTerms: number;
}
export const DEFAULT_TIMING: TimingAssumptions = { licensureMonths: 3, placementMonths: 3, rampMonths: 6, breakWeeksBetweenTerms: 2 };
export const TIMING_SOURCE = "default assumptions — licensure 3 months after completion, placement 3 months after licensure, 6 months to full productivity, 2-week breaks between terms";

export interface ProgramLength { spanWeeks: number; terms: number }

const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dateOf = (s: string) => new Date(s + "T00:00:00Z");
/** Whole months back (or forward when negative), clamped to the month's last day — Dec 31 less six months is Jun 30, not Jul 1. */
const minusMonths = (s: string, months: number) => {
  const d = dateOf(s); const day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return iso(d);
};
const plusMonths = (s: string, months: number) => minusMonths(s, -months);
/** Calendar weeks a program occupies: instructional weeks plus the breaks between its terms. */
export const programWeeks = (m: ProgramLength, t: TimingAssumptions = DEFAULT_TIMING) => Math.max(1, m.spanWeeks) + Math.max(0, m.terms - 1) * t.breakWeeksBetweenTerms;

export interface GoalTiming {
  targetYear: number;
  /** The goal counts workers productive by this date (the end of the target year). */
  productiveBy: string;
  placedBy: string;
  licensedBy: string;
  completeBy: string;
  /** The latest a cohort of this program may start and still deliver the goal. */
  startBy: string;
  programWeeks: number;
  /** startBy is on or after today — a cohort can still be started in time. */
  feasible: boolean;
  /** The earliest year a cohort starting today reaches full productivity. */
  earliestYear: number;
}

/** Work backward from the target year to the start a cohort needs, and say whether that start is still ahead of today. */
export function goalTiming(targetYear: number, m: ProgramLength, todayIso: string, t: TimingAssumptions = DEFAULT_TIMING): GoalTiming {
  const productiveBy = `${targetYear}-12-31`;
  const placedBy = minusMonths(productiveBy, t.rampMonths);
  const licensedBy = minusMonths(placedBy, t.placementMonths);
  const completeBy = minusMonths(licensedBy, t.licensureMonths);
  const weeks = programWeeks(m, t);
  const startBy = iso(new Date(dateOf(completeBy).getTime() - weeks * 7 * DAY));
  return { targetYear, productiveBy, placedBy, licensedBy, completeBy, startBy, programWeeks: weeks, feasible: startBy >= todayIso, earliestYear: earliestFeasibleYear(m, todayIso, t) };
}

/** The year a cohort starting today would reach full productivity. */
export function earliestFeasibleYear(m: ProgramLength, todayIso: string, t: TimingAssumptions = DEFAULT_TIMING): number {
  const complete = iso(new Date(dateOf(todayIso).getTime() + programWeeks(m, t) * 7 * DAY));
  const productive = plusMonths(plusMonths(plusMonths(complete, t.licensureMonths), t.placementMonths), t.rampMonths);
  return Number(productive.slice(0, 4));
}

/** A goal year that no program could deliver from a start today, and that no offering already delivers. */
export function infeasibleGoal(targetYear: number, goal: number, models: ProgramLength[], offeringsThatYear: number, todayIso: string, t: TimingAssumptions = DEFAULT_TIMING): { infeasible: boolean; earliestYear: number | null } {
  if (goal <= 0 || offeringsThatYear > 0 || models.length === 0) return { infeasible: false, earliestYear: null };
  const earliest = Math.min(...models.map((m) => earliestFeasibleYear(m, todayIso, t)));
  return { infeasible: targetYear < earliest, earliestYear: earliest };
}
