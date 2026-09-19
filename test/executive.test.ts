import { describe, it, expect } from "vitest";
import { summarizeScenario, chooseScenario, targetFor, targetsAtRisk, bindingRollup, rankInterventions, evidenceGaps, type ScenarioLite, type FamilyTarget } from "../src/lib/executive";
import { requireOperational, OPERATIONAL } from "../src/lib/mode";
import type { ExpansionResult } from "../src/lib/expansion";

// The executive view (Phase 13) rests on the saved scenarios. These checks pin the rules: a target
// without an evaluated scenario is "not assessed" (its shortfall is unknown, not zero); the
// recommended scenario is the one the answer rests on; interventions rank by cost per placed
// worker; a binding constraint rolls up by kind.

const OUTPUTS: ExpansionResult["outputs"] = { currentMaxFeasibleSeats: 30, proposedSeats: 24, additionalAnnualEnrollment: 24, additionalAnnualCompletions: 20, additionalAnnualLicensed: 18, additionalAnnualPlaced: 16, additionalAnnualProductive: 14, firstYearWorkersEnter: 2029, steadyStateYear: 2030, facultyFteAdded: 1, facultyPeopleAdded: 1, preceptorFteAdded: 0.5, preceptorPeopleAdded: 2, learnerShifts: 100, settingsNeeded: [], sitesNeeded: [], roomHoursPerWeekPeak: 10, studentSupportSeats: 24, required: { productive: 40, placed: 44, licensed: 48, completing: 52, enrolled: 60, offered: 66, qualified: 75, interested: 90, seatsPerYear: 60 }, baselineAnnualProductive: 20 };
const COSTS: ExpansionResult["costs"] = { lines: [], oneTime: 50000, recurring: 120000, annualized: 130000, perAdditionalCompleter: 6500, perAdditionalPlaced: 8125 };
const CONFIDENCE: ExpansionResult["confidence"] = { share: 0.6, verified: 6, used: 10, unverified: ["completionRate"], stale: [], risks: [] };
const result = (over: Partial<Omit<ExpansionResult, "outputs" | "costs" | "confidence">> & { outputs?: Partial<ExpansionResult["outputs"]>; costs?: Partial<ExpansionResult["costs"]>; confidence?: Partial<ExpansionResult["confidence"]> }): ExpansionResult => {
  const { outputs, costs, confidence, ...rest } = over;
  return {
    feasible: true, feasibleInTime: true, headline: "yes", binding: null, constraints: [], cohorts: [],
    earliestStartIso: "2027-08-16", proposedStartIso: "2027-08-16", milestones: [], assumptionsUsed: [],
    trace: [], summary: "", rules: [], concurrent: [], weeklyPeaks: [], settingNames: {}, window: null, asOf: "2026-09-19",
    supplySummary: { faculty: "", preceptors: "", sites: "", assets: "", rooms: "" },
    ...rest,
    outputs: { ...OUTPUTS, ...outputs }, costs: { ...COSTS, ...costs }, confidence: { ...CONFIDENCE, ...confidence },
  };
};

const lite = (over: Partial<ScenarioLite>): ScenarioLite => ({
  id: "s1", name: "One more cohort", status: "draft", notes: null, programId: "p1", program: "Radiography", institutionId: "i1", institution: "Sandhills", familyId: "f1", family: "Radiologic technologists",
  design: { kind: "additional-cohort", targetWorkers: 40, targetYear: 2029, startIso: "2027-08-16", seats: 24, cohortsPerYear: 1, paceFactor: 1, onlineShare: 0, assumedSecuredSiteIds: [], retentionUplift: 0, needsApproval: false },
  result: result({}), evaluatedAt: "2026-09-19T00:00:00.000Z", updatedAt: "2026-09-19T00:00:00.000Z", ...over,
});
const family: FamilyTarget = { familyId: "f1", family: "Radiologic technologists", job: "Radiologic Technologists", institutionId: "i1", institution: "Sandhills", programs: [{ id: "p1", name: "Radiography" }], goalsByYear: { 2026: 30, 2029: 40 } };

describe("executive: targets at risk", () => {
  it("a target with no evaluated scenario is not assessed — its shortfall is unknown, not zero", () => {
    const [t] = targetsAtRisk([family], [summarizeScenario(lite({ result: null, evaluatedAt: null }))], 2029);
    expect(t.status).toBe("unassessed");
    expect(t.expectedShortfall).toBeNull();
    expect(t.baseline).toBeNull();
    expect(t.scenarios).toBe(1);
  });
  it("a target with no goal for the year is 'no-target'; the latest earlier goal is used when one exists", () => {
    expect(targetFor({ 2026: 30, 2029: 40 }, 2029)).toBe(40);
    expect(targetFor({ 2026: 30 }, 2029)).toBe(30);
    expect(targetFor({}, 2029)).toBeNull();
    const [t] = targetsAtRisk([{ ...family, goalsByYear: {} }], [summarizeScenario(lite({}))], 2029);
    expect(t.status).toBe("no-target");
  });
  it("shortfall = target − baseline; a recommended scenario that closes it in time makes the target 'covered'", () => {
    const rec = summarizeScenario(lite({ status: "recommended", result: result({ outputs: { additionalAnnualProductive: 25, baselineAnnualProductive: 20 } }) }));
    const [t] = targetsAtRisk([family], [rec], 2029);
    expect(t.expectedShortfall).toBe(20);
    expect(t.shortfallAfter).toBe(0);
    expect(t.status).toBe("covered");
    expect(t.chosen?.id).toBe("s1");
  });
  it("a scenario that does not close the gap leaves the target at risk, with the remainder stated", () => {
    const s = summarizeScenario(lite({ result: result({ outputs: { additionalAnnualProductive: 5, baselineAnnualProductive: 20 } }) }));
    const [t] = targetsAtRisk([family], [s], 2029);
    expect(t.status).toBe("at-risk");
    expect(t.shortfallAfter).toBe(15);
  });
  it("a baseline that already meets the target is on track", () => {
    const s = summarizeScenario(lite({ result: result({ outputs: { baselineAnnualProductive: 45 } }) }));
    expect(targetsAtRisk([family], [s], 2029)[0].status).toBe("on-track");
  });
  it("at-risk targets sort first, then unassessed, then covered", () => {
    const fams: FamilyTarget[] = [{ ...family, familyId: "a", job: "A", programs: [{ id: "pa", name: "A" }] }, { ...family, familyId: "b", job: "B", programs: [{ id: "pb", name: "B" }] }, { ...family, familyId: "c", job: "C", programs: [{ id: "pc", name: "C" }] }];
    const xs = [
      summarizeScenario(lite({ id: "sa", programId: "pa", familyId: "a", status: "recommended", result: result({ outputs: { additionalAnnualProductive: 25 } }) })),
      summarizeScenario(lite({ id: "sb", programId: "pb", familyId: "b", result: null, evaluatedAt: null })),
      summarizeScenario(lite({ id: "sc", programId: "pc", familyId: "c", result: result({ outputs: { additionalAnnualProductive: 1 } }) })),
    ];
    expect(targetsAtRisk(fams, xs, 2029).map((t) => t.status)).toEqual(["at-risk", "unassessed", "covered"]);
  });
});

describe("executive: choosing, binding, ranking, evidence", () => {
  it("the recommended scenario wins; otherwise the best evaluated (in time, feasible, most workers); archived ones never", () => {
    const a = summarizeScenario(lite({ id: "a", result: result({ feasibleInTime: false, outputs: { additionalAnnualProductive: 30 } }) }));
    const b = summarizeScenario(lite({ id: "b", result: result({ outputs: { additionalAnnualProductive: 10 } }) }));
    const c = summarizeScenario(lite({ id: "c", status: "archived", result: result({ outputs: { additionalAnnualProductive: 99 } }) }));
    expect(chooseScenario([a, b, c])?.id).toBe("b");
    const r = summarizeScenario(lite({ id: "r", status: "recommended", result: null, evaluatedAt: null }));
    expect(chooseScenario([a, b, r])?.id).toBe("b"); // a recommended scenario never evaluated cannot carry the answer
    expect(chooseScenario([r, summarizeScenario(lite({ id: "d", result: null, evaluatedAt: null }))])?.id).toBe("r");
    const re = summarizeScenario(lite({ id: "re", status: "recommended", result: result({ outputs: { additionalAnnualProductive: 1 } }) }));
    expect(chooseScenario([a, b, re])?.id).toBe("re");
    expect(chooseScenario([])).toBeNull();
  });
  it("binding constraints roll up by kind, most common first, naming each program's shortfall and fix", () => {
    const bind = (kind: "faculty" | "preceptors", shortfall: number) => ({ kind, severity: "binding" as const, label: kind, demand: 10, supply: 10 - shortfall, unit: "FTE", where: "week of Sep 7, 2027", detail: "", fix: "hire", shortfall, evidence: "estimate" as const, how: "" });
    const xs = [
      summarizeScenario(lite({ id: "1", programId: "p1", result: result({ binding: bind("faculty", 1.2) }) })),
      summarizeScenario(lite({ id: "2", programId: "p2", program: "Surgical Technology", result: result({ binding: bind("faculty", 0.4) }) })),
      summarizeScenario(lite({ id: "3", programId: "p3", program: "Nurse Aide I", result: result({ binding: bind("preceptors", 3) }) })),
      summarizeScenario(lite({ id: "4", programId: "p4", result: null, evaluatedAt: null })),
    ];
    const roll = bindingRollup(xs);
    expect(roll.map((r) => r.kind)).toEqual(["faculty", "preceptors"]);
    expect(roll[0].programs.map((p) => p.program)).toEqual(["Radiography", "Surgical Technology"]);
    expect(roll[0].programs[0]).toMatchObject({ shortfall: 1.2, unit: "FTE", fix: "hire", evidence: "estimate" });
  });
  it("interventions rank feasible scenarios by cost per placed worker, then by workers added; infeasible and archived ones are left out", () => {
    const xs = [
      summarizeScenario(lite({ id: "cheap", result: result({ costs: { perAdditionalPlaced: 5000 } }) })),
      summarizeScenario(lite({ id: "dear", result: result({ costs: { perAdditionalPlaced: 20000 } }) })),
      summarizeScenario(lite({ id: "nocost", result: result({ costs: { perAdditionalPlaced: null }, outputs: { additionalAnnualProductive: 3 } }) })),
      summarizeScenario(lite({ id: "infeasible", result: result({ feasible: false, costs: { perAdditionalPlaced: 1 } }) })),
      summarizeScenario(lite({ id: "archived", status: "archived", result: result({ costs: { perAdditionalPlaced: 1 } }) })),
      summarizeScenario(lite({ id: "nothing", result: result({ outputs: { additionalAnnualProductive: 0 }, costs: { perAdditionalPlaced: 1 } }) })),
    ];
    expect(rankInterventions(xs).map((s) => s.id)).toEqual(["cheap", "dear", "nocost"]);
  });
  it("evidence gaps name each unverified assumption once with the programs that use it, stale ones, provisional calendars and estimated site inputs", () => {
    const xs = [
      summarizeScenario(lite({ id: "1", program: "Radiography", result: result({ confidence: { unverified: ["completionRate", "facultySalary"], stale: ["preceptorRatio"] } }) })),
      summarizeScenario(lite({ id: "2", program: "Surgical Technology", result: result({ confidence: { unverified: ["completionRate"], risks: ["accreditor approval needed"] } }) })),
    ];
    const gaps = evidenceGaps(xs, [{ id: "x", severity: "info", kind: "unverified-input", institutionId: "i1", institution: "Sandhills", familyId: null, family: null, title: "3 secured sites have no confirmed staff count", detail: "", href: "/clinical", fix: "", count: 3 }], [{ institutionId: "i1", institution: "Sandhills", level: "provisional", text: "no calendar" }, { institutionId: "i2", institution: "Lenoir", level: "ok", text: "" }]);
    const byLabel = Object.fromEntries(gaps.map((g) => [g.label, g]));
    expect(byLabel.completionRate).toMatchObject({ kind: "assumption", count: 2 });
    expect(byLabel.completionRate.detail).toContain("Radiography, Surgical Technology");
    expect(byLabel.facultySalary.count).toBe(1);
    expect(byLabel.preceptorRatio.kind).toBe("stale");
    expect(gaps.some((g) => g.kind === "calendar" && g.label.startsWith("Sandhills"))).toBe(true);
    expect(gaps.some((g) => g.label.startsWith("Lenoir"))).toBe(false);
    expect(gaps.some((g) => g.kind === "site" && g.count === 3)).toBe(true);
    expect(byLabel["accreditor approval needed"].kind).toBe("risk");
    expect(gaps[0].kind).toBe("assumption");
  });
  it("summarizeScenario keeps unmeasured figures null and names the design kind", () => {
    const s = summarizeScenario(lite({ result: null, evaluatedAt: null }));
    expect(s.evaluated).toBe(false);
    expect(s.feasible).toBeNull();
    expect(s.baselineAnnualProductive).toBeNull();
    expect(s.perAdditionalPlaced).toBeNull();
    expect(s.kindLabel).toBe("Additional annual cohort");
  });
});

describe("the product boundary", () => {
  it("the strategic product refuses operational writes unless ROSIE_OPERATIONAL=1", () => {
    if (OPERATIONAL) { expect(() => requireOperational()).not.toThrow(); return; }
    expect(() => requireOperational()).toThrow(/operational module/);
  });
});
