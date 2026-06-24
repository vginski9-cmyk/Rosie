import { describe, it, expect } from "vitest";
import { analyzeCoverage, type ProgramBenchmark, type CourseDevelopment } from "../src/lib/ksa";

const benchmarks: ProgramBenchmark[] = [
  { skillId: "a", skillName: "Radiographic Positioning", targetLevel: 4, priority: "core" },
  { skillId: "b", skillName: "Patient Care & Safety", targetLevel: 3, priority: "core" },
  { skillId: "c", skillName: "Agile Methodology", targetLevel: 2, priority: "supporting" },
];

const development: CourseDevelopment[] = [
  { skillId: "a", courseId: "c1", courseName: "RAD-111", termIndex: 1, targetLevel: 2, role: "INTRODUCED" },
  { skillId: "a", courseId: "c2", courseName: "RAD-221", termIndex: 4, targetLevel: 4, role: "MASTERED" },
  { skillId: "b", courseId: "c1", courseName: "RAD-111", termIndex: 1, targetLevel: 2, role: "INTRODUCED" },
  // skill "c" is never taught
];

describe("analyzeCoverage", () => {
  const result = analyzeCoverage(benchmarks, development);

  it("marks a skill MET when a course reaches the benchmark", () => {
    const a = result.skills.find((s) => s.skillId === "a")!;
    expect(a.reachedLevel).toBe(4);
    expect(a.status).toBe("MET");
    expect(a.gap).toBe(0);
    expect(a.contributingCourses).toHaveLength(2);
  });

  it("marks BELOW when courses fall short of the benchmark", () => {
    const b = result.skills.find((s) => s.skillId === "b")!;
    expect(b.reachedLevel).toBe(2);
    expect(b.status).toBe("BELOW");
    expect(b.gap).toBe(1);
  });

  it("marks NOT_TAUGHT when no course develops the skill", () => {
    const c = result.skills.find((s) => s.skillId === "c")!;
    expect(c.status).toBe("NOT_TAUGHT");
    expect(c.reachedLevel).toBe(0);
  });

  it("summarizes coverage and core coverage separately", () => {
    expect(result.total).toBe(3);
    expect(result.met).toBe(1);
    expect(result.below).toBe(1);
    expect(result.notTaught).toBe(1);
    expect(result.coverageRate).toBeCloseTo(1 / 3);
    // core skills are a (MET) and b (BELOW) -> 1/2
    expect(result.coreCoverageRate).toBeCloseTo(0.5);
  });

  it("orders contributing courses by term", () => {
    const a = result.skills.find((s) => s.skillId === "a")!;
    expect(a.contributingCourses.map((c) => c.termIndex)).toEqual([1, 4]);
  });
});
