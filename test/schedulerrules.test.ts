import { describe, it, expect } from "vitest";
import { recommendPlan, DEFAULT_POLICY, type DemandUnit, type SchedulerInput, type Policy } from "../src/lib/scheduler";
import type { AssetLite } from "../src/lib/assetmap";
import { onlyRule, proposeRuleFromText, type SettingRuleSpec } from "../src/lib/settingrule";

// Synthetic fixtures: approved "A or B" etc. are fixture policies, not statements about any real program.
const asset = (o: Partial<AssetLite> & { id: string; employerId: string; facilityName: string }): AssetLite => ({
  externalId: o.id, settingCode: "BEDS", setting: "Med-surg", assetType: "Unit", assetNumber: 1, operatingRule: "Weekday Day", days: "Mon,Tue,Wed,Thu,Fri", shiftBlocks: "Day", hoursPerShift: 6,
  serves: null, learnersPerShift: 10, preceptorsPerShift: 1, dataSource: "VERIFIED", status: "active", agreementStatus: "secured", facilityStatus: "active", ring: "Core", county: "Carteret", ...o,
});
const spec = (rule: SettingRuleSpec["rule"], o: Partial<SettingRuleSpec> = {}): SettingRuleSpec => ({ rule, mixing: "allowed", continuity: "unknown", scope: "learner", sourceText: null, status: "reviewed", questions: [], ...o });
const AorB = spec({ kind: "any-of", settings: ["BEDS", "LTC"] });
const eligibleOf = (r: SettingRuleSpec) => (r.rule.kind === "only" ? [r.rule.setting] : r.rule.kind === "all-of" ? r.rule.components.map((c) => c.setting) : r.rule.settings);
const unit = (o: Partial<DemandUnit> & { id: string; date: string }, rule: SettingRuleSpec = AorB): DemandUnit => ({
  cohortId: "co1", cohort: "NA Fall", programId: "p1", program: "Nurse Aide I", familyId: "fam1",
  courseId: "c1", courseCode: "NAS 101", courseTitle: "Nurse Aide I", termIndex: 1, termName: "Fall", weekOfTerm: 1,
  sessionId: `s-${o.id}`, sessionTitle: null, sectionIndex: 1, sectionCount: 1,
  weekMonday: o.date, block: "Day", startTime: "07:00", hours: 6, originalDate: o.date,
  rotationType: "Acute MedSurg or LTC", settingCode: eligibleOf(rule)[0], rule, eligible: eligibleOf(rule), seats: 10, seatsPerSection: 10, seatStart: 1, sectionSeats: 10, preceptorsNeeded: 0, facultyNeeded: 1, clinicalMode: "Instructor-Led Clinical Group", holiday: null, moved: false, holidayMoved: null, ...o,
});
const base = (over: Partial<SchedulerInput> = {}, policy: Partial<Policy> = {}): SchedulerInput => ({
  demand: [], assets: [], overrides: [], existingBookings: [], preceptors: [], instructors: [{ id: "i1", name: "Instructor One", role: "instructor" }, { id: "i2", name: "Instructor Two", role: "instructor" }], students: [], familyAgreements: [], policy: { ...DEFAULT_POLICY, ...policy }, confirmedSettings: [{ employerId: "hosp", settingCode: "BEDS" }, { employerId: "snf", settingCode: "LTC" }], siteCaps: [], ...over,
});
const hospital = asset({ id: "h-beds", employerId: "hosp", facilityName: "Carteret Health", settingCode: "BEDS", learnersPerShift: 0 });
const snf = asset({ id: "snf-ltc", employerId: "snf", facilityName: "Crystal Coast SNF", settingCode: "LTC", setting: "Long-term care", learnersPerShift: 10 });
// Ten six-hour sessions on weekdays (the Carteret shape: 60 clinical hours per learner through ten sessions).
const mondays = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"];
const weekOf = (d: string) => (d < "2026-10-12" ? "2026-10-05" : "2026-10-12");
const tenSessions = (rule: SettingRuleSpec) => mondays.map((d, i) => unit({ id: `u${i + 1}`, date: d, weekMonday: weekOf(d) }, rule));

describe("the scheduler under explicit setting rules", () => {
  it("1. approved A OR B, mixing allowed; the hospital has no seat and the SNF has ten → all ten sessions land in LTC, no hospital-only bottleneck, demand stays 100 learner-shifts", () => {
    const plan = recommendPlan(base({ demand: tenSessions(AorB), assets: [hospital, snf] }));
    expect(plan.summary.demandSeats).toBe(100);
    expect(plan.assignments).toHaveLength(10); expect(plan.unmet).toHaveLength(0);
    expect(plan.assignments.every((x) => x.asset.settingCode === "LTC")).toBe(true);
    expect(plan.blockers.find((b) => b.kind === "requirement-unreviewed")).toBeUndefined();
    expect(plan.summary.readiness.ready).toBe(100);
  });
  it("2. the same wording unreviewed: placed conditionally, every shift flagged 'requirement-unreviewed', nothing ready", () => {
    const proposed = proposeRuleFromText("Acute MedSurg or LTC")!;
    const plan = recommendPlan(base({ demand: tenSessions(proposed), assets: [hospital, snf] }));
    expect(plan.assignments).toHaveLength(10);
    const b = plan.blockers.find((x) => x.kind === "requirement-unreviewed")!;
    expect(b.shifts).toBe(10); expect(b.blocking).toBe(true);
    expect(plan.summary.readiness.ready).toBe(0);
    expect(plan.assignments[0].readiness!.issues.join(" ")).toMatch(/not reviewed/);
  });
  it("A only: the SNF's LTC seats do not count and the reason names the missing asset", () => {
    const plan = recommendPlan(base({ demand: tenSessions(onlyRule("BEDS")), assets: [hospital, snf] }));
    expect(plan.assignments).toHaveLength(0);
    expect(plan.unmet.every((u) => u.reason === "closed-that-day" || u.reason === "full" || u.reason === "too-big")).toBe(true);
  });
  it("6. OR with no mixing and thirty hours of seats in each setting: the ten sessions cannot straddle both; the second half reads mixing-locked", () => {
    const halfHosp = asset({ id: "h2", employerId: "hosp", facilityName: "Carteret Health", settingCode: "BEDS", learnersPerShift: 10, days: "Mon,Tue,Wed,Thu,Fri" });
    // Hospital open only the first week, SNF only the second week (five shifts each = 30 hours each).
    const overrides = [...mondays.slice(5).map((d) => ({ assetId: "h2", date: d, shiftBlocks: "", note: null })), ...mondays.slice(0, 5).map((d) => ({ assetId: "snf-ltc", date: d, shiftBlocks: "", note: null }))];
    const noMix = spec({ kind: "any-of", settings: ["BEDS", "LTC"] }, { mixing: "forbidden" });
    const plan = recommendPlan(base({ demand: tenSessions(noMix), assets: [halfHosp, snf], overrides }));
    expect(plan.assignments).toHaveLength(5);
    expect(new Set(plan.assignments.map((x) => x.asset.settingCode)).size).toBe(1);
    expect(plan.unmet).toHaveLength(5); expect(plan.unmet.every((u) => u.reason === "mixing-locked")).toBe(true);
    expect(plan.unmet[0].fixes[0]).toMatch(/forbids mixing/);
    // with mixing allowed the same supply seats all ten, in both settings
    const mixed = recommendPlan(base({ demand: tenSessions(AorB), assets: [halfHosp, snf], overrides }));
    expect(mixed.assignments).toHaveLength(10); expect(new Set(mixed.assignments.map((x) => x.asset.settingCode)).size).toBe(2);
    // mixing unknown: placed in one setting only, and the rest say why
    const unknown = recommendPlan(base({ demand: tenSessions(spec({ kind: "any-of", settings: ["BEDS", "LTC"] }, { mixing: "unknown" })), assets: [halfHosp, snf], overrides }));
    expect(unknown.assignments).toHaveLength(5); expect(unknown.unmet[0].fixes[0]).toMatch(/confirm whether hours may be mixed/);
  });
  it("5. sixty hours, at least twenty in A, balance A/B: the A minimum is seated first, the rest goes wherever is eligible", () => {
    const hosp = asset({ id: "h3", employerId: "hosp", facilityName: "Carteret Health", settingCode: "BEDS", learnersPerShift: 10 });
    const pool = spec({ kind: "pool", settings: ["BEDS", "LTC"], minimums: [{ setting: "BEDS", quantity: 24 }] });
    const plan = recommendPlan(base({ demand: tenSessions(pool), assets: [hosp, snf] }));
    expect(plan.assignments).toHaveLength(10);
    const bedsHours = plan.assignments.filter((x) => x.asset.settingCode === "BEDS").reduce((n, x) => n + x.hours, 0);
    expect(bedsHours).toBeGreaterThanOrEqual(24);
    expect(plan.blockers.find((b) => b.kind === "setting-rule-unmet")).toBeUndefined();
  });
  it("7. one-site continuity: two eligible sites cannot jointly satisfy a one-site rotation — the plan flags it", () => {
    const hospA = asset({ id: "ha", employerId: "hosp", facilityName: "Carteret Health", settingCode: "BEDS", learnersPerShift: 10 });
    const hospB = asset({ id: "hb", employerId: "hosp2", facilityName: "Onslow Memorial", settingCode: "BEDS", learnersPerShift: 10 });
    const overrides = [...mondays.slice(5).map((d) => ({ assetId: "ha", date: d, shiftBlocks: "", note: null })), ...mondays.slice(0, 5).map((d) => ({ assetId: "hb", date: d, shiftBlocks: "", note: null }))];
    const oneSite = spec({ kind: "only", setting: "BEDS" }, { continuity: "one-site" });
    const plan = recommendPlan(base({ demand: tenSessions(oneSite), assets: [hospA, hospB], overrides, confirmedSettings: [{ employerId: "hosp", settingCode: "BEDS" }, { employerId: "hosp2", settingCode: "BEDS" }] }));
    expect(plan.assignments).toHaveLength(10);
    const b = plan.blockers.find((x) => x.kind === "setting-rule-unmet")!;
    expect(b).toBeDefined(); expect(b.examples[0]).toMatch(/spread over 2 sites/);
    expect(plan.summary.readiness.ready).toBe(0);
  });
  it("11. a flexible learner (A/B) and a restricted learner (A only) with one place each: B for the flexible one, A for the restricted one — no greedy dead end", () => {
    const hospOne = asset({ id: "h1", employerId: "hosp", facilityName: "Carteret Health", settingCode: "BEDS", learnersPerShift: 1 });
    const snfOne = asset({ id: "s1", employerId: "snf", facilityName: "Crystal Coast SNF", settingCode: "LTC", learnersPerShift: 1 });
    const flexible = unit({ id: "flex", date: "2026-10-05", sectionIndex: 1, seats: 1, seatsPerSection: 1, sectionSeats: 1, seatStart: 1, sessionId: "s-flex" }, AorB);
    const restricted = unit({ id: "restr", date: "2026-10-05", sectionIndex: 1, seats: 1, seatsPerSection: 1, sectionSeats: 1, seatStart: 1, sessionId: "s-restr", cohortId: "co2", cohort: "NA Evening", courseId: "c2", rotationType: "Med-Surg" }, onlyRule("BEDS"));
    const plan = recommendPlan(base({ demand: [flexible, restricted], assets: [hospOne, snfOne] }));
    expect(plan.assignments).toHaveLength(2); expect(plan.unmet).toHaveLength(0);
    expect(plan.assignments.find((x) => x.unit.id === "restr")!.asset.settingCode).toBe("BEDS");
    expect(plan.assignments.find((x) => x.unit.id === "flex")!.asset.settingCode).toBe("LTC");
  });
  it("17. instructor-led with no preceptor: no preceptor lever, blocker or fix; the instructor is what readiness asks for", () => {
    const plan = recommendPlan(base({ demand: tenSessions(AorB), assets: [snf], instructors: [] }));
    expect(plan.assignments).toHaveLength(10);
    const b = plan.blockers.find((x) => x.kind === "unprecepted")!;
    expect(b.examples[0]).not.toMatch(/precept/i);
    expect(plan.assignments[0].readiness!.issues).toContain("no instructor by name");
    expect(plan.summary.preceptorShifts).toBe(0);
  });
});

describe("the evaluation service inside the plan (R7)", () => {
  const unrestricted = [{ employerId: "snf", familyId: "fam1", studentsAtOnce: null, approvedCapacity: null, studentsAtOnceMode: "unrestricted" as const }];
  it("a fully placed, staffed, confirmed plan with a known limit passes every check; with no limit on record the same plan is an evidence gap, never a pass", () => {
    const known = recommendPlan(base({ demand: tenSessions(AorB), assets: [hospital, snf], siteCaps: unrestricted }));
    expect(known.evaluation.summary).toMatchObject({ placements: 10, pass: 10, fail: 0, unknown: 0, conflictPlacements: 0, gapOnlyPlacements: 0 });
    const blank = recommendPlan(base({ demand: tenSessions(AorB), assets: [hospital, snf] }));
    expect(blank.evaluation.summary).toMatchObject({ placements: 10, pass: 0, fail: 0, unknown: 10, conflictPlacements: 0, gapOnlyPlacements: 10 });
    const gap = blank.evaluation.summary.byCode.find((t) => t.code === "CAPACITY_UNKNOWN")!;
    expect(gap.kind).toBe("gap"); expect(gap.placements).toBe(10);
    expect(blank.evaluation.contract.assumptions.join(" ")).toMatch(/seats only/);
    expect(blank.evaluation.contract.complete).toBe(true);
    expect(blank.evaluation.contract.requirementVersions[0]).toMatch(/Acute MedSurg or LTC: .*\[reviewed\]/);
  });
  it("unplaced sections carry structured codes; unique placements are counted apart from occurrences", () => {
    const proposed = { ...spec({ kind: "only", setting: "BEDS" }, { continuity: "one-site" }), status: "proposed" as const };
    const hospA = asset({ id: "ha", employerId: "hosp", facilityName: "Carteret Health", settingCode: "BEDS", learnersPerShift: 10 });
    const hospB = asset({ id: "hb", employerId: "hosp2", facilityName: "Onslow Memorial", settingCode: "BEDS", learnersPerShift: 10 });
    const overrides = [...mondays.slice(5).map((d) => ({ assetId: "ha", date: d, shiftBlocks: "", note: null })), ...mondays.slice(0, 5).map((d) => ({ assetId: "hb", date: d, shiftBlocks: "", note: null }))];
    const plan = recommendPlan(base({ demand: tenSessions(proposed), assets: [hospA, hospB], overrides, siteCaps: [] }));
    const s = plan.evaluation.summary;
    expect(s.placements).toBe(10); expect(s.conflictPlacements).toBe(10);
    expect(s.occurrences).toBeGreaterThanOrEqual(30); // unreviewed + continuity + limit unknown on every placement
    expect(s.byCode.find((t) => t.code === "CONTINUITY_UNMET")).toMatchObject({ placements: 10, occurrences: 10, kind: "conflict" });
    expect(s.byCode.find((t) => t.code === "REQUIREMENT_UNREVIEWED")).toMatchObject({ placements: 10, kind: "gap" });
    expect(s.byCode[0].kind).toBe("conflict"); // conflicts sort before gaps
    // nothing seated at all: every section fails on the capacity check with the code its unmet reason means
    const none = recommendPlan(base({ demand: tenSessions(onlyRule("BEDS")), assets: [hospital, snf] }));
    expect(none.evaluation.summary.conflictPlacements).toBe(10);
    expect(none.evaluation.placements.every((p) => p.reasons.some((r) => ["CAPACITY_EXHAUSTED", "UNAVAILABLE", "NO_ELIGIBLE_SUPPLY"].includes(r.code)))).toBe(true);
  });
  it("an eligible alternative that exists only at an excluded site is recommended before a new agreement; counting it in is an assumption, never access", () => {
    const askedSnf = { ...snf, agreementStatus: "asked" };
    const secured = recommendPlan(base({ demand: tenSessions(AorB), assets: [hospital, askedSnf] }));
    expect(secured.unmet).toHaveLength(10);
    expect(secured.evaluation.recommendations.some((r) => /alternative setting.*LTC/.test(r.label))).toBe(true);
    expect(secured.evaluation.recommendations.every((r) => !/preceptor/i.test(r.label))).toBe(true);
    expect(secured.evaluation.rolesRequired).toEqual(["instructor"]);
    const scenario = recommendPlan(base({ demand: tenSessions(AorB), assets: [hospital, askedSnf], siteCaps: unrestricted }, { agreements: "secured+asked" }));
    expect(scenario.assignments).toHaveLength(10);
    const t = scenario.evaluation.summary.byCode.find((x) => x.code === "SCENARIO_ASSUMED_ACCESS")!;
    expect(t.kind).toBe("assumption"); expect(t.placements).toBe(10);
    expect(scenario.evaluation.summary.pass).toBe(0); expect(scenario.evaluation.summary.unknown).toBe(10);
    expect(scenario.evaluation.contract.assumptions.join(" ")).toMatch(/asked agreements count as access — an assumption/);
  });
});

describe("the minimum-first preference and the site's students-at-once (the 55.8% vs 0.75× audit)", () => {
  const hosp10 = asset({ id: "h10", employerId: "hosp", facilityName: "Carteret Health", settingCode: "BEDS", learnersPerShift: 10 });
  const pool = spec({ kind: "pool", settings: ["BEDS", "LTC"], minimums: [{ setting: "BEDS", quantity: 24 }] });
  const twoSections = (d: string) => [unit({ id: "a", date: d }, pool), unit({ id: "b", date: d, sectionIndex: 2, seatStart: 11, sessionId: "s-a" }, pool)];
  it("a minimum still short never refuses a free seat in another eligible setting: BEDS full that shift → the second section lands in LTC, not 'full'", () => {
    const plan = recommendPlan(base({ demand: twoSections("2026-10-05"), assets: [hosp10, snf] }));
    expect(plan.unmet).toHaveLength(0); expect(plan.assignments).toHaveLength(2);
    expect(plan.assignments.map((x) => x.asset.settingCode).sort()).toEqual(["BEDS", "LTC"]);
    expect(plan.assignments.find((x) => x.asset.settingCode === "BEDS")!.reason).toMatch(/BEDS minimum still to meet/);
  });
  it("the minimum's setting still goes first while it has a free seat for the whole section", () => {
    const plan = recommendPlan(base({ demand: [unit({ id: "a", date: "2026-10-05" }, pool)], assets: [hosp10, snf] }));
    expect(plan.assignments[0].asset.settingCode).toBe("BEDS");
  });
  it("rooms free but the site's approved students-at-once reached: the reason is 'site-cap', the fix names the cap, and the lined-up ceiling stops at the cap", () => {
    const caps = [{ employerId: "hosp", familyId: "fam1", studentsAtOnce: 5, approvedCapacity: null, studentsAtOnceMode: "known" as const }];
    const plan = recommendPlan(base({ demand: [unit({ id: "a", date: "2026-10-05" }, onlyRule("BEDS"))], assets: [hosp10], siteCaps: caps }));
    expect(plan.assignments).toHaveLength(0); expect(plan.unmet).toHaveLength(1);
    expect(plan.unmet[0].reason).toBe("site-cap");
    expect(plan.unmet[0].detail).toMatch(/free rooms that shift but its approved students-at-once is already reached/);
    expect(plan.unmet[0].fixes[0]).toMatch(/students-at-once/);
    const c = plan.summary.capacity;
    expect(c.supplySeatsOnDemandDays).toBe(10); expect(c.supplySeatsLinedUp).toBe(5); expect(c.demandSeats).toBe(10);
  });
  it("the lined-up ceiling sits between placed and the raw supply, and never above demand", () => {
    const plan = recommendPlan(base({ demand: tenSessions(AorB), assets: [hospital, snf] }));
    const c = plan.summary.capacity;
    expect(c.supplySeatsLinedUp).toBeGreaterThanOrEqual(plan.summary.placedSeats);
    expect(c.supplySeatsLinedUp).toBeLessThanOrEqual(c.supplySeatsOnDemandDays);
    expect(c.supplySeatsLinedUp).toBeLessThanOrEqual(c.demandSeats);
    expect(c.supplySeatsLinedUp).toBe(100);
    // a seat on a day nothing needs it is not lined up: the SNF's seats on the other weekdays do not count
    expect(c.supplySeatsOnDemandDays).toBe(100);
    // forty students, twenty-four seats: the raw supply says 24, lined up says 24, and a second date with no demand adds nothing
    const wide = asset({ id: "w", employerId: "snf", facilityName: "Crystal Coast SNF", settingCode: "LTC", learnersPerShift: 24 });
    const four = [1, 2, 3, 4].map((i) => unit({ id: `q${i}`, date: "2026-10-05", sectionIndex: i, seatStart: (i - 1) * 10 + 1, sessionId: "s-q" }, AorB));
    const p2 = recommendPlan(base({ demand: four, assets: [wide] }));
    expect(p2.summary.demandSeats).toBe(40); expect(p2.summary.capacity.supplySeatsOnDemandDays).toBe(24); expect(p2.summary.capacity.supplySeatsLinedUp).toBe(24);
    expect(p2.summary.placedSeats).toBe(20); // instructor-led sections of ten cannot split: two fit, two do not
    expect(p2.unmet.every((u) => u.reason === "full")).toBe(true);
  });
});
