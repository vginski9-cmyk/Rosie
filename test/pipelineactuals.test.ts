import { describe, it, expect } from "vitest";
import { reachedIndex, stageActuals } from "../src/lib/pipelineactuals";

describe("pipeline actuals from learner records", () => {
  it("counts each record at every stage it reached, blank beyond the furthest", () => {
    const a = stageActuals([
      { status: "prospect", stageKey: "interested", cohortId: null },
      { status: "applicant", stageKey: "qualified", cohortId: null },
      { status: "admitted", stageKey: "offered", cohortId: null },
      { status: "enrolled", stageKey: "enrolled", cohortId: "c" },
      { status: "withdrawn", stageKey: null, cohortId: "c" },
    ]);
    expect(a.interested).toBe(5); expect(a.qualified).toBe(4); expect(a.offered).toBe(3); expect(a.enrolled).toBe(2);
    expect(a.completing).toBeNull(); expect(a.productive).toBeNull();
  });
  it("a withdrawn learner who never sat in the offering counts as an applicant", () => {
    expect(reachedIndex({ status: "withdrawn", stageKey: null, cohortId: null })).toBe(1);
    expect(reachedIndex({ status: "withdrawn", stageKey: "withdrawn", cohortId: "c" })).toBe(3);
  });
  it("no records means every stage is blank", () => { expect(Object.values(stageActuals([])).every((v) => v === null)).toBe(true); });
});
