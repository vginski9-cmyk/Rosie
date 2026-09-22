import type { PrismaClient } from "@prisma/client";

// THE ROSTER IS THE SCHEDULER'S OWN PLAN. Every seeded offering's clinical shifts are placed by
// the scheduler (lib/scheduler) under the roster levers (lib/schedulerplan ROSTER_POLICY) and
// written through the same path the apply button uses (lib/planwrite): a learner booking per
// section × asset × shift, each section's meeting pattern pointed at its main site, a calendar
// move for every shift that landed on another day or shift block, the site's preceptors on the
// shift, and every student's shift pinned to the booked asset. So the clinical scheduler, the
// site capacity view and the site load page all read one set of placements — and no site is
// ever over its seats, because the engine never places over an asset's learners per shift or a
// site's students-at-once.
export interface RosterPlacement { institution: string; from: string; to: string; demand: number; placed: number; unplaced: number; sites: number; bookings: number; shifts: number; moves: number; staffed: number; whyUnplaced: Record<string, number> }

export async function seedRosterPlacements(_prisma: PrismaClient, institutionId: string): Promise<RosterPlacement | null> {
  const { getCapacityModel, getSchedulerData } = await import("../src/lib/queries");
  const { buildSchedulerPlan, planInputs, schedulerWindow, ROSTER_POLICY } = await import("../src/lib/schedulerplan");
  const { writeSchedulerPlan } = await import("../src/lib/planwrite");
  const data = await getCapacityModel({ institutionId });
  if (!data) return null;
  const { from, to } = schedulerWindow(data.cohorts);
  const supply = await getSchedulerData(institutionId, from, to);
  const plan = buildSchedulerPlan(data.cohorts, supply, { policy: ROSTER_POLICY, from, to, cohortIds: [] });
  const r = plan.assignments.length ? await writeSchedulerPlan(planInputs(plan.assignments), { cutoff: from }) : { bookings: 0, placements: 0, meetings: 0, moves: 0, staffed: 0, shifts: 0, offSite: 0 };
  const whyUnplaced: Record<string, number> = {};
  for (const u of plan.unmet) whyUnplaced[u.reason] = (whyUnplaced[u.reason] ?? 0) + u.unit.seats;
  return { institution: data.institution.name, from, to, demand: plan.summary.demandSeats, placed: plan.summary.placedSeats, unplaced: plan.summary.demandSeats - plan.summary.placedSeats, sites: plan.summary.sitesUsed, bookings: r.bookings, shifts: r.shifts, moves: r.moves, staffed: r.staffed, whyUnplaced };
}
