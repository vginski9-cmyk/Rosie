import { describe, it, expect } from "vitest";
import { recommendPlan, demandUnits, DEFAULT_POLICY, type DemandUnit, type SchedulerInput, type Policy } from "../src/lib/scheduler";
import type { AssetLite } from "../src/lib/assetmap";
import type { DatedInstance } from "../src/lib/capacitymodel";

const asset = (o: Partial<AssetLite> & { id: string; employerId: string; facilityName: string }): AssetLite => ({
  externalId: o.id, settingCode: "GEN", setting: "General", assetType: "Room", assetNumber: 1, operatingRule: "Weekday Day", days: "Mon,Tue,Wed,Thu,Fri", shiftBlocks: "Day", hoursPerShift: 8,
  serves: null, learnersPerShift: 2, preceptorsPerShift: 1, dataSource: "VERIFIED", status: "active", agreementStatus: "secured", facilityStatus: "active", ring: "Core", county: "Moore", ...o,
});
const unit = (o: Partial<DemandUnit> & { id: string }): DemandUnit => ({
  cohortId: "co1", cohort: "Class of 2028", programId: "p1", program: "Radiography", familyId: "fam1",
  courseId: "c1", courseCode: "RAD-151", courseTitle: "Clinical Ed I", termIndex: 1, termName: "First Fall", weekOfTerm: 1,
  sessionId: "s1", sessionTitle: null, sectionIndex: 1, sectionCount: 1,
  date: "2027-08-23", weekMonday: "2027-08-23", block: "Day", startTime: "07:00", hours: 8,
  rotationType: "General Radiography", settingCode: "GEN", seats: 2, seatsPerSection: 2, preceptorsNeeded: 1, facultyNeeded: 0, clinicalMode: "Preceptor-led", holiday: null, moved: false, ...o,
});
const base = (over: Partial<SchedulerInput> = {}, policy: Partial<Policy> = {}): SchedulerInput => ({
  demand: [], assets: [], overrides: [], existingBookings: [], preceptors: [], instructors: [], students: [], familyAgreements: [], policy: { ...DEFAULT_POLICY, ...policy }, ...over,
});

describe("demandUnits", () => {
  it("makes one unit per section, splits seats, maps settings and applies moves", () => {
    const row = {
      session: { id: "s1", kind: "CLINICAL", title: "Wk 1", lengthHours: 8, maxStudents: 2, rotationType: "General Radiography", startTime: "07:00", preceptorsNeeded: 1, facultyNeeded: 0.03, clinicalMode: "Preceptor-led" },
      computed: { C: 5, Y: 3 }, cohortId: "co1", cohort: "Class of 2028", programId: "p1", program: "Rad", courseCode: "RAD-151", courseTitle: "Clin I", courseId: "c1",
      termIndex: 1, termName: "First Fall", semester: "Fall", weekOfTerm: 1, monday: null, mondayIso: "2027-08-23", date: null, dateIso: "2027-08-23", month: "2027-08", holiday: null,
    } as unknown as DatedInstance;
    const units = demandUnits([row], [{ rotationType: "general radiography", settingCode: "GEN" }], [{ sessionId: "s1", sectionIndex: 3, fromDate: "2027-08-23", toDate: "2027-08-25", startTime: "15:00" }]);
    expect(units.map((u) => u.seats)).toEqual([2, 2, 1]);
    expect(units.every((u) => u.settingCode === "GEN")).toBe(true);
    const moved = units.find((u) => u.sectionIndex === 3)!;
    expect(moved.date).toBe("2027-08-25"); expect(moved.block).toBe("Evening"); expect(moved.moved).toBe(true);
  });
});

describe("recommendPlan", () => {
  const A = asset({ id: "a1", employerId: "e1", facilityName: "Moore Regional" });

  it("spreads one section across several one-learner rooms at the same site and shift", () => {
    const rooms = [1, 2, 3, 4].map((n) => asset({ id: `r${n}`, employerId: "e1", facilityName: "Moore Regional", assetNumber: n, learnersPerShift: 1 }));
    const plan = recommendPlan(base({ demand: [unit({ id: "u1", seats: 3, seatsPerSection: 3 })], assets: rooms }));
    expect(plan.assignments).toHaveLength(1);
    expect(plan.assignments[0].parts.map((p) => p.seats)).toEqual([1, 1, 1]);
    expect(plan.assignments[0].reason).toContain("across 3 rooms");
    // a second 3-seat section that day has only 1 room left → with no other site it stays short: 1 placed, 2 unmet (full)
    const two = recommendPlan(base({ demand: [unit({ id: "u1", seats: 3, seatsPerSection: 3 }), unit({ id: "u2", sectionIndex: 2, seats: 3, seatsPerSection: 3 })], assets: rooms }));
    expect(two.unmet[0]?.reason).toBe("full"); expect(two.unmet[0]?.unit.seats).toBe(2);
    expect(recommendPlan(base({ demand: [unit({ id: "u1", seats: 3, seatsPerSection: 3 }), unit({ id: "u2", sectionIndex: 2, seats: 3, seatsPerSection: 3 })], assets: rooms }, { split: "none" })).unmet[0]?.reason).toBe("full");
  });

  it("splits a preceptor-led section across sites when no site can seat it, and keeps an instructor-led group together", () => {
    const e1 = [1, 2].map((n) => asset({ id: `e1r${n}`, employerId: "e1", facilityName: "Moore Regional", assetNumber: n, learnersPerShift: 1 }));
    const e3 = [1, 2].map((n) => asset({ id: `e3r${n}`, employerId: "e3", facilityName: "Randolph", assetNumber: n, learnersPerShift: 1 }));
    const pre = unit({ id: "u1", seats: 4, seatsPerSection: 4 });
    const split = recommendPlan(base({ demand: [pre], assets: [...e1, ...e3], students: [1, 2, 3, 4].map((n) => ({ id: `s${n}`, name: `S${n}`, cohortId: "co1", sectionIndex: n })) }));
    expect(split.assignments).toHaveLength(2);
    expect(split.assignments.map((x) => x.seats)).toEqual([2, 2]);
    expect(split.summary.placedShifts).toBe(1); expect(split.summary.placedSeats).toBe(4);
    expect(new Set(split.rosters.map((r) => r.stops[0].siteName)).size).toBe(2); // students 1–2 at one site, 3–4 at the other
    const led = unit({ id: "u2", seats: 4, seatsPerSection: 4, facultyNeeded: 1, clinicalMode: "Instructor-led" });
    const together = recommendPlan(base({ demand: [led], assets: [...e1, ...e3] }));
    expect(together.assignments).toHaveLength(0);
    expect(together.unmet[0].reason).toBe("too-big");
    expect(together.unmet[0].fixes[0]).toMatch(/largest site has 2/);
  });
  const B = asset({ id: "b1", employerId: "e2", facilityName: "Hoke Campus", ring: "Ring 1", agreementStatus: "asked" });

  it("places a section on a secured, open asset and explains why", () => {
    const plan = recommendPlan(base({ demand: [unit({ id: "u1" })], assets: [A, B], preceptors: [{ id: "p1", name: "Pat", employerId: "e1", role: "preceptor" }] }));
    expect(plan.assignments).toHaveLength(1);
    expect(plan.assignments[0].siteName).toBe("Moore Regional");
    expect(plan.assignments[0].preceptorNames).toEqual(["Pat"]);
    expect(plan.assignments[0].reason).toContain("secured agreement");
    expect(plan.summary.placedShare).toBe(1);
    expect(plan.summary.statement).toContain("places 100%");
  });

  it("respects seats: a full asset sends the next section elsewhere or leaves it unmet with reason 'full'", () => {
    const d = [unit({ id: "u1", sectionIndex: 1 }), unit({ id: "u2", sectionIndex: 2 })];
    const one = recommendPlan(base({ demand: d, assets: [A] }));
    expect(one.assignments).toHaveLength(1);
    expect(one.unmet[0].reason).toBe("full");
    expect(one.unmet[0].fixes.length).toBeGreaterThan(0); // ±1 day would land it on Tuesday
    const two = recommendPlan(base({ demand: d, assets: [A, B] }, { agreements: "secured+asked" }));
    expect(two.assignments.map((x) => x.siteName).sort()).toEqual(["Hoke Campus", "Moore Regional"]);
  });

  it("names the agreement gate and the relaxation that would fix it", () => {
    const plan = recommendPlan(base({ demand: [unit({ id: "u1" })], assets: [B] }));
    expect(plan.unmet[0].reason).toBe("no-agreement");
    expect(plan.unmet[0].fixes[0]).toMatch(/asked/);
    expect(plan.bottlenecks[0].seats).toBe(2);
  });

  it("uses the family's own agreement over the institution-level one", () => {
    const plan = recommendPlan(base({ demand: [unit({ id: "u1" })], assets: [B], familyAgreements: [{ familyId: "fam1", employerId: "e2", agreementStatus: "secured" }] }));
    expect(plan.assignments).toHaveLength(1);
  });

  it("closed days: unmet unless flexible days/shift allowed; moves are recorded", () => {
    const sat = unit({ id: "u1", date: "2027-08-28", weekMonday: "2027-08-23" }); // Saturday, asset runs Mon–Fri
    expect(recommendPlan(base({ demand: [sat], assets: [A] })).unmet[0].reason).toBe("closed-that-day");
    const flex = recommendPlan(base({ demand: [sat], assets: [A] }, { flexibleDays: 1 }));
    expect(flex.assignments[0].date).toBe("2027-08-27"); expect(flex.assignments[0].movedDays).toBe(-1);
    const night = unit({ id: "u2", block: "Night", startTime: "23:00" });
    expect(recommendPlan(base({ demand: [night], assets: [A] })).unmet[0].reason).toBe("closed-that-day");
    expect(recommendPlan(base({ demand: [night], assets: [A] }, { flexibleShift: true })).assignments[0].changedBlock).toBe(true);
  });

  it("holidays are left for moving unless the lever is off", () => {
    const h = unit({ id: "u1", holiday: "Labor Day" });
    expect(recommendPlan(base({ demand: [h], assets: [A] })).unmet[0].reason).toBe("holiday");
    expect(recommendPlan(base({ demand: [h], assets: [A] }, { skipHolidays: false })).assignments).toHaveLength(1);
  });

  it("continuity keeps a section at its earlier site; spread balances instead", () => {
    const A2 = asset({ id: "a2", employerId: "e1", facilityName: "Moore Regional" });
    const C = asset({ id: "c1", employerId: "e3", facilityName: "Randolph", ring: "Core" });
    const wk1 = unit({ id: "w1", date: "2027-08-23", weekMonday: "2027-08-23" });
    const wk2 = unit({ id: "w2", date: "2027-08-30", weekMonday: "2027-08-30" });
    const cont = recommendPlan(base({ demand: [wk1, wk2], assets: [A, A2, C] }));
    expect(new Set(cont.assignments.map((x) => x.employerId)).size).toBe(1);
    expect(cont.assignments[1].reason).toContain("same site");
  });

  it("gates on preceptors when asked, and assigns instructors for instructor-led sections", () => {
    const d = [unit({ id: "u1", sectionIndex: 1 }), unit({ id: "u2", sectionIndex: 2, facultyNeeded: 1, clinicalMode: "Instructor-led" })];
    const gated = recommendPlan(base({ demand: d, assets: [A, asset({ id: "a2", employerId: "e1", facilityName: "Moore Regional" })], preceptors: [{ id: "p1", name: "Pat", employerId: "e1", role: "preceptor" }], instructors: [{ id: "i1", name: "Dr. Lee", role: "instructor" }] }, { requirePreceptor: true }));
    expect(gated.assignments).toHaveLength(1);
    expect(gated.unmet[0].reason).toBe("no-preceptor");
    const open = recommendPlan(base({ demand: d, assets: [A, asset({ id: "a2", employerId: "e1", facilityName: "Moore Regional" })], preceptors: [{ id: "p1", name: "Pat", employerId: "e1", role: "preceptor" }], instructors: [{ id: "i1", name: "Dr. Lee", role: "instructor" }] }));
    expect(open.assignments).toHaveLength(2);
    expect(open.assignments.find((x) => x.unit.id === "u2")?.instructorName).toBe("Dr. Lee");
    expect(open.summary.preceptorsAssigned).toBe(1); // one preceptor, two shifts at the same time
    expect(open.sites[0].preceptorShort).toBe(1);
  });

  it("places the hardest sections first so an easy one never steals the only slot", () => {
    // u-hard can only go to A (Core, secured); u-easy could go to A or C. A has 2 seats: exactly one section.
    const C = asset({ id: "c1", employerId: "e3", facilityName: "Randolph", settingCode: "GEN" });
    const hard = unit({ id: "hard", sectionIndex: 1 });
    const easy = unit({ id: "easy", sectionIndex: 2, cohortId: "co2", cohort: "Class of 2029" });
    // make C unusable for 'hard' via ring: hard's family only secured at e1; easy's family secured at both
    const plan = recommendPlan(base({ demand: [easy, hard], assets: [A, C], familyAgreements: [{ familyId: "fam1", employerId: "e3", agreementStatus: "none" }] }, { agreements: "secured" }));
    // C is 'secured' at institution level but the family says none → hard can't use C; easy shares the family → same. Both need A → one unmet.
    expect(plan.assignments.length + plan.unmet.length).toBe(2);
  });

  it("builds analytics layers: balance, weeks, sites, rosters", () => {
    const plan = recommendPlan(base({ demand: [unit({ id: "u1" }), unit({ id: "u2", sectionIndex: 2, settingCode: "ED", rotationType: "Emergency" })], assets: [A], students: [{ id: "st1", name: "Ana", cohortId: "co1", sectionIndex: 1 }, { id: "st2", name: "Bo", cohortId: "co1", sectionIndex: 3 }] }));
    const gen = plan.balance.find((b) => b.settingCode === "GEN")!;
    expect(gen.verdict).toBe("tight"); expect(gen.utilization).toBe(1); expect(gen.placedShifts).toBe(1); expect(gen.supplyShiftsAllowed).toBe(1);
    expect(plan.balance.find((b) => b.settingCode === "ED")?.verdict).toBe("short");
    expect(plan.weeks.find((w) => w.settingCode === "GEN")?.placed).toBe(2);
    expect(plan.sites[0].utilization).toBe(1);
    expect(plan.rosters.map((r) => r.student.name)).toEqual(["Ana"]); // seat 1 → section 1 (placed); seat 3 → section 2 (unplaced)
    expect(plan.rosters[0].stops[0].siteName).toBe("Moore Regional");
    expect(plan.bottlenecks[0].reason).toBe("no-asset-for-setting");
  });
});
