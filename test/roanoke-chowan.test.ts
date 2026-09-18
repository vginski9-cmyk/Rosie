import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

type Session = { kind: string; week: number | null; dayOfWeek: string | null; startTime: string | null; lengthHours: number; maxStudents: number; facultyNeeded: number; preceptorsNeeded: number; rotationType: string | null; clinicalMode: string | null; location: string | null };
type Pack = { name: string; label: string; programType: string; maxCohort: number; terms: { index: number; name: string; semester: string | null; weeks: number; courses: { code: string; title: string; weeklyClassHours: number; weeklyLabHours: number; weeklyClinicalHours: number; sessions: Session[] }[] }[] }[];
const pack = JSON.parse(readFileSync(new URL("../prisma/templates/ma-roanoke-chowan.json", import.meta.url), "utf8")) as Pack;

describe("Roanoke-Chowan's Medical Assisting workbook pack", () => {
  it("is one program in two terms — Part 1 in the fall, Part 2 in the spring — session for session", () => {
    expect(pack).toHaveLength(1);
    const [p] = pack;
    expect(p.name).toBe("Medical Assisting");
    expect(p.programType).toBe("Evening");
    expect(p.maxCohort).toBe(10);
    expect(p.terms.map((t) => [t.index, t.semester, t.weeks, t.courses.map((c) => c.code)])).toEqual([
      [1, "Fall", 14, ["MED 3300 (Part 1)"]],
      [2, "Spring", 14, ["MED 3300 (Part 2)"]],
    ]);
    const part1 = p.terms[0].courses[0], part2 = p.terms[1].courses[0];
    const count = (c: typeof part1, kind: string) => c.sessions.filter((s) => s.kind === kind).length;
    const hours = (c: typeof part1, kind: string) => c.sessions.filter((s) => s.kind === kind).reduce((n, s) => n + s.lengthHours, 0);
    // Part 1: 42 class + 42 lab sessions, Tue/Thu evenings plus online, 360 hours.
    expect([count(part1, "CLASS"), count(part1, "LAB"), count(part1, "CLINICAL")]).toEqual([42, 42, 0]);
    expect(hours(part1, "CLASS") + hours(part1, "LAB")).toBeCloseTo(359.8, 1);
    expect(part1.sessions.every((s) => s.maxStudents === 10 && s.facultyNeeded === 1)).toBe(true);
    expect(new Set(part1.sessions.map((s) => s.dayOfWeek))).toEqual(new Set(["Tue", "Thu", null]));
    expect(part1.sessions.filter((s) => s.kind === "CLASS").every((s) => s.startTime === "17:30")).toBe(true);
    // Part 2: 33 class sessions and 28 precepted community-health clinical days, one student per preceptor.
    expect([count(part2, "CLASS"), count(part2, "LAB"), count(part2, "CLINICAL")]).toEqual([33, 0, 28]);
    const clinical = part2.sessions.filter((s) => s.kind === "CLINICAL");
    expect(hours(part2, "CLINICAL")).toBeCloseTo(159.6, 1);
    expect(clinical.every((s) => s.maxStudents === 1 && s.preceptorsNeeded === 1 && s.facultyNeeded === 0.1 && s.rotationType === "Community Health" && s.clinicalMode === "Precepted Experience" && s.location === "Community Health Center")).toBe(true);
    expect(new Set(clinical.map((s) => s.dayOfWeek))).toEqual(new Set(["Mon", "Wed"]));
    expect(Math.min(...clinical.map((s) => s.week ?? 99))).toBe(1);
    expect(Math.max(...clinical.map((s) => s.week ?? 0))).toBe(14);
    // The "Enrolls 5-10 per term" note is not a time of day.
    expect(part1.sessions.filter((s) => s.kind === "LAB").every((s) => s.startTime === null || s.startTime === "17:30")).toBe(true);
  });
});
