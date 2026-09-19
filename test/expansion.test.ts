import { describe, it, expect } from "vitest";
import { resolveAssumptions, applyFamilyRates, ASSUMPTION_DEFS, confidenceOf, type AssumptionRow } from "../src/lib/assumptions";
import { prepareExpansion, evaluateExpansion, proposeCohorts, designRules, DEFAULT_DESIGN, type ExpansionInput, type ExpansionDesign } from "../src/lib/expansion";
import type { SessionInput } from "../src/lib/capacitymodel";
import type { AssetLite } from "../src/lib/assetmap";

// Phase 9 (docs/metrics-audit.md §15), use case 1: the expansion analysis. A small college with one
// program template, a faculty roster, one secured site with assets and preceptors, coded rooms.

const today = "2026-09-19";
const session = (o: Partial<SessionInput> & { id: string; kind: SessionInput["kind"] }): SessionInput => ({
  number: 1, title: null, deliveryMode: null, location: null, lengthHours: 3, maxStudents: 24, facultyNeeded: 1, facultyContactPolicy: null, supportStaffNeeded: 0, supportContactPolicy: null,
  week: 1, dayOfWeek: "Mon", startTime: "09:00", notes: null, preceptorsNeeded: 0, preceptorContactPolicy: null, rotationType: null, clinicalMode: null, ...o,
});
// Two 16-week terms: term 1 class + lab weekly (weeks 1–16); term 2 adds a clinical every Tuesday (weeks 1–16), 2 students per preceptor.
const classSessions = (prefix: string) => Array.from({ length: 16 }, (_, i) => session({ id: `${prefix}-c${i + 1}`, kind: "CLASS", week: i + 1, dayOfWeek: "Mon", lengthHours: 3, maxStudents: 30 }));
const labSessions = (prefix: string) => Array.from({ length: 16 }, (_, i) => session({ id: `${prefix}-l${i + 1}`, kind: "LAB", week: i + 1, dayOfWeek: "Wed", lengthHours: 3, maxStudents: 12 }));
const clinicalSessions = (prefix: string) => Array.from({ length: 16 }, (_, i) => session({ id: `${prefix}-k${i + 1}`, kind: "CLINICAL", week: i + 1, dayOfWeek: "Tue", startTime: "07:00", lengthHours: 8, maxStudents: 2, facultyNeeded: 0, preceptorsNeeded: 1, preceptorContactPolicy: 1, rotationType: "General Radiography" }));
const asset = (id: string, employerId: string, name: string, agreementStatus: string, learners = 2): AssetLite => ({
  id, externalId: id, employerId, facilityName: name, settingCode: "GEN", setting: "General", assetType: "Room", assetNumber: 1, operatingRule: "Weekday Day", days: "Mon,Tue,Wed,Thu,Fri", shiftBlocks: "Day", hoursPerShift: 8,
  serves: null, learnersPerShift: learners, preceptorsPerShift: 1, dataSource: "VERIFIED", status: "active", agreementStatus, facilityStatus: "active", ring: "Core", county: "Moore",
});
function input(over: Partial<ExpansionInput> = {}, supplyOver: Partial<ExpansionInput["supply"]> = {}): ExpansionInput {
  const assumptions = resolveAssumptions([], {}, {}, today);
  return {
    todayIso: today, institution: { id: "i1", name: "Sandhills" },
    program: {
      id: "p1", name: "Radiography", familyId: "f1", familyName: "Radiography",
      terms: [{ id: "t1", index: 1, name: "Term 1", startWeek: 1, endWeek: 16, semester: "Fall" }, { id: "t2", index: 2, name: "Term 2", startWeek: 17, endWeek: 32, semester: "Spring" }],
      courses: [
        { id: "c1", termId: "t1", termIndex: 1, termName: "Term 1", code: "RAD-111", name: "Intro", sessions: [...classSessions("a"), ...labSessions("a")] },
        { id: "c2", termId: "t2", termIndex: 2, termName: "Term 2", code: "RAD-151", name: "Clinical I", sessions: [...classSessions("b"), ...clinicalSessions("b")] },
      ],
      assumptions: { facContactHours: 16, facWorkWeekHours: 40, facTermWeeks: 16, preContactHours: 40, preWorkWeekHours: 40, preTermWeeks: 16 },
      accreditedCapacity: null, defaultSeats: 24,
    },
    anchors: { springStart: "01-08", summerStart: "05-28", fallStart: "08-15" }, events: [], holidays: {},
    baselineRows: [], baselineCohorts: [],
    supply: {
      instructors: [{ id: "f1", name: "A", employmentType: "full-time", contactHoursPerWeek: 16 }, { id: "f2", name: "B", employmentType: "full-time", contactHoursPerWeek: 16 }],
      assets: [asset("a1", "e1", "Moore Regional", "secured", 2), asset("a2", "e1", "Moore Regional", "secured", 2), asset("a3", "e1", "Moore Regional", "secured", 2), asset("a4", "e1", "Moore Regional", "secured", 2), asset("a5", "e1", "Moore Regional", "secured", 2), asset("a6", "e1", "Moore Regional", "secured", 2), asset("a7", "e1", "Moore Regional", "secured", 2), asset("a8", "e1", "Moore Regional", "secured", 2), asset("a9", "e1", "Moore Regional", "secured", 2), asset("a10", "e1", "Moore Regional", "secured", 2), asset("a11", "e1", "Moore Regional", "secured", 2), asset("a12", "e1", "Moore Regional", "secured", 2)],
      overrides: [], rotations: [{ rotationType: "General Radiography", settingCode: "GEN" }],
      sites: [{ employerId: "e1", siteName: "Moore Regional", agreementStatus: "secured", studentsAtOnce: 24, approvedCapacity: null, preceptors: 12 }],
      rooms: [{ id: "r1", name: "Lab 101", kind: "LAB", weeklyOpenHours: 50, capacity: 24 }, { id: "r2", name: "Room 1", kind: "CLASSROOM", weeklyOpenHours: 50, capacity: 40 }],
      ...supplyOver,
    },
    assumptions, ...over,
  };
}
const design = (o: Partial<ExpansionDesign> = {}): ExpansionDesign => ({ ...DEFAULT_DESIGN, targetWorkers: 20, targetYear: 2029, seats: 24, startIso: "2027-08-16", cohortsPerYear: 1, ...o });

describe("assumption registry", () => {
  it("resolves default → college → family → program → scenario, most specific wins, and marks the origin", () => {
    const rows: AssumptionRow[] = [
      { scope: "inst:i1", key: "facultyFullTimeAnnual", value: 90000, low: null, high: null, source: "HR", owner: "CFO", status: "verified", verifiedAt: "2026-08-01", reviewBy: "2027-08-01" },
      { scope: "program:p1", key: "facultyFullTimeAnnual", value: 95000, low: null, high: null, source: "dean", owner: "Dean", status: "estimate", verifiedAt: null, reviewBy: "2026-01-01" },
      { scope: "family:f1", key: "completionRate", value: 0.8, low: null, high: null, source: "IR", owner: null, status: "verified", verifiedAt: "2026-05-01", reviewBy: null },
    ];
    const a = resolveAssumptions(rows, { institutionId: "i1", familyId: "f1", programId: "p1" }, { rampMonths: 9 }, today);
    expect(a.facultyFullTimeAnnual).toMatchObject({ value: 95000, origin: "program", status: "estimate", stale: true });
    expect(a.completionRate).toMatchObject({ value: 0.8, origin: "family", status: "verified", stale: false });
    expect(a.rampMonths).toMatchObject({ value: 9, origin: "scenario", status: "estimate" });
    expect(a.licensureMonths).toMatchObject({ value: 3, origin: "default", status: "default" });
    expect(resolveAssumptions(rows, { institutionId: "i1" }, {}, today).facultyFullTimeAnnual).toMatchObject({ value: 90000, origin: "institution", status: "verified" });
    // The family's goal-plan rates count as the family's own estimate, never above a program's own figure.
    const b = applyFamilyRates(a, { completionRate: 0.75, licensureRate: 0.95 }, "Radiography");
    expect(b.completionRate.value).toBe(0.75); expect(b.licensureRate).toMatchObject({ value: 0.95, origin: "family" });
    expect(ASSUMPTION_DEFS.every((d) => d.low <= d.value && d.value <= d.high)).toBe(true);
    expect(confidenceOf([a.completionRate, a.rampMonths]).share).toBe(0.5);
  });
});

describe("expansion analysis", () => {
  it("dates the proposed cohorts on the calendar and repeats them yearly through the target year", () => {
    const inp = input();
    const { cohorts, rows } = proposeCohorts(inp, design({ targetYear: 2028 }));
    expect(cohorts.map((c) => c.startIso)).toEqual(["2027-08-16", "2028-08-16"]);
    expect(cohorts[0].terms).toHaveLength(2);
    expect(cohorts[0].terms[1].startIso.slice(0, 4)).toBe("2028");
    expect(cohorts[0].ladder.productive).toBeCloseTo(24 * 0.7 * 0.9 * 0.9 * 0.9);
    expect(cohorts[0].productiveByIso > cohorts[0].endIso).toBe(true);
    expect(rows.filter((r) => r.cohortId === "scenario:1" && r.session.kind === "CLINICAL")).toHaveLength(16);
  });

  it("finds nothing binding when supply covers the design, and reports outputs, time to impact and a cost per worker", () => {
    const r = evaluateExpansion(prepareExpansion(input()), design({ targetWorkers: 0 }), { searchMax: false });
    expect(r.feasible).toBe(true);
    expect(r.binding).toBeNull();
    expect(r.constraints.find((c) => c.kind === "faculty")!.severity).toBe("ok");
    expect(r.constraints.find((c) => c.kind === "clinical-seats")!.severity).toBe("ok");
    expect(r.constraints.find((c) => c.kind === "rooms")!.severity).toBe("ok");
    expect(r.outputs.additionalAnnualEnrollment).toBe(24);
    expect(r.outputs.additionalAnnualProductive).toBeCloseTo(24 * 0.7 * 0.9 * 0.9 * 0.9);
    expect(r.outputs.firstYearWorkersEnter).toBe(2029); // ends spring 2028 + 12 months of lags
    expect(r.outputs.facultyFteAdded).toBeGreaterThan(0);
    expect(r.outputs.learnerShifts).toBe(272); // a year's cohort: 17 students in term 2 (24 × 0.7 completion, sliding) × 16 Tuesday shifts
    expect(r.costs.recurring).toBeGreaterThan(0);
    expect(r.costs.perAdditionalCompleter).toBeGreaterThan(0);
    expect(r.milestones.some((m) => m.what.startsWith("Recruit"))).toBe(true);
    expect(r.confidence.used).toBeGreaterThan(5);
    expect(r.confidence.verified).toBe(0);
  });

  it("names faculty as the binding constraint with the week it binds, and the people to hire", () => {
    const r = evaluateExpansion(prepareExpansion(input({}, { instructors: [{ id: "f1", name: "A", employmentType: "full-time", contactHoursPerWeek: 4 }] })), design(), { searchMax: false });
    expect(r.feasible).toBe(false);
    expect(r.binding?.kind).toBe("faculty");
    expect(r.binding?.where).toMatch(/^week of/);
    expect(r.binding?.shortfall).toBeGreaterThanOrEqual(1);
    expect(r.binding?.fix).toMatch(/hire \d+ faculty/);
    expect(r.costs.lines.some((l) => l.category === "Faculty")).toBe(true);
    expect(r.milestones.some((m) => m.owner === "Dean and HR")).toBe(true);
  });

  it("distinguishes seats that exist but are not secured from seats that do not exist, by date and shift", () => {
    // Only 4 secured GEN seats a day; 8 more sit at an asked site.
    const base = input({}, { assets: [asset("a1", "e1", "Moore Regional", "secured", 2), asset("a2", "e1", "Moore Regional", "secured", 2), asset("b1", "e2", "Randolph", "asked", 4), asset("b2", "e2", "Randolph", "asked", 4)], sites: [{ employerId: "e1", siteName: "Moore Regional", agreementStatus: "secured", studentsAtOnce: 24, approvedCapacity: null, preceptors: 12 }, { employerId: "e2", siteName: "Randolph", agreementStatus: "asked", studentsAtOnce: null, approvedCapacity: null, preceptors: 6 }] });
    const d = design({ seats: 12 });
    const r = evaluateExpansion(prepareExpansion(base), d, { searchMax: false });
    const agreements = r.constraints.find((c) => c.kind === "agreements");
    expect(agreements).toBeDefined();
    expect(agreements!.severity).toBe("binding");
    expect(agreements!.where).toMatch(/Day · GEN$/);
    expect(agreements!.detail).toMatch(/Capacity exists; the agreements do not \(Randolph\)/);
    expect(r.outputs.sitesNeeded).toEqual(["Randolph"]);
    expect(r.milestones.some((m) => m.owner === "Clinical coordinator")).toBe(true);
    // Assuming Randolph secured (expanded geography) clears it; 24 seats still exceed every seat that exists.
    const ok = evaluateExpansion(prepareExpansion(base), { ...d, kind: "expanded-geography", assumedSecuredSiteIds: ["e2"] }, { searchMax: false });
    expect(ok.constraints.find((c) => c.kind === "agreements")).toBeUndefined();
    const tooBig = evaluateExpansion(prepareExpansion(base), { ...d, seats: 24, kind: "expanded-geography", assumedSecuredSiteIds: ["e2"] }, { searchMax: false });
    expect(tooBig.constraints.find((c) => c.kind === "clinical-seats")!.severity).toBe("binding");
  });

  it("counts the operating plan already on the sites before the new cohort — capacity overall is not capacity on the date", () => {
    // A running cohort of 30 (21 by term 2) already uses 21 of the 24 secured seats every Tuesday of spring 2028.
    const inp = input();
    const running = proposeCohorts(inp, design({ startIso: "2027-08-16", seats: 30, cohortsPerYear: 0, targetYear: 2027 })).rows.map((r) => ({ ...r, cohortId: "base", cohort: "Class of 2028" }));
    const withBase = input({ baselineRows: running, baselineCohorts: [{ cohortId: "base", cohort: "Class of 2028", programId: "p1", seats: 30, startIso: "2027-08-16", endIso: "2028-05-09", productiveGoal: 15, gradYear: 2028 }] });
    const r = evaluateExpansion(prepareExpansion(withBase), design({ seats: 8, cohortsPerYear: 0 }), { searchMax: false });
    const seats = r.constraints.find((c) => c.kind === "clinical-seats")!;
    expect(seats.severity).toBe("binding");
    expect(seats.detail).toMatch(/27 students vs 24 secured/);
    // The faculty roster also reads both cohorts' weeks together.
    expect(r.constraints.find((c) => c.kind === "faculty")!.demand).toBeGreaterThan(evaluateExpansion(prepareExpansion(inp), design({ seats: 8, cohortsPerYear: 0 }), { searchMax: false }).constraints.find((c) => c.kind === "faculty")!.demand!);
    // The context is shown, not implied: who is on the binding date, what else runs in the window, and the busiest weeks.
    expect(seats.demandBreakdown!.map((b) => [b.label, b.value, b.note])).toEqual([["Class of 2028", 21, "Radiography"], ["Proposed cohort 1 (Aug 16, 2027)", 6, "proposed"]]);
    expect(seats.supplyBreakdown).toEqual([{ label: "Moore Regional", value: 24, note: "secured · 12 assets" }]);
    expect(seats.how).toMatch(/date × shift × setting/);
    expect(r.concurrent).toHaveLength(1);
    expect(r.concurrent[0]).toMatchObject({ cohort: "Class of 2028", program: "Radiography", sameProgram: true, students: 30, overlapFrom: "2027-08-16" });
    expect(r.concurrent[0].bySetting.GEN).toBeGreaterThan(0);
    const fac = r.weeklyPeaks.filter((w) => w.resource === "faculty");
    expect(fac.length).toBe(4);
    expect(Math.abs(fac[0].total - (fac[0].baseline + fac[0].added))).toBeLessThan(0.11); // each figure rounded to 0.1
    expect(fac[0].cohorts.reduce((n, c) => n + c.value, 0)).toBeCloseTo(fac[0].total, 0);
    expect(r.constraints.every((c) => c.how.length > 20)).toBe(true);
    expect(r.settingNames).toEqual({ GEN: "General" });
    expect(r.supplySummary.faculty).toMatch(/2 active instructors/);
  });

  it("hybrid: online class hours drop room hours, keep the instructor, never touch clinical — and the rules say so", () => {
    const inp = input();
    const plain = evaluateExpansion(prepareExpansion(inp), design({ cohortsPerYear: 0 }), { searchMax: false });
    const hybrid = evaluateExpansion(prepareExpansion(inp), design({ kind: "hybrid", onlineShare: 0.5, cohortsPerYear: 0 }), { searchMax: false });
    const rooms = (r: typeof plain) => r.constraints.find((c) => c.kind === "rooms")!.demand!;
    const faculty = (r: typeof plain) => r.constraints.find((c) => c.kind === "faculty")!.demand!;
    const clinical = (r: typeof plain) => r.outputs.learnerShifts;
    expect(rooms(hybrid)).toBeLessThan(rooms(plain));
    expect(faculty(hybrid)).toBe(faculty(plain));           // credit factor defaults to 1: the instructor is still needed
    expect(clinical(hybrid)).toBe(clinical(plain));         // clinical is never online
    const half = evaluateExpansion(prepareExpansion({ ...inp, assumptions: { ...inp.assumptions, onlineContactHourFactor: { ...inp.assumptions.onlineContactHourFactor, value: 0.5 } } }), design({ kind: "hybrid", onlineShare: 0.5, cohortsPerYear: 0 }), { searchMax: false });
    expect(faculty(half)).toBeLessThan(faculty(plain));
    expect(hybrid.assumptionsUsed.some((a) => a.key === "onlineContactHourFactor")).toBe(true);
    const rule = (r: typeof plain, aspect: string) => r.rules.find((x) => x.aspect === aspect)!;
    expect(rule(hybrid, "Clinical sessions")).toMatchObject({ changed: false });
    expect(rule(hybrid, "Clinical sessions").rule).toMatch(/never delivered online/);
    expect(rule(hybrid, "Class sessions")).toMatchObject({ changed: true });
    expect(rule(hybrid, "Faculty contact hours").rule).toMatch(/100% of an in-person hour/);
    expect(rule(hybrid, "Operating plan").changed).toBe(false);
    expect(designRules(design({ kind: "evening-cohort" })).find((x) => x.aspect === "Clinical sessions")!.rule).toMatch(/evening block/);
  });

  it("says when the start is too soon and gives the earliest feasible start from the longest lead item", () => {
    const r = evaluateExpansion(prepareExpansion(input({}, { instructors: [] })), design({ startIso: "2026-10-05" }), { searchMax: false });
    expect(r.feasibleInTime).toBe(false);
    expect(r.constraints[0].kind).toBe("time");
    expect(r.earliestStartIso).toBe("2027-03-20"); // today + 26 weeks (faculty hire is the longest lead)
    expect(r.constraints[0].detail).toMatch(/longest lead item is hire \d+ faculty/);
    const ok = evaluateExpansion(prepareExpansion(input()), design({ startIso: "2027-02-08" }), { searchMax: false });
    expect(ok.earliestStartIso).toBe("2027-02-06"); // recruiting only: 20 weeks
    expect(ok.feasibleInTime).toBe(true);
  });

  it("works the pipeline backward from the target and says how many seats beyond the plan it needs", () => {
    const r = evaluateExpansion(prepareExpansion(input()), design({ targetWorkers: 30, seats: 24 }), { searchMax: false });
    const p = r.constraints.find((c) => c.kind === "pipeline")!;
    expect(r.outputs.required.productive).toBe(30);
    expect(r.outputs.required.seatsPerYear).toBeCloseTo(30 / (0.9 * 0.9 * 0.9 * 0.7 * 1.0));
    expect(p.demand).toBe(59);
    expect(p.severity).toBe("secondary");
    expect(p.fix).toMatch(/add 35 more seats a year/);
  });

  it("finds the largest cohort the design could run today, and models retention instead of seats", () => {
    const r = evaluateExpansion(prepareExpansion(input()), design({ targetWorkers: 0 }));
    expect(r.outputs.currentMaxFeasibleSeats).toBe(34); // 24 secured seats on a Tuesday ÷ 0.7 (term-2 enrollment of a 34-seat cohort is 24), then seats bind
    const ret = evaluateExpansion(prepareExpansion(input({ baselineCohorts: [{ cohortId: "b", cohort: "Class of 2028", programId: "p1", seats: 24, startIso: "2026-08-17", endIso: "2028-05-09", productiveGoal: 12, gradYear: 2028 }] })), design({ kind: "improve-retention", seats: 0, retentionUplift: 0.1, targetWorkers: 0 }), { searchMax: false });
    expect(ret.cohorts).toHaveLength(0);
    expect(ret.outputs.additionalAnnualEnrollment).toBe(0);
    expect(ret.outputs.additionalAnnualProductive).toBeCloseTo(24 * 0.1 * 0.9 * 0.9 * 0.9);
    expect(ret.feasible).toBe(true);
  });
});
