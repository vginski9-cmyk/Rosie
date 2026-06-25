import { describe, it, expect } from "vitest";
import { buildTrajectory, buildConstellation, yearSpan } from "../src/lib/goals";

describe("buildTrajectory", () => {
  it("computes gaps, attainment, coverage and running cumulatives", () => {
    const t = buildTrajectory([
      { year: 2027, demand: 14, goal: 29, produced: 12 },
      { year: 2026, demand: 14, goal: 29, produced: 9 },
      { year: 2028, demand: 13, goal: 29, produced: 18 },
    ]);
    expect(t.map((p) => p.year)).toEqual([2026, 2027, 2028]); // sorted
    expect(t[0].gapVsGoal).toBe(9 - 29);
    expect(t[1].goalAttainment).toBeCloseTo(12 / 29, 5);
    expect(t[2].demandCoverage).toBeCloseTo(18 / 13, 5);
    expect(t[2].cumulativeProduced).toBe(9 + 12 + 18);
    expect(t[0].onTrack).toBe(false);
  });

  it("handles missing values without throwing", () => {
    const t = buildTrajectory([{ year: 2030, goal: 29 }]);
    expect(t[0].produced).toBeNull();
    expect(t[0].goalAttainment).toBeNull();
    expect(t[0].onTrack).toBeNull();
  });
});

describe("buildConstellation", () => {
  it("infers entry year from grad year + span and sorts by entry", () => {
    const bars = buildConstellation([
      { id: "b", name: "Class of 2030", programId: "p", programName: "Rad", gradYear: 2030, enrolled: 41 },
      { id: "a", name: "Class of 2028", programId: "p", programName: "Rad", gradYear: 2028, entryYear: 2026 },
    ], 2);
    expect(bars[0].name).toBe("Class of 2028"); // earlier entry first
    expect(bars[0].spanYears).toBe(2);
    expect(bars[1].entryYear).toBe(2028); // 2030 - 2
  });
});

describe("yearSpan", () => {
  it("fills the inclusive range", () => {
    expect(yearSpan([2026, 2029, 2027])).toEqual([2026, 2027, 2028, 2029]);
    expect(yearSpan([])).toEqual([]);
  });
});
