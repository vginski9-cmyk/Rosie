import { describe, expect, it } from "vitest";
import { BENCHMARK_RATES, familyRatesOf } from "../src/lib/northstar";
import { deriveCohortTargets } from "../src/lib/pipeline";
import { PLAN_STAGES, cleanCounts, countsOfPlan, fixedStages, solveLadder } from "../src/lib/pipelinecounts";

// An offering planned in counts: whatever is typed stands, the rest derives from the family's rates, and the rates the
// final ladder implies are what the offering stores (lib/pipelinecounts).

const RAD = { ...BENCHMARK_RATES, completionRate: 0.87, licensureRate: 0.9, placementRate: 0.9, productivityRate: 0.9 };
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe("solveLadder", () => {
  it("with nothing typed is the backward chain from the goal, as before", () => {
    const s = solveLadder({ goal: 15, rates: RAD, counts: {}, numTerms: 5 });
    const t = deriveCohortTargets(15, RAD, 5);
    expect(s.fixed).toEqual([]);
    close(s.ladder.productive, 15); close(s.ladder.placed, t.placed); close(s.ladder.licensed, t.licensed); close(s.ladder.completing, t.completing);
    close(s.ladder.enrolled, t.terms[0]); close(s.capacity, t.capacity); close(s.ladder.interested, t.interested);
    expect(s.terms).toEqual(t.terms);
    expect(s.rates).toEqual(RAD);
    expect(s.goal).toBe(15);
    expect(s.formula.productive).toMatch(/North-Star goal/);
  });
  it("'enrolled 10, completing 7, placed 5': the typed rows stand, licensed follows completing at the family rate, productive follows placed, the upper rows follow enrolled", () => {
    const s = solveLadder({ goal: 15, rates: BENCHMARK_RATES, counts: { enrolled: 10, completing: 7, placed: 5 }, numTerms: 2 });
    expect(s.fixed).toEqual(["enrolled", "completing", "placed"]);
    close(s.ladder.interested, 15); close(s.ladder.qualified, 12.5); close(s.ladder.offered, 11);
    expect([s.ladder.enrolled, s.ladder.completing, s.ladder.placed]).toEqual([10, 7, 5]);
    close(s.ladder.licensed, 6.3); close(s.ladder.productive, 4.5);
    close(s.capacity, 10);
    // The rates the counts imply.
    close(s.rates.completionRate, 0.7); close(s.rates.licensureRate, 0.9); close(s.rates.placementRate, 5 / 6.3); close(s.rates.productivityRate, 0.9);
    close(s.rates.interestedSurplus, 1.5); close(s.rates.enrollmentRate, 1);
    close(s.goal, 4.5);
    expect(s.terms).toEqual([10, 8.5]); // linear attrition from 10 to 7 over two terms
    expect(s.formula.enrolled).toBe("typed for this offering");
    expect(s.formula.licensed).toMatch(/7 completing × 90 %/);
  });
  it("the partner's small class — 8 enrolled, 6 completing, 6 licensed, 6 placed, 6 productive — implies 75 % completion and 100 % after, 8 seats", () => {
    const s = solveLadder({ goal: 6, rates: RAD, counts: { enrolled: 8, completing: 6, licensed: 6, placed: 6, productive: 6 }, numTerms: 3 });
    close(s.rates.completionRate, 0.75); expect([s.rates.licensureRate, s.rates.placementRate, s.rates.productivityRate]).toEqual([1, 1, 1]);
    close(s.capacity, 8); close(s.goal, 6); close(s.ladder.interested, 12);
  });
  it("productive typed alone is the goal-driven ladder; enrolled typed alone runs the family rates forward", () => {
    const p = solveLadder({ goal: 1, rates: RAD, counts: { productive: 15 }, numTerms: 5 });
    const t = deriveCohortTargets(15, RAD, 5);
    close(p.ladder.enrolled, t.terms[0]); close(p.ladder.interested, t.interested); close(p.goal, 15);
    expect(p.rates).toEqual(RAD);
    const e = solveLadder({ goal: 15, rates: RAD, counts: { enrolled: 20 }, numTerms: 5 });
    close(e.ladder.completing, 17.4); close(e.ladder.productive, 20 * 0.87 * 0.9 * 0.9 * 0.9); close(e.ladder.qualified, 25);
    expect(e.rates).toEqual(RAD);
  });
  it("a zero count keeps the family rate rather than dividing by zero", () => {
    const s = solveLadder({ goal: 15, rates: RAD, counts: { enrolled: 0 }, numTerms: 2 });
    expect(PLAN_STAGES.map((k) => s.ladder[k])).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(s.rates).toEqual(RAD);
  });
  it("an own rate from an earlier plan is honored under the counts", () => {
    const s = solveLadder({ goal: 15, rates: { ...RAD, completionRate: 0.5 }, counts: { enrolled: 10 }, numTerms: 2 });
    close(s.ladder.completing, 5); close(s.rates.completionRate, 0.5);
  });
});

describe("counts of a saved plan", () => {
  it("keeps only finite numbers and reads an older plan's term-1 override as the enrolled count", () => {
    expect(cleanCounts({ enrolled: 10, completing: null, placed: Number.NaN, productive: -2 } as never)).toEqual({ enrolled: 10, productive: 0 });
    expect(fixedStages({ placed: 5, enrolled: 10 })).toEqual(["enrolled", "placed"]);
    expect(countsOfPlan({ termOverrides: [12, null] })).toEqual({ enrolled: 12 });
    expect(countsOfPlan({ counts: { enrolled: 9 }, termOverrides: [12] })).toEqual({ enrolled: 9 });
    expect(countsOfPlan(null)).toEqual({});
  });
  it("familyRatesOf puts the plan's goal rates over the benchmarks and shrugs at a missing or broken plan", () => {
    expect(familyRatesOf(JSON.stringify({ goal: { completionRate: 0.87 } }))).toEqual({ ...BENCHMARK_RATES, completionRate: 0.87 });
    expect(familyRatesOf(null)).toEqual(BENCHMARK_RATES);
    expect(familyRatesOf("{not json")).toEqual(BENCHMARK_RATES);
  });
});
