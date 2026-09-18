import { describe, it, expect } from "vitest";
import { outcomeStats, pivot, SMALL_CELL, type LearnerLite } from "../src/lib/learners";
import { goalTiming, earliestFeasibleYear, infeasibleGoal, programWeeks, DEFAULT_TIMING } from "../src/lib/goaltiming";
import { schedulableDates, utilizationTotals, utilizationRollup, utilizationAtoms, type UtilRoom, type UtilMeeting } from "../src/lib/utilization";

// Phase 6 (docs/metrics-audit.md §12): completion only for cohorts old enough, small cells suppressed,
// goal timing worked backward from the target year, a schedulable-hours utilization denominator.

const learner = (o: Partial<LearnerLite> & { id: string; status: string }): LearnerLite => ({
  name: o.id, stageKey: null, entryYear: 2026, institution: "Sandhills", program: "Radiography", cohort: "Class of 2028",
  dob: null, sex: null, raceEthnicity: null, county: null, city: null, zip: null, residency: null, priorEducation: null, employmentStatus: null,
  firstGeneration: null, veteran: null, pellEligible: null, disability: null, withdrawalReason: null, gpa: null, ...o,
});
const today = "2026-09-18";

describe("completion rate only for cohorts old enough to complete", () => {
  const running = [1, 2, 3, 4, 5, 6].map((n) => learner({ id: `r${n}`, status: n === 6 ? "withdrawn" : "enrolled", cohortEnds: "2028-05-09" }));
  const ended = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => learner({ id: `e${n}`, status: n <= 6 ? "completed" : n === 7 ? "withdrawn" : "enrolled", cohortEnds: "2026-05-12", cohort: "Class of 2026" }));
  it("a cohort still running has a withdrawal rate but no completion rate", () => {
    const o = outcomeStats(running, today);
    expect(o.entrants).toBe(6);
    expect(o.withdrawalRate).toBeCloseTo(1 / 6);
    expect(o.completionRate).toBeNull();
    expect(o.unmaturedEntrants).toBe(6);
  });
  it("only entrants whose cohort has ended are in the completion denominator", () => {
    const o = outcomeStats([...running, ...ended], today);
    expect(o.entrants).toBe(14);
    expect(o.maturedEntrants).toBe(8);
    expect(o.maturedCompleted).toBe(6);
    expect(o.completionRate).toBeCloseTo(6 / 8);
    expect(o.withdrawalRate).toBeCloseTo(2 / 14);
    // Without a date (or end dates) there is no completion rate at all — never "of decided".
    expect(outcomeStats([...running, ...ended]).completionRate).toBeNull();
  });
  it("the demographic pivot applies the same rule and suppresses small cells", () => {
    const rows = pivot([...running.map((l) => ({ ...l, sex: "Female" })), ...ended.map((l) => ({ ...l, sex: "Male" })), learner({ id: "s1", status: "completed", sex: "Intersex", cohortEnds: "2026-05-12" }), learner({ id: "s2", status: "withdrawn", sex: "Intersex", cohortEnds: "2026-05-12" })], "sex", today);
    const f = rows.find((r) => r.value === "Female")!, m = rows.find((r) => r.value === "Male")!, i = rows.find((r) => r.value === "Intersex")!;
    expect(f.completionRate).toBeNull(); expect(f.withdrawalRate).toBeCloseTo(1 / 6); expect(f.smallCell).toBe(false);
    expect(m.completionRate).toBeCloseTo(6 / 8); expect(m.maturedEntrants).toBe(8);
    expect(i.entrants).toBe(2); expect(i.entrants).toBeLessThan(SMALL_CELL); expect(i.smallCell).toBe(true);
    expect(i.completionRate).toBeNull(); expect(i.withdrawalRate).toBeNull();
  });
});

describe("goal timing works backward from the target year", () => {
  const rad = { spanWeeks: 80, terms: 5 }; // five terms, ~80 instructional weeks
  it("chains ramp, placement, licensure and the program's length back to a required start", () => {
    const g = goalTiming(2028, rad, today);
    expect(g.productiveBy).toBe("2028-12-31");
    expect(g.placedBy).toBe("2028-06-30");     // 6 months ramp
    expect(g.licensedBy).toBe("2028-03-30");   // 3 months placement
    expect(g.completeBy).toBe("2027-12-30");   // 3 months licensure
    expect(g.programWeeks).toBe(80 + 4 * DEFAULT_TIMING.breakWeeksBetweenTerms);
    expect((Date.parse(g.completeBy) - Date.parse(g.startBy)) / 86400000).toBe(88 * 7); // 88 weeks before completion
    expect(g.startBy.slice(0, 7)).toBe("2026-04");
    expect(g.feasible).toBe(false);            // April 2026 is behind us on 2026-09-18
    expect(goalTiming(2029, rad, today).feasible).toBe(true);
  });
  it("a cohort starting today is productive no earlier than the chain allows", () => {
    expect(programWeeks({ spanWeeks: 10, terms: 1 })).toBe(10);
    expect(earliestFeasibleYear(rad, today)).toBe(2029);          // 88 weeks → 2028-05 complete → +12 months → 2029-05
    expect(earliestFeasibleYear({ spanWeeks: 11, terms: 1 }, today)).toBe(2027); // a nurse aide course: Dec 2026 complete → Dec 2027 productive
  });
  it("flags a goal year nothing can deliver, and never one an offering already delivers", () => {
    expect(infeasibleGoal(2026, 29, [rad], 0, today)).toEqual({ infeasible: true, earliestYear: 2029 });
    expect(infeasibleGoal(2028, 29, [rad], 1, today).infeasible).toBe(false);    // an offering ends in 2028
    expect(infeasibleGoal(2026, 0, [rad], 0, today).infeasible).toBe(false);     // no goal, nothing to deliver
    expect(infeasibleGoal(2027, 10, [rad, { spanWeeks: 11, terms: 1 }], 0, today)).toEqual({ infeasible: false, earliestYear: 2027 });
  });
});

describe("room utilization over schedulable hours", () => {
  const semesters = [{ iso: "2026-08-17", endIso: "2026-12-15", season: "Fall" }];
  const holidays = ["2026-09-07", "2026-11-25", "2026-11-26", "2026-11-27"];
  it("schedulable dates are weekdays inside a coded semester, never a holiday", () => {
    const d = schedulableDates("2026-08-01", "2026-12-31", semesters, holidays);
    expect(d[0]).toBe("2026-08-17");
    expect(d[d.length - 1]).toBe("2026-12-15");
    expect(d).not.toContain("2026-09-07");
    expect(d).not.toContain("2026-08-22"); // a Saturday
    expect(d).toHaveLength(83);           // 87 weekdays Aug 17 – Dec 15, less 4 holidays
    // No coded semester: every weekday counts.
    expect(schedulableDates("2026-08-03", "2026-08-09")).toEqual(["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"]);
  });
  it("the headline uses schedulable hours; all coded hours over every day stay as the secondary figure", () => {
    const room: UtilRoom = { id: "r1", name: "Lab 101", kind: "lab", capacity: 24, buildingId: "b", building: "Health", campusId: "c", campus: "Main", closures: [], hours: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => ({ dayOfWeek: d, openTime: "08:00", closeTime: "18:00" })) };
    const meeting: UtilMeeting = { id: "m1", cohortId: "co", cohort: "Class of 2028", programId: "p", program: "Rad", courseId: "c", courseCode: "RAD-111", courseName: "Intro", kind: "LAB", sectionIndex: 1, seats: 20, dayOfWeek: "Mon", startTime: "09:00", lengthHours: 3, facilityId: "r1", employerId: null, employerName: null, weekStartMs: Date.UTC(2026, 7, 17), weekEndMs: Date.UTC(2026, 11, 16), termIndex: 1 };
    const from = "2026-08-17", to = "2026-12-15";
    const atoms = utilizationAtoms([meeting], [room], { from, to }, semesters);
    const sched = schedulableDates(from, to, semesters, holidays);
    const t = utilizationTotals(atoms, [room], from, to, sched);
    expect(atoms).toHaveLength(18);                    // 18 Mondays (the Labor Day booking still lands — it is flagged elsewhere)
    expect(t.openHours).toBe(1040);                    // Mon–Sat × 10 h: 17 weeks × 6 days + Dec 14–15
    expect(t.schedulableHours).toBe(830);              // 83 schedulable days × 10 h
    expect(t.utilizationSchedulable).toBeCloseTo(54 / 830);
    expect(t.utilization).toBeCloseTo(54 / 1040);
    expect(t.utilizationSchedulable).toBeGreaterThan(t.utilization!);
    // The room rows use the same denominator when asked.
    const rows = utilizationRollup(atoms, [room], "room", from, to, semesters, undefined, sched);
    expect(rows[0].openHours).toBe(830);
    expect(utilizationRollup(atoms, [room], "room", from, to, semesters)[0].openHours).toBe(1040);
  });
});
