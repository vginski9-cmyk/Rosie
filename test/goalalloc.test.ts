import { describe, expect, it } from "vitest";
import { yearAllocations, offeringGoal, allocatedTotal, type Alloc } from "../src/lib/goalalloc";

const rad = { id: "co-rad", name: "Class of 2028", programId: "p-rad", goalProductive: 29, pipelineRates: JSON.stringify({ goal: 29, rates: {}, termOverrides: [] }) };

describe("a year's goal allocations (audit §1.10)", () => {
  it("folds an offering the plan does not know about in as a locked slot with its own goal", () => {
    const out = yearAllocations([], [rad]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ programId: "p-rad", goal: 29 });
    expect(out[0].offerings?.[0]).toMatchObject({ locked: true, cohortId: "co-rad", goal: 29 });
  });
  it("never counts an offering twice when the saved plan already references it", () => {
    const saved: Alloc[] = [{ programId: "p-rad", goal: 29, offerings: [{ startDate: "2026-08-17", goal: 29, locked: true, cohortId: "co-rad", cohortName: "Class of 2028" }] }];
    const out = yearAllocations(saved, [rad]);
    expect(out).toBe(saved);
    expect(out[0].offerings).toHaveLength(1);
    expect(allocatedTotal(out, (_a, o) => o.goal ?? 0, (a) => a.offerings ?? [])).toBe(29);
  });
  it("recognizes a legacy single-offering allocation by its cohortId too", () => {
    const saved: Alloc[] = [{ programId: "p-rad", goal: 29, startDate: "2026-08-17", locked: true, cohortId: "co-rad", cohortName: "Class of 2028" }];
    expect(yearAllocations(saved, [rad])).toBe(saved);
  });
  it("adds a second real offering of the same model next to the saved one and raises the model's goal", () => {
    const saved: Alloc[] = [{ programId: "p-rad", goal: 29, offerings: [{ startDate: "2026-08-17", goal: 29, locked: true, cohortId: "co-rad", cohortName: "Class of 2028" }] }];
    const out = yearAllocations(saved, [rad, { id: "co-rad-2", name: "Class of 2028 (2)", programId: "p-rad", goalProductive: 12, pipelineRates: null }]);
    expect(out[0].offerings).toHaveLength(2);
    expect(out[0].goal).toBe(41);
    expect(saved[0].offerings).toHaveLength(1); // the saved plan itself is untouched
  });
  it("reads an offering's goal from its saved pipeline, else its productive target", () => {
    expect(offeringGoal(rad)).toBe(29);
    expect(offeringGoal({ goalProductive: 12, pipelineRates: null })).toBe(12);
    expect(offeringGoal({ goalProductive: 12, pipelineRates: "{not json" })).toBe(12);
  });
});

import { spreadGoal, offeringsNeeded, sectionsFor, oneOfferingSlot } from "../src/lib/goalalloc";
import { BENCHMARK_RATES } from "../src/lib/northstar";

// A program dropped onto the goal plan adds ONE offering, planned on its own (the owner's call, 2026-11-12).
describe("one offering at a time", () => {
  const rates = { ...BENCHMARK_RATES, completionRate: 0.75, licensureRate: 1, placementRate: 1, productivityRate: 1 };
  it("plans a class at the model's max cohort and derives its productive share", () => {
    const slot = oneOfferingSlot({ maxCapacity: 20, remaining: 100, rates, numTerms: 5, startDate: "2027-08-16", campusId: "c1" });
    expect(slot.counts).toEqual({ enrolled: 20 });
    expect(slot.goal).toBeCloseTo(15, 6); // 20 × 0.75 × 1 × 1 × 1
    expect([slot.startDate, slot.campusId, slot.termOverrides]).toEqual(["2027-08-16", "c1", []]);
  });
  it("never covers more than the goal still leaves uncovered", () => {
    const slot = oneOfferingSlot({ maxCapacity: 20, remaining: 5, rates, numTerms: 5, startDate: null });
    expect(slot.counts).toEqual({ productive: 5 }); expect(slot.goal).toBe(5); expect(slot.campusId).toBeNull();
  });
  it("a model with no max cohort takes the remainder as its productive count", () => {
    const slot = oneOfferingSlot({ maxCapacity: null, remaining: 12, rates, numTerms: 2, startDate: null });
    expect(slot.counts).toEqual({ productive: 12 }); expect(slot.goal).toBe(12);
    expect(oneOfferingSlot({ maxCapacity: 20, remaining: -3, rates, numTerms: 2, startDate: null }).goal).toBe(0);
  });
});

// "Spread evenly" still splits a model's goal over its offerings on request.
describe("spreading a goal over offerings", () => {
  it("splits in whole workers, the first offerings taking the remainder", () => {
    expect(spreadGoal(30, 4)).toEqual([8, 8, 7, 7]);
    expect(spreadGoal(55, 11)).toEqual(Array(11).fill(5));
    expect(spreadGoal(0, 3)).toEqual([0, 0, 0]);
    expect(spreadGoal(7, 0)).toEqual([7]);
  });
  it("counts the offerings a seat need takes at a class size", () => {
    expect(offeringsNeeded(108, 10)).toBe(11); expect(offeringsNeeded(10, 10)).toBe(1); expect(offeringsNeeded(43, 41)).toBe(2); expect(offeringsNeeded(43, null)).toBe(1);
  });
  it("says how many sections an enrollment runs as, by the smallest session of each kind", () => {
    expect(sectionsFor(41, { CLASS: 41, LAB: 14, CLINICAL: 1 })).toEqual([{ kind: "CLASS", max: 41, sections: 1 }, { kind: "LAB", max: 14, sections: 3 }, { kind: "CLINICAL", max: 1, sections: 41 }]);
    expect(sectionsFor(10, undefined)).toEqual([]);
  });
});
