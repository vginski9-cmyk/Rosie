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
  it("a graduated class of 8 with 6 completers and 2 withdrawals reads enrolled 8, completing 6, and nothing past that", () => {
    const a = stageActuals([
      ...Array.from({ length: 6 }, () => ({ status: "completed", stageKey: "completing", cohortId: "c" })),
      ...Array.from({ length: 2 }, () => ({ status: "withdrawn", stageKey: "withdrawn", cohortId: "c" })),
    ]);
    expect(a.enrolled).toBe(8); expect(a.completing).toBe(6); expect(a.licensed).toBeNull(); expect(a.placed).toBeNull();
  });
  it("a class graduated at its own rates reads the whole ladder, nothing blank: 21 → 18 → 16 → 15 → 15", () => {
    const rec = (status: string, stageKey: string, n: number) => Array.from({ length: n }, () => ({ status, stageKey, cohortId: "c" }));
    const a = stageActuals([...rec("withdrawn", "withdrawn", 3), ...rec("completed", "completing", 2), ...rec("licensed", "licensed", 1), ...rec("productive", "productive", 15)]);
    expect([a.enrolled, a.completing, a.licensed, a.placed, a.productive]).toEqual([21, 18, 16, 15, 15]);
    expect(Object.values(a).every((v) => v != null)).toBe(true);
  });
  it("no records means every stage is blank", () => { expect(Object.values(stageActuals([])).every((v) => v === null)).toBe(true); });
});
