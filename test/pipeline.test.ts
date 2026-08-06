import { describe, it, expect } from "vitest";
import {
  deriveCohortTargets, cohortFacts, ladderPivot, healthFromPivot, yearSeasonPivot, yoyChange,
  type CohortFactInput,
} from "../src/lib/pipeline";
import { BENCHMARK_RATES, type LadderRates } from "../src/lib/northstar";

// The Cape Fear workbook's 2025 column (INPUT HERE_PROGRAM STRUCTURE, col E):
// productivity goal 80, five terms, and these exact rates. Every expected value
// below is read straight out of the workbook.
const CAPE_FEAR_RATES: LadderRates = {
  interestedSurplus: 1.25, qualifiedSurplus: 1.15, offeredSurplus: 1.1,
  enrollmentRate: 1.0, completionRate: 0.7, licensureRate: 1.0,
  placementRate: 0.9, productivityRate: 0.9,
};

describe("deriveCohortTargets — the workbook's backward chain, to the decimal", () => {
  const t = deriveCohortTargets(80, CAPE_FEAR_RATES, 5);
  it("walks backward from the productivity goal (rows 71→52)", () => {
    expect(t.productive).toBe(80);
    expect(t.placed).toBeCloseTo(88.8888888888, 6);        // E70
    expect(t.licensed).toBeCloseTo(98.7654320987, 6);      // E69
    expect(t.completing).toBeCloseTo(98.7654320987, 6);    // E68
    expect(t.terms[0]).toBeCloseTo(141.0934744268, 6);     // E56 (Term 1)
    expect(t.capacity).toBeCloseTo(141.0934744268, 6);     // E55
    expect(t.offered).toBeCloseTo(155.2028218694, 6);      // E54
    expect(t.qualified).toBeCloseTo(162.2574955908, 6);    // E53
    expect(t.interested).toBeCloseTo(176.3668430335, 6);   // E52
  });
  it("sheds a linear slice per term (rows 57–60)", () => {
    expect(t.terms[1]).toBeCloseTo(132.6278659611, 6);     // E57
    expect(t.terms[2]).toBeCloseTo(124.1622574955, 6);     // E58
    expect(t.terms[3]).toBeCloseTo(115.6966490299, 6);     // E59
    expect(t.terms[4]).toBeCloseTo(107.2310405643, 6);     // E60
    expect(t.terms.length).toBe(5);
  });
  it("records the derivation chain with real numbers for the lineage view", () => {
    expect(t.chain[0].formula).toContain("North-Star goal");
    expect(t.chain.find((c) => c.key === "placed")!.formula).toContain("÷ 0.9");
    expect(t.chain.find((c) => c.key === "interested")!.formula).toContain("× 1.25");
  });
});

const mkCohort = (over: Partial<CohortFactInput>): CohortFactInput => ({
  institution: "Sandhills", familyId: "f1", family: "Radiography",
  programId: "p1", program: "Radiography AAS", credential: "AAS",
  cohortId: "c1", cohort: "Class of 2027", endYear: 2027, season: "Fall",
  productiveGoal: 25, numTerms: 5,
  actuals: { interested: 60, qualified: 50, offered: 45, enrolled: 40, completing: 28, licensed: 25, placed: 22, productive: 20, terms: [40] },
  ...over,
});

describe("cohortFacts — the normalized long table", () => {
  const facts = cohortFacts(mkCohort({}), BENCHMARK_RATES);
  it("emits one row per metric plus one per term, in ladder order", () => {
    expect(facts.map((f) => f.metric).slice(0, 4)).toEqual(["interested", "qualified", "offered", "capacity"]);
    expect(facts.filter((f) => f.metric === "term").length).toBe(5);
    expect(facts[facts.length - 1].metric).toBe("productive");
  });
  it("stamps every target with its formula lineage", () => {
    const cap = facts.find((f) => f.metric === "capacity")!;
    expect(cap.targetSource).toContain("÷ 1 (enrollment rate)");
    const t3 = facts.find((f) => f.metric === "term" && f.termIndex === 3)!;
    expect(t3.targetSource).toContain("linear attrition");
  });
});

describe("ladderPivot — the health-metrics pivot with Grand Total", () => {
  const facts = [
    ...cohortFacts(mkCohort({}), BENCHMARK_RATES),
    ...cohortFacts(mkCohort({ cohortId: "c2", cohort: "Class of 2029", endYear: 2029, productiveGoal: 30, actuals: {} }), BENCHMARK_RATES),
  ];
  const p = ladderPivot(facts);
  it("sums normalized targets across cohorts per row", () => {
    const interested = p.rows.find((r) => r.metric === "interested")!;
    // capacity(25) ×1.5 + capacity(30) ×1.5, capacity = goal / (1×0.7×0.9×0.9×0.9)
    const cap25 = 25 / (0.7 * 0.9 * 0.9 * 0.9);
    const cap30 = 30 / (0.7 * 0.9 * 0.9 * 0.9);
    expect(interested.target).toBeCloseTo((cap25 + cap30) * 1.5, 6);
    expect(interested.parts.length).toBe(2);
  });
  it("nests term rows and includes them in the Grand Total (like the workbook)", () => {
    const termRows = p.rows.filter((r) => r.nested);
    expect(termRows.length).toBe(5);
    const rowSum = p.rows.reduce((s, r) => s + (r.target ?? 0), 0);
    expect(p.grandTotalTarget).toBeCloseTo(rowSum, 9);
  });
  it("keeps actuals separate — only the cohort with student data contributes", () => {
    const prod = p.rows.find((r) => r.metric === "productive")!;
    expect(prod.actual).toBe(20);
  });
});

describe("healthFromPivot — ratios staged from the pivot's own aggregates", () => {
  const facts = cohortFacts(mkCohort({}), BENCHMARK_RATES);
  const rows = healthFromPivot(ladderPivot(facts));
  it("computes target ratios that round-trip the input rates", () => {
    const by = (k: string) => rows.find((r) => r.key === k)!;
    expect(by("interestedSurplus").targetRatio).toBeCloseTo(1.5, 9);
    expect(by("completionRate").targetRatio).toBeCloseTo(0.7, 9);
    expect(by("utilization").targetRatio).toBeCloseTo(0.9 * 0.9 * 0.9 * 0.7, 9);
  });
  it("computes actual ratios from live counts with visible numerator ÷ denominator", () => {
    const comp = rows.find((r) => r.key === "completionRate")!;
    expect(comp.actualNum).toBe(28);
    expect(comp.actualDen).toBe(40); // term-1 actual
    expect(comp.actualRatio).toBeCloseTo(0.7, 9);
    expect(comp.healthy).toBe(true);
    expect(comp.formula).toContain("÷");
  });
  it("flags an unhealthy ratio against its benchmark", () => {
    const util = rows.find((r) => r.key === "utilization")!;
    // actual 20 productive ÷ 40 enrolled-capacity actual = 0.5 < 0.51
    expect(util.actualRatio).toBeCloseTo(0.5, 9);
    expect(util.healthy).toBe(false);
  });
});

describe("yearSeasonPivot — the OUTPUT VISUAL year → season structure", () => {
  const facts = [
    ...cohortFacts(mkCohort({}), BENCHMARK_RATES),
    ...cohortFacts(mkCohort({ cohortId: "c2", cohort: "Class of 2029", endYear: 2029, season: "Spring", productiveGoal: 30, actuals: {} }), BENCHMARK_RATES),
    ...cohortFacts(mkCohort({ cohortId: "c3", cohort: "Class of 2029 B", endYear: 2029, season: "Fall", productiveGoal: 10, actuals: {} }), BENCHMARK_RATES),
  ];
  const p = yearSeasonPivot(facts, "qualified");
  it("groups rows by end year then season with per-season sums", () => {
    expect(p.rows.map((r) => r.year)).toEqual([2027, 2029]);
    const y29 = p.rows[1];
    expect(y29.seasons.map((s) => s.season)).toEqual(["Spring", "Fall"]);
    expect(y29.target).toBeCloseTo(y29.seasons.reduce((s, x) => s + (x.target ?? 0), 0), 9);
  });
  it("grand-totals across all years", () => {
    expect(p.grandTotalTarget).toBeCloseTo(p.rows.reduce((s, r) => s + (r.target ?? 0), 0), 9);
  });
  it("uses term 1 when pivoting the term metric (no double counting)", () => {
    const pt = yearSeasonPivot(facts, "term");
    const cap25 = 25 / (0.7 * 0.9 * 0.9 * 0.9);
    expect(pt.rows[0].target).toBeCloseTo(cap25, 6);
  });
});

describe("yoyChange — (year ÷ prior year) − 1", () => {
  const facts = [
    ...cohortFacts(mkCohort({ endYear: 2027, productiveGoal: 25 }), BENCHMARK_RATES),
    ...cohortFacts(mkCohort({ cohortId: "c2", cohort: "Class of 2029", endYear: 2029, productiveGoal: 30, actuals: {} }), BENCHMARK_RATES),
  ];
  const { years, rows } = yoyChange(facts);
  it("computes the growth step between cohort years", () => {
    expect(years).toEqual([2027, 2029]);
    const prod = rows.find((r) => r.metric === "productive")!;
    expect(prod.changes[0]).toBeNull();
    expect(prod.changes[1]).toBeCloseTo(30 / 25 - 1, 9);
  });
});
