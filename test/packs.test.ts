import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { decodeSectionTimes, toMinutes } from "../src/lib/sessiontimes";

// The Radiography pack (prisma/templates/rad.json) is the program's source. Two rules the owner set on it
// (2026-09-24): a tenth of a faculty member on every clinical shift, every lab in Kennedy Hall 147, and
// RAD 112's class and lab sections never overlapping.
interface PackSession { kind: string; location: string | null; number: number; dayOfWeek: string | null; startTime: string | null; endTime: string | null; facultyNeeded: number; sectionTimes: string | null }
interface Pack { terms: { courses: { code: string; sessions: PackSession[] }[] }[] }
const pack = JSON.parse(readFileSync("prisma/templates/rad.json", "utf8")) as Pack;
const courses = pack.terms.flatMap((t) => t.courses);

describe("the Radiography pack", () => {
  it("gives every clinical session of RAD 151, 161, 171, 251 and 261 a tenth of a faculty member", () => {
    const clinical = courses.filter((c) => ["RAD-151", "RAD-161", "RAD-171", "RAD-251", "RAD-261"].includes(c.code)).flatMap((c) => c.sessions.filter((s) => s.kind === "CLINICAL"));
    expect(clinical.length).toBe(146);
    expect(clinical.every((s) => s.facultyNeeded === 0.1)).toBe(true);
    // no other course has a clinical session
    expect(courses.filter((c) => !["RAD-151", "RAD-161", "RAD-171", "RAD-251", "RAD-261"].includes(c.code)).flatMap((c) => c.sessions).some((s) => s.kind === "CLINICAL")).toBe(false);
  });
  it("every lab meets in Kennedy Hall 147", () => {
    const labs = courses.flatMap((c) => c.sessions.filter((s) => s.kind === "LAB"));
    expect(labs.length).toBe(120);
    expect(labs.every((s) => s.location === "Kennedy Hall 147")).toBe(true);
  });
  it("RAD 112's class never overlaps either lab section", () => {
    const c = courses.find((x) => x.code === "RAD-112")!;
    const cls = c.sessions.filter((s) => s.kind === "CLASS"); const labs = c.sessions.filter((s) => s.kind === "LAB");
    expect(cls.length).toBe(16); expect(labs.length).toBe(16);
    for (const k of cls) for (const l of labs) {
      const sections = decodeSectionTimes(l.sectionTimes ?? "");
      expect(sections.length).toBe(2);
      for (const sec of sections) {
        if ((sec.dayOfWeek ?? l.dayOfWeek) !== k.dayOfWeek) continue;
        const a0 = toMinutes(k.startTime!)!, a1 = toMinutes(k.endTime!)!, b0 = toMinutes(sec.startTime!)!, b1 = toMinutes(sec.endTime!)!;
        expect(a1 <= b0 || b1 <= a0, `class ${k.startTime}–${k.endTime} overlaps lab section ${sec.startTime}–${sec.endTime}`).toBe(true);
      }
    }
    expect(labs[0].sectionTimes).toBe("Wed@08:00-10:50,Wed@14:00-16:50");
  });
});
