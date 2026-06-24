import { describe, it, expect } from "vitest";
import { ordinalOf, ordinalOfCalendar, termFromOrdinal, academicTermSequence, deliveryOrdinals, parseTermCodes } from "../src/lib/calendar";
import { buildAcademicPlan, generateCohortSeries, type CohortSeed, type Supply, type LaunchConfig } from "../src/lib/plan";
import type { TermArchetype, SessionArchetype } from "../src/lib/capacity";

describe("calendar", () => {
  it("orders Fall → Spring → Summer and increments years correctly", () => {
    expect(termFromOrdinal(ordinalOf("FALL", 2026)).label).toBe("Fall 2026");
    const spring = termFromOrdinal(ordinalOf("FALL", 2026) + 1);
    expect(spring.code).toBe("SPRING");
    expect(spring.calendarYear).toBe(2027);
    expect(termFromOrdinal(ordinalOf("FALL", 2026) + 3).label).toBe("Fall 2027");
  });

  it("maps calendar-year terms to the right ordinal", () => {
    // Spring 2027 belongs to Fall-year 2026.
    expect(ordinalOfCalendar("SPRING", 2027)).toBe(ordinalOf("FALL", 2026) + 1);
    expect(ordinalOfCalendar("FALL", 2026)).toBe(ordinalOf("FALL", 2026));
  });

  it("builds a contiguous sequence", () => {
    expect(academicTermSequence("FALL", 2026, 4).map((t) => t.label)).toEqual(["Fall 2026", "Spring 2027", "Summer 2027", "Fall 2027"]);
  });

  it("skips inactive slots when walking the delivery calendar", () => {
    // Program runs Fall+Spring only (no summer). 3 program-terms from Fall 2026.
    const ords = deliveryOrdinals(ordinalOfCalendar("FALL", 2026), 3, parseTermCodes("FALL,SPRING"));
    expect(ords.map((o) => termFromOrdinal(o).label)).toEqual(["Fall 2026", "Spring 2027", "Fall 2027"]);
  });
});

const clinical = (id: string): SessionArchetype => ({ id, kind: "CLINICAL", lengthHours: 8, maxStudents: 8, facultyNeeded: 1, supportStaffNeeded: 0, preceptorsNeeded: 1 });
const programTerms: TermArchetype[] = [1, 2].map((i) => ({
  id: `t${i}`, index: i, name: `Term ${i}`, startWeek: 1, endWeek: 16,
  courses: [{ id: `c${i}`, name: `C${i}`, sequenceOrder: 0, sessions: [clinical(`s${i}`)] }],
}));
const supply: Supply = { facultyFte: 5, preceptors: 10, wblSlots: 10 };

describe("buildAcademicPlan", () => {
  it("places a single cohort across consecutive academic terms", () => {
    const cohorts: CohortSeed[] = [{ id: "a", label: "A", entryOrdinal: ordinalOfCalendar("FALL", 2026), termOneSeats: 16 }];
    const plan = buildAcademicPlan(programTerms, cohorts, supply);
    expect(plan.terms.map((t) => t.term.label)).toEqual(["Fall 2026", "Spring 2027"]);
    expect(plan.terms[0].demand.clinicalSections).toBe(2);
  });

  it("sums concurrent demand when cohorts overlap", () => {
    const cohorts: CohortSeed[] = [
      { id: "a", label: "A", entryOrdinal: ordinalOfCalendar("FALL", 2026), termOneSeats: 16 },
      { id: "b", label: "B", entryOrdinal: ordinalOfCalendar("SPRING", 2027), termOneSeats: 16 },
    ];
    const plan = buildAcademicPlan(programTerms, cohorts, supply);
    const spring = plan.terms.find((t) => t.term.label === "Spring 2027")!;
    expect(spring.active).toHaveLength(2);
    expect(spring.demand.clinicalSections).toBe(4);
  });

  it("skips summer for a Fall+Spring program", () => {
    const cohorts: CohortSeed[] = [{ id: "a", label: "A", entryOrdinal: ordinalOfCalendar("FALL", 2026), termOneSeats: 8 }];
    const plan = buildAcademicPlan(programTerms, cohorts, supply, { activeCodes: parseTermCodes("FALL,SPRING") });
    // Term 2 lands in Spring 2027 (not Summer).
    expect(plan.terms.map((t) => t.term.label)).toEqual(["Fall 2026", "Spring 2027"]);
  });

  it("flags a clinical bottleneck when demand exceeds WBL slots", () => {
    const tight: Supply = { facultyFte: 5, preceptors: 10, wblSlots: 3 };
    const cohorts: CohortSeed[] = [
      { id: "a", label: "A", entryOrdinal: ordinalOfCalendar("FALL", 2026), termOneSeats: 16 },
      { id: "b", label: "B", entryOrdinal: ordinalOfCalendar("SPRING", 2027), termOneSeats: 16 },
    ];
    const plan = buildAcademicPlan(programTerms, cohorts, tight);
    expect(plan.hasBottleneck).toBe(true);
  });
});

describe("generateCohortSeries — cadences", () => {
  const base: Omit<LaunchConfig, "cadence" | "launchTerms" | "intervalYears"> = {
    startYear: 2026, endYear: 2030, seatsByYear: {}, defaultSeats: 40,
  };

  it("annual: one cohort per year", () => {
    const s = generateCohortSeries({ ...base, cadence: "ANNUAL", launchTerms: ["FALL"], intervalYears: 1 });
    expect(s).toHaveLength(5);
  });

  it("biennial: every other year", () => {
    const s = generateCohortSeries({ ...base, cadence: "BIENNIAL", launchTerms: ["FALL"], intervalYears: 2 });
    expect(s.map((c) => c.label)).toEqual(["Fall 2026", "Fall 2028", "Fall 2030"]);
  });

  it("multiple per year: a cohort each launch term", () => {
    const s = generateCohortSeries({ ...base, cadence: "MULTI_PER_YEAR", launchTerms: ["FALL", "SPRING", "SUMMER"], intervalYears: 1 });
    expect(s).toHaveLength(15); // 5 years × 3 launches
  });

  it("on-demand: only explicit cohorts", () => {
    const s = generateCohortSeries(
      { ...base, cadence: "ON_DEMAND", launchTerms: ["FALL"], intervalYears: 1 },
      [{ id: "x", label: "Ad hoc", entryCode: "SUMMER", entryCalendarYear: 2027, seats: 22 }],
    );
    expect(s).toHaveLength(1);
    expect(s[0].termOneSeats).toBe(22);
  });

  it("produces many concurrent cohorts for long, frequently-launched programs", () => {
    // 12-term program launching 3×/year over 5 years.
    const longProgram: TermArchetype[] = Array.from({ length: 12 }, (_, i) => ({
      id: `t${i}`, index: i + 1, name: `T${i + 1}`, startWeek: 1, endWeek: 16,
      courses: [{ id: `c${i}`, name: `C`, sequenceOrder: 0, sessions: [clinical(`s${i}`)] }],
    }));
    const series = generateCohortSeries({ ...base, cadence: "MULTI_PER_YEAR", launchTerms: ["FALL", "SPRING", "SUMMER"], intervalYears: 1, defaultSeats: 20 });
    const plan = buildAcademicPlan(longProgram, series, supply);
    const peakConcurrent = Math.max(...plan.terms.map((t) => t.active.length));
    expect(peakConcurrent).toBeGreaterThanOrEqual(12); // 12 cohorts in flight at once
  });
});
