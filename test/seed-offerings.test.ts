import { describe, expect, it } from "vitest";
import { SCHEDULED_OFFERINGS } from "../prisma/seed-offerings";
import { INSTITUTIONS } from "../prisma/seed-institutions";
import { BENCHMARK_RATES } from "../src/lib/northstar";
import { solveLadder } from "../src/lib/pipelinecounts";
import { readFileSync } from "node:fs";

// A short continuous-mode class counts toward the year it starts (the year in its name, as the goal page reads it); every class
// here also ends within that year (the start plus the pack's term weeks).
type CnaPack = { name: string; termWeeks: number; maxCohort: number }[];
const cnaPack = (file: string) => JSON.parse(readFileSync(new URL(`../prisma/templates/${file}`, import.meta.url), "utf8")) as CnaPack;
const endYear = (start: string, weeks: number) => new Date(new Date(start + "T00:00:00Z").getTime() + (weeks * 7 - 1) * 86400000).getUTCFullYear();
const perYear = (specs: { start: string; program: string }[], weeksOf: (p: string) => number) => { const m = new Map<number, number>(); for (const s of specs) { const y = Number(s.start.slice(0, 4)); expect(endYear(s.start, weeksOf(s.program)), s.start).toBe(y); m.set(y, (m.get(y) ?? 0) + 1); } return [...m.entries()].sort(); };

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
  it("Carteret: eleven Nurse Aide classes of the workbook's ten seats every year 2026–2030, on its six models, cover the 55-a-year goal — the six on record kept", () => {
    const specs = SCHEDULED_OFFERINGS["Carteret Community College"];
    const pack = cnaPack("cna.json");
    const weeks = (p: string) => pack.find((t) => t.name === p)!.termWeeks;
    expect(specs.every((s) => pack.some((t) => t.name === s.program) && s.seats === 10 && s.counts?.enrolled === 10 && s.goal === 5.1)).toBe(true);
    expect(perYear(specs, weeks)).toEqual([[2026, 11], [2027, 11], [2028, 11], [2029, 11], [2030, 11]]);
    for (const [program, start] of [["6-week", "2026-08-17"], ["5-week", "2026-10-05"], ["11-week daytime", "2026-08-21"], ["11-week nighttime", "2027-01-11"], ["14-week high school", "2027-01-11"], ["8-week summer", "2027-06-01"]]) expect(specs.some((s) => s.program === `Nurse Aide Level I — ${program} offering` && s.start === start), `${program} ${start}`).toBe(true);
    // Each year: three 6-week, three 5-week, two 11-week daytime, one nighttime, one high school, one summer.
    const by2028 = specs.filter((s) => s.start.startsWith("2028")).map((s) => s.program.replace(/^Nurse Aide Level I — /, "").replace(" offering", "")).sort();
    expect(by2028).toEqual(["11-week daytime", "11-week daytime", "11-week nighttime", "14-week high school", "5-week", "5-week", "5-week", "6-week", "6-week", "6-week", "8-week summer"]);
    // Fri/Sat classes start on a Friday, the rest on a Monday — except the summer 2027 class on record, which starts on the
    // college's published summer first day (Tuesday, June 1).
    for (const s of specs) if (s.start !== "2027-06-01") expect(new Date(s.start + "T00:00:00Z").getUTCDay(), s.start).toBe(/daytime/.test(s.program) ? 5 : 1);
    const each = solveLadder({ goal: 5.1, rates: BENCHMARK_RATES, counts: { enrolled: 10 }, numTerms: 1 }).goal;
    expect(each).toBeCloseTo(5.103, 3);
    expect(11 * each).toBeGreaterThanOrEqual(55);
    const fam = INSTITUTIONS.find((i) => i.name === "Carteret Community College")!.families[0];
    expect(Object.values(fam.goals).every((g) => g === 55)).toBe(true);
  });
  it("Craven: seven Nurse Aide classes a year (eight from 2028) on its five models cover the goal stair 50, 50, 55, 60, 60", () => {
    const specs = SCHEDULED_OFFERINGS["Craven Community College"];
    const pack = cnaPack("cna-craven.json");
    const weeks = (p: string) => pack.find((t) => t.name === p)!.termWeeks;
    expect(specs.every((s) => pack.some((t) => t.name === s.program) && s.seats == null)).toBe(true);
    expect(specs.every((s) => /CCP/.test(s.program) ? s.counts?.enrolled === 10 && s.goal === 5.1 : s.counts?.enrolled === 16 && s.goal === 8.17)).toBe(true);
    expect(perYear(specs, weeks)).toEqual([[2026, 7], [2027, 7], [2028, 8], [2029, 8], [2030, 8]]);
    const fam = INSTITUTIONS.find((i) => i.name === "Craven Community College")!.families[0];
    expect([2026, 2027, 2028, 2029, 2030].map((y) => fam.goals[y])).toEqual([50, 50, 55, 60, 60]);
    const big = solveLadder({ goal: 8.17, rates: BENCHMARK_RATES, counts: { enrolled: 16 }, numTerms: 1 }).goal;
    const ccp = solveLadder({ goal: 5.1, rates: BENCHMARK_RATES, counts: { enrolled: 10 }, numTerms: 1 }).goal;
    expect(big).toBeCloseTo(8.165, 3);
    for (const [y, n] of perYear(specs, weeks)) {
      const yearSpecs = specs.filter((s) => Number(s.start.slice(0, 4)) === y);
      expect(yearSpecs.filter((s) => /CCP/.test(s.program))).toHaveLength(1);
      expect((n - 1) * big + ccp, `class year ${y}`).toBeGreaterThanOrEqual(fam.goals[y]);
    }
    for (const s of specs) expect(new Date(s.start + "T00:00:00Z").getUTCDay(), s.start).toBe(1);
  });
});
