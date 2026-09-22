// The scheduler's plan, built the same way wherever it is needed. The board in
// the browser and the "apply" action on the server both start from the same
// offerings, supply and levers and run the same pure steps, so the plan the
// user sees is the plan that gets written — and the browser only has to send
// the levers, never the thousands of placed sections themselves.

import { buildInstances, type CohortCalendarInput, type DatedInstance } from "./capacitymodel";
import { demandUnits, recommendPlan, AUTO_PLAN_NOTE, DEFAULT_POLICY, type Policy, type Plan, type DemandUnit, type CampusBlock, type Assignment, type Preceptor, type Instructor, type StudentLite, type FamilyAgreement, type SiteCapacityLite, type ConfirmedSetting } from "./scheduler";
import { shiftStart, type AssetLite, type AssetDayOverride, type AssetBookingLite } from "./assetmap";
import type { CapacityCohort } from "@/components/CapacityBoard";
import type { RotationCodeRow } from "@/components/AssetMapBoard";
import type { PlanAssignmentInput } from "./planwrite";
export { plannedWindow } from "./cohortscope";

export interface SchedulerSupply {
  assets: AssetLite[]; overrides: AssetDayOverride[]; bookings: (AssetBookingLite & { note?: string | null })[]; rotations: RotationCodeRow[];
  preceptors: Preceptor[]; instructors: Instructor[]; students: StudentLite[]; familyAgreements: FamilyAgreement[];
  /** Phase 5: what each site may hold at once and which settings it has confirmed — the readiness funnel's inputs. */
  siteCaps?: SiteCapacityLite[]; confirmedSettings?: ConfirmedSetting[];
  /** Course rotation pools (lib/requirementcoverage) — the rule a course's generically tagged sessions read; keyed by course id. */
  courseRules?: Record<string, import("./settingrule").SettingRuleSpec>;
}

/** The levers the roster is placed with — the seed places every demo offering's clinical shifts
 *  through the scheduler under these, and the scheduler page opens on them, so the share the
 *  page says can be placed is the share the site-load page finds on booked seats. Every secured
 *  site at any drive time, any shift block, ± 2 days inside the week, never a holiday; seats
 *  first (a site's preceptors are put on the shift when it has them, not required to place it). */
export const ROSTER_POLICY: Policy = { ...DEFAULT_POLICY, agreements: "secured", maxRing: "any", flexibleShift: true, flexibleDays: 2, skipHolidays: true, requirePreceptor: false };

/** The base levers the scheduler page opens on: secured sites only, within the core drive band (30 minutes of campus),
 *  the exact shift block and the exact date the template says, never a holiday, seats first. The strict reading —
 *  every loosening from here is a choice the reader makes on the levers card. "Reset to the base levers" returns to them. */
export const BASE_POLICY: Policy = { ...DEFAULT_POLICY, agreements: "secured", maxRing: "Core", flexibleShift: false, flexibleDays: 0, skipHolidays: true, requirePreceptor: false };
/** Which levers two policies differ on — the board says so when the calendar's roster and the estimate were not built the same way. */
export function leverDifferences(a: Policy, b: Policy): (keyof Policy)[] { return (Object.keys(a) as (keyof Policy)[]).filter((k) => a[k] !== b[k]); }

/** What the board sends to be applied: the levers, the date window and which offerings — a few hundred bytes. */
export interface SchedulerLevers { policy: Policy; from: string; to: string; cohortIds: string[] }

/** The full data window: first term start of any offering (a graduated class's history included) to 20 weeks past the last one.
 *  The seed places and the audit checks this whole range; the board opens on `plannedWindow` (the current academic year on). */
export function schedulerWindow(cohorts: Pick<CapacityCohort, "termStartByIndex">[], today = new Date()): { from: string; to: string } {
  const starts = cohorts.flatMap((c) => Object.values(c.termStartByIndex).filter((v): v is string => !!v)).sort();
  const todayIso = today.toISOString().slice(0, 10);
  const from = starts[0]?.slice(0, 10) ?? todayIso;
  const last = starts[starts.length - 1]?.slice(0, 10) ?? todayIso;
  const to = new Date(new Date(last + "T00:00:00Z").getTime() + 20 * 7 * 86400000).toISOString().slice(0, 10);
  return { from, to };
}

const toMin = (t: string | null | undefined) => { if (!t) return null; const [h, m] = t.split(":").map(Number); return (h || 0) * 60 + (m || 0); };

/** Every dated session of every offering, split two ways: the clinical sections that need a
 *  home (demand) and the campus classes and labs the cohort is in (when a clinical cannot be). */
export function schedulerModel(cohorts: CapacityCohort[], rotations: RotationCodeRow[], courseRules: Record<string, import("./settingrule").SettingRuleSpec> = {}): { demand: DemandUnit[]; campus: CampusBlock[]; holidays: Record<string, string> } {
  const rows: DatedInstance[] = cohorts.flatMap((c) => buildInstances({
    cohortId: c.cohortId, cohort: c.cohort, programId: c.programId, program: c.program, enrollmentByTerm: c.enrollmentByTerm,
    termStartByIndex: Object.fromEntries(Object.entries(c.termStartByIndex).map(([k, v]) => [k, v ? new Date(v) : null])),
    termEndByIndex: c.termEndByIndex, termWeeksByIndex: c.termWeeksByIndex, holidays: c.holidays, holidayRule: c.holidayRule, courses: c.courses,
  } as CohortCalendarInput, c.assumptions).filter((i) => i.dateIso != null));
  const familyByCohort = Object.fromEntries(cohorts.map((c) => [c.cohortId, c.familyId ?? null]));
  // Hand-made moves are facts the plan must honour; an earlier applied plan's own moves are the plan being replaced —
  // starting from them would drift a shift another ± flexibleDays every time the plan is applied.
  const moves = cohorts.flatMap((c) => (c.moves ?? []).filter((m) => m.note !== AUTO_PLAN_NOTE).map((m) => ({ cohortId: c.cohortId, sessionId: m.sessionId, sectionIndex: m.sectionIndex, fromDate: m.fromDate, toDate: m.toDate, startTime: m.startTime ?? null })));
  const campus: CampusBlock[] = [];
  for (const r of rows) {
    if (r.session.kind === "CLINICAL" || !r.dateIso) continue;
    // A class with no stated time takes the whole working day.
    const start = toMin(r.session.startTime) ?? 8 * 60;
    const hours = r.session.lengthHours && r.session.lengthHours > 0 ? r.session.lengthHours : r.session.startTime ? 1 : 9;
    campus.push({ cohortId: r.cohortId, date: r.dateIso, startMin: start, endMin: start + Math.round(hours * 60), label: `${r.courseCode ?? r.courseTitle} ${r.session.kind === "LAB" ? "lab" : "class"}` });
  }
  const holidays = Object.assign({}, ...cohorts.map((c) => c.holidays ?? {})) as Record<string, string>;
  return { demand: demandUnits(rows, rotations, moves, familyByCohort, holidays, courseRules), campus, holidays };
}

/** The demand the levers leave: chosen offerings (none chosen = all) inside the window. */
export function filterDemand(demand: DemandUnit[], levers: Pick<SchedulerLevers, "from" | "to" | "cohortIds">): DemandUnit[] {
  const chosen = new Set(levers.cohortIds);
  return demand.filter((u) => (chosen.size === 0 || chosen.has(u.cohortId)) && u.date >= levers.from && u.date <= levers.to);
}

/** The recommended plan for this demand against this supply under these levers. Hand-made bookings take seats; an earlier applied plan does not (it is about to be replaced). */
export function planFor(demand: DemandUnit[], supply: SchedulerSupply, policy: Policy, campus: CampusBlock[] = [], holidays: Record<string, string> = {}): Plan {
  const manualBookings = supply.bookings.filter((b) => b.note !== AUTO_PLAN_NOTE);
  return recommendPlan({ demand, campus, holidays, assets: supply.assets, overrides: supply.overrides, existingBookings: manualBookings, preceptors: supply.preceptors, instructors: supply.instructors, students: supply.students, familyAgreements: supply.familyAgreements, siteCaps: supply.siteCaps, confirmedSettings: supply.confirmedSettings, policy });
}

/** The whole path in one call, for the server: offerings + supply + levers → the plan. */
export function buildSchedulerPlan(cohorts: CapacityCohort[], supply: SchedulerSupply, levers: SchedulerLevers): Plan {
  const { demand, campus, holidays } = schedulerModel(cohorts, supply.rotations, supply.courseRules ?? {});
  return planFor(filterDemand(demand, levers), supply, levers.policy, campus, holidays);
}

/** A placed section as the apply action writes it: what was booked, plus everything the calendar
 *  needs to show the shift where it actually lands (the date it moved from, the shift block's start). */
export function planInputs(assignments: Assignment[]): PlanAssignmentInput[] {
  return assignments.map((x) => ({
    assetId: x.assetId, employerId: x.employerId, cohortId: x.unit.cohortId, sessionId: x.unit.sessionId, sectionIndex: x.unit.sectionIndex, courseId: x.unit.courseId,
    date: x.date, block: x.block, seats: x.seats, seatsPerSection: x.unit.seatsPerSection, preceptorIds: x.preceptorIds, instructorId: x.instructorId, instructorHours: x.instructorHours,
    parts: x.parts.map((p) => ({ assetId: p.assetId, seats: p.seats })), seatOffset: x.seatOffset, seatStart: x.unit.seatStart, sectionSeats: x.unit.sectionSeats,
    originalDate: x.unit.originalDate, movedDays: x.movedDays, changedBlock: x.changedBlock, startTime: x.changedBlock ? shiftStart(x.asset, x.block) : x.unit.startTime, hours: x.hours,
  }));
}
