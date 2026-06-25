// Multi-year workforce-goal trajectory + cohort constellation.
//
// A program family anchors its activity to a multi-year workforce goal: how many
// credentials the region needs (demand) and how many the family aims to produce
// (goal), tracked against what it actually produces year over year. Cohorts are
// the unit of production — a "constellation" of classes, often overlapping, each
// entering in one year and graduating a couple of years later.

export interface TrajectoryYearInput {
  year: number;
  /** Regional annual openings (labor-market demand) that year. */
  demand?: number | null;
  /** The family's credential goal for that year. */
  goal?: number | null;
  /** Credentials actually produced (cohorts graduating that year). */
  produced?: number | null;
}

export interface TrajectoryYear {
  year: number;
  demand: number | null;
  goal: number | null;
  produced: number | null;
  /** produced − goal (negative = behind the goal). */
  gapVsGoal: number | null;
  /** produced ÷ goal. */
  goalAttainment: number | null;
  /** produced ÷ demand — share of regional need met. */
  demandCoverage: number | null;
  cumulativeProduced: number;
  cumulativeGoal: number;
  /** produced ≥ goal (null when either is unknown). */
  onTrack: boolean | null;
}

/** Roll yearly demand/goal/produced into a trajectory with gaps + cumulative running totals. */
export function buildTrajectory(rows: TrajectoryYearInput[]): TrajectoryYear[] {
  const sorted = [...rows].sort((a, b) => a.year - b.year);
  let cp = 0, cg = 0;
  return sorted.map((r) => {
    const produced = r.produced ?? null;
    const goal = r.goal ?? null;
    const demand = r.demand ?? null;
    cp += produced ?? 0;
    cg += goal ?? 0;
    return {
      year: r.year,
      demand, goal, produced,
      gapVsGoal: produced != null && goal != null ? produced - goal : null,
      goalAttainment: produced != null && goal ? produced / goal : null,
      demandCoverage: produced != null && demand ? produced / demand : null,
      cumulativeProduced: cp,
      cumulativeGoal: cg,
      onTrack: produced != null && goal != null ? produced >= goal : null,
    };
  });
}

export interface ConstellationCohortInput {
  id: string;
  name: string;
  programId: string;
  programName: string;
  entryYear?: number | null;
  gradYear: number;
  enrolled?: number | null;
  completers?: number | null;
  status?: string | null;
}
export interface ConstellationBar extends ConstellationCohortInput {
  entryYear: number;
  spanYears: number;
}

/** Lay cohorts out as bars from entry year → graduation year (the constellation).
 *  Missing entry years are inferred from a default program span. */
export function buildConstellation(cohorts: ConstellationCohortInput[], defaultSpanYears = 2): ConstellationBar[] {
  return cohorts
    .map((c) => {
      const entryYear = c.entryYear ?? c.gradYear - defaultSpanYears;
      return { ...c, entryYear, spanYears: Math.max(1, c.gradYear - entryYear) };
    })
    .sort((a, b) => a.entryYear - b.entryYear || a.gradYear - b.gradYear || a.name.localeCompare(b.name));
}

/** Year range spanning all the points + cohorts (for axis rendering). */
export function yearSpan(years: number[]): number[] {
  if (years.length === 0) return [];
  const lo = Math.min(...years), hi = Math.max(...years);
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}
