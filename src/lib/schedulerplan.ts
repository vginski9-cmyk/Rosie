// The scheduler's plan, built the same way wherever it is needed. The board in
// the browser and the "apply" action on the server both start from the same
// offerings, supply and levers and run the same pure steps, so the plan the
// user sees is the plan that gets written — and the browser only has to send
// the levers, never the thousands of placed sections themselves.

import { buildInstances, type CohortCalendarInput, type DatedInstance } from "./capacitymodel";
import { demandUnits, recommendPlan, AUTO_PLAN_NOTE, type Policy, type Plan, type DemandUnit, type Assignment, type Preceptor, type Instructor, type StudentLite, type FamilyAgreement } from "./scheduler";
import type { AssetLite, AssetDayOverride, AssetBookingLite } from "./assetmap";
import type { CapacityCohort } from "@/components/CapacityBoard";
import type { RotationCodeRow } from "@/components/AssetMapBoard";
import type { PlanAssignmentInput } from "./actions";

export interface SchedulerSupply {
  assets: AssetLite[]; overrides: AssetDayOverride[]; bookings: (AssetBookingLite & { note?: string | null })[]; rotations: RotationCodeRow[];
  preceptors: Preceptor[]; instructors: Instructor[]; students: StudentLite[]; familyAgreements: FamilyAgreement[];
}

/** What the board sends to be applied: the levers, the date window and which offerings — a few hundred bytes. */
export interface SchedulerLevers { policy: Policy; from: string; to: string; cohortIds: string[] }

/** The data window the scheduler page loads: first term start to 20 weeks past the last one. */
export function schedulerWindow(cohorts: Pick<CapacityCohort, "termStartByIndex">[], today = new Date()): { from: string; to: string } {
  const starts = cohorts.flatMap((c) => Object.values(c.termStartByIndex).filter((v): v is string => !!v)).sort();
  const todayIso = today.toISOString().slice(0, 10);
  const from = starts[0]?.slice(0, 10) ?? todayIso;
  const last = starts[starts.length - 1]?.slice(0, 10) ?? todayIso;
  const to = new Date(new Date(last + "T00:00:00Z").getTime() + 20 * 7 * 86400000).toISOString().slice(0, 10);
  return { from, to };
}

/** Every dated clinical section of every offering: the demand side, before any window or offering filter. */
export function schedulerDemand(cohorts: CapacityCohort[], rotations: RotationCodeRow[]): DemandUnit[] {
  const rows: DatedInstance[] = cohorts.flatMap((c) => buildInstances({
    cohortId: c.cohortId, cohort: c.cohort, programId: c.programId, program: c.program, enrollmentByTerm: c.enrollmentByTerm,
    termStartByIndex: Object.fromEntries(Object.entries(c.termStartByIndex).map(([k, v]) => [k, v ? new Date(v) : null])),
    termEndByIndex: c.termEndByIndex, termWeeksByIndex: c.termWeeksByIndex, holidays: c.holidays, courses: c.courses,
  } as CohortCalendarInput, c.assumptions).filter((i) => i.dateIso != null));
  const familyByCohort = Object.fromEntries(cohorts.map((c) => [c.cohortId, c.familyId ?? null]));
  const moves = cohorts.flatMap((c) => (c.moves ?? []).map((m) => ({ sessionId: m.sessionId, sectionIndex: m.sectionIndex, fromDate: m.fromDate, toDate: m.toDate, startTime: m.startTime ?? null })));
  return demandUnits(rows, rotations, moves, familyByCohort);
}

/** The demand the levers leave: chosen offerings (none chosen = all) inside the window. */
export function filterDemand(demand: DemandUnit[], levers: Pick<SchedulerLevers, "from" | "to" | "cohortIds">): DemandUnit[] {
  const chosen = new Set(levers.cohortIds);
  return demand.filter((u) => (chosen.size === 0 || chosen.has(u.cohortId)) && u.date >= levers.from && u.date <= levers.to);
}

/** The recommended plan for this demand against this supply under these levers. Hand-made bookings take seats; an earlier applied plan does not (it is about to be replaced). */
export function planFor(demand: DemandUnit[], supply: SchedulerSupply, policy: Policy): Plan {
  const manualBookings = supply.bookings.filter((b) => b.note !== AUTO_PLAN_NOTE);
  return recommendPlan({ demand, assets: supply.assets, overrides: supply.overrides, existingBookings: manualBookings, preceptors: supply.preceptors, instructors: supply.instructors, students: supply.students, familyAgreements: supply.familyAgreements, policy });
}

/** The whole path in one call, for the server: offerings + supply + levers → the plan. */
export function buildSchedulerPlan(cohorts: CapacityCohort[], supply: SchedulerSupply, levers: SchedulerLevers): Plan {
  return planFor(filterDemand(schedulerDemand(cohorts, supply.rotations), levers), supply, levers.policy);
}

/** A placed section as the apply action writes it. */
export function planInputs(assignments: Assignment[]): PlanAssignmentInput[] {
  return assignments.map((x) => ({ assetId: x.assetId, employerId: x.employerId, cohortId: x.unit.cohortId, sessionId: x.unit.sessionId, sectionIndex: x.unit.sectionIndex, courseId: x.unit.courseId, date: x.date, block: x.block, seats: x.seats, seatsPerSection: x.unit.seatsPerSection, preceptorIds: x.preceptorIds, instructorId: x.instructorId, parts: x.parts.map((p) => ({ assetId: p.assetId, seats: p.seats })), seatOffset: x.seatOffset }));
}
