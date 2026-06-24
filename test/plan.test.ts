import { describe, it, expect } from "vitest";
import { ordinalOf, termFromOrdinal, academicTermSequence } from "../src/lib/calendar";
import { buildAcademicPlan, cohortSeriesFromYearTargets, type CohortSeed, type Supply } from "../src/lib/plan";
import type { TermArchetype, SessionArchetype } from "../src/lib/capacity";

describe("calendar", () => {
  it("orders Fall → Spring → Summer and increments years correctly", () => {
    const fall = termFromOrdinal(ordinalOf("FALL", 2026));
    expect(fall.label).toBe("Fall 2026");
    const spring = termFromOrdinal(ordinalOf("FALL", 2026) + 1);
    expect(spring.code).toBe("SPRING");
    expect(spring.calendarYear).toBe(2027);
    const nextFall = termFromOrdinal(ordinalOf("FALL", 2026) + 3);
    expect(nextFall.label).toBe("Fall 2027");
  });

  it("builds a contiguous sequence", () => {
    const seq = academicTermSequence("FALL", 2026, 4);
    expect(seq.map((t) => t.label)).toEqual(["Fall 2026", "Spring 2027", "Summer 2027", "Fall 2027"]);
  });
});

const clinical = (id: string): SessionArchetype => ({ id, kind: "CLINICAL", lengthHours: 8, maxStudents: 8, facultyNeeded: 1, supportStaffNeeded: 0, preceptorsNeeded: 1 });

// Two-term program, each term one clinical session (cap 8).
const programTerms: TermArchetype[] = [1, 2].map((i) => ({
  id: `t${i}`, index: i, name: `Term ${i}`, startWeek: 1, endWeek: 16,
  courses: [{ id: `c${i}`, name: `C${i}`, sequenceOrder: 0, sessions: [clinical(`s${i}`)] }],
}));

const supply: Supply = { facultyFte: 5, preceptors: 10, wblSlots: 10 };

describe("buildAcademicPlan — multi-cohort overlay", () => {
  it("places a single cohort across consecutive academic terms", () => {
    const cohorts: CohortSeed[] = [{ id: "a", label: "A", entryCode: "FALL", entryFallYear: 2026, termOneSeats: 16 }];
    const plan = buildAcademicPlan(programTerms, cohorts, supply);
    expect(plan.terms.map((t) => t.term.label)).toEqual(["Fall 2026", "Spring 2027"]);
    // Term 1 @ 16 students, cap 8 -> 2 clinical sections.
    expect(plan.terms[0].demand.clinicalSections).toBe(2);
  });

  it("sums concurrent demand when two cohorts overlap in the same academic term", () => {
    // Cohort A enters Fall 2026, Cohort B enters Fall 2027.
    // In Spring 2027 only A (term 2) is active. In Fall 2027 only B (term 1).
    // Overlap happens when entry is staggered by 1 term — use Spring entry for B.
    const cohorts: CohortSeed[] = [
      { id: "a", label: "A", entryCode: "FALL", entryFallYear: 2026, termOneSeats: 16 },
      { id: "b", label: "B", entryCode: "SPRING", entryFallYear: 2026, termOneSeats: 16 }, // enters Spring 2027
    ];
    const plan = buildAcademicPlan(programTerms, cohorts, supply);
    const spring2027 = plan.terms.find((t) => t.term.label === "Spring 2027")!;
    // A is in term 2, B is in term 1 — two active segments.
    expect(spring2027.active).toHaveLength(2);
    // Each contributes 2 clinical sections -> 4 concurrent.
    expect(spring2027.demand.clinicalSections).toBe(4);
  });

  it("flags a clinical bottleneck when concurrent demand exceeds WBL slot supply", () => {
    const tight: Supply = { facultyFte: 5, preceptors: 10, wblSlots: 3 };
    const cohorts: CohortSeed[] = [
      { id: "a", label: "A", entryCode: "FALL", entryFallYear: 2026, termOneSeats: 16 },
      { id: "b", label: "B", entryCode: "SPRING", entryFallYear: 2026, termOneSeats: 16 },
    ];
    const plan = buildAcademicPlan(programTerms, cohorts, tight);
    expect(plan.hasBottleneck).toBe(true);
    const spring = plan.terms.find((t) => t.term.label === "Spring 2027")!;
    expect(spring.gaps.clinicalSlots.gap).toBeLessThan(0);
    expect(spring.bottlenecks.some((b) => b.includes("Clinical"))).toBe(true);
  });
});

describe("cohortSeriesFromYearTargets", () => {
  it("creates one Fall cohort per year with positive seats", () => {
    const series = cohortSeriesFromYearTargets([{ year: 2026, seats: 40 }, { year: 2027, seats: 0 }, { year: 2028, seats: 50 }]);
    expect(series).toHaveLength(2);
    expect(series[0].entryFallYear).toBe(2026);
    expect(series[1].termOneSeats).toBe(50);
  });
});
