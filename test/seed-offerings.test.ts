import { describe, expect, it } from "vitest";
import { SCHEDULED_OFFERINGS } from "../prisma/seed-offerings";
import { INSTITUTIONS } from "../prisma/seed-institutions";
import { BENCHMARK_RATES } from "../src/lib/northstar";
import { solveLadder } from "../src/lib/pipelinecounts";

// The cohorts scheduled to each college's goal, 2027–2030, as the goal page counts them (the owner's calls, 2026-11-12).
const year = (start: string, years: number) => Number(start.slice(0, 4)) + years;

describe("cohorts scheduled to the goals", () => {
  it("Roanoke-Chowan: two Medical Assisting classes of the college's 10 seats every class year 2027–2030 cover the 9-a-year goal", () => {
    const specs = SCHEDULED_OFFERINGS["Roanoke-Chowan Community College"];
    expect(specs.every((s) => s.program === "Medical Assisting" && s.seats === 10 && s.counts?.enrolled === 10)).toBe(true);
    const byYear = new Map<number, number>(); for (const s of specs) byYear.set(year(s.start, 1), (byYear.get(year(s.start, 1)) ?? 0) + 1); // Part 1 fall, Part 2 the next spring
    expect([...byYear.entries()].sort()).toEqual([[2027, 2], [2028, 2], [2029, 2], [2030, 2]]);
    const each = solveLadder({ goal: 4.5, rates: BENCHMARK_RATES, counts: { enrolled: 10 }, numTerms: 2 }).goal;
    expect(each).toBeCloseTo(5.103, 3);
    expect(2 * each).toBeGreaterThanOrEqual(9);
    const fam = INSTITUTIONS.find((i) => i.name === "Roanoke-Chowan Community College")!.families[0];
    expect(Object.values(fam.goals).every((g) => g === 9)).toBe(true);
  });
  it("Albemarle: three AAS and three Diploma classes of 19 every class year 2027–2030 cover the 56-a-year goal under the 20-seat cap", () => {
    const specs = SCHEDULED_OFFERINGS["College of The Albemarle"];
    expect(specs.every((s) => s.counts?.enrolled === 19 && s.seats == null)).toBe(true);
    const aas = specs.filter((s) => /AAS/.test(s.program)); const dip = specs.filter((s) => /Diploma/.test(s.program));
    expect(aas.length + dip.length).toBe(specs.length);
    const count = (list: typeof specs, years: number) => { const m = new Map<number, number>(); for (const s of list) m.set(year(s.start, years), (m.get(year(s.start, years)) ?? 0) + 1); return [...m.entries()].sort(); };
    expect(count(aas, 2)).toEqual([[2027, 3], [2028, 3], [2029, 3], [2030, 3]]); // four terms over two years
    expect(count(dip, 1)).toEqual([[2027, 3], [2028, 3], [2029, 3], [2030, 3]]); // fall, spring and the summer after
    const each = solveLadder({ goal: 9.33, rates: BENCHMARK_RATES, counts: { enrolled: 19 }, numTerms: 4 }).goal;
    expect(each).toBeCloseTo(9.696, 3);
    expect(6 * each).toBeGreaterThanOrEqual(56);
    expect(19).toBeLessThanOrEqual(20);
    const fam = INSTITUTIONS.find((i) => i.name === "College of The Albemarle")!.families[0];
    expect(Object.values(fam.goals).every((g) => g === 56)).toBe(true);
  });
});
