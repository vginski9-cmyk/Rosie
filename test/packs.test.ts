import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { decodeSectionTimes, toMinutes } from "../src/lib/sessiontimes";
import { simulationAllowance } from "../src/lib/requirementrules";

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

// What each accreditor lets a program simulate (prisma/templates/requirements): ARRT up to 10 procedures; the surgical case
// counts and the nurse-aide clinical hours allow none — so only Radiography's clinical courses carry an allowance.
describe("simulation allowances in the requirement sets", () => {
  const rulesOf = (f: string) => (JSON.parse(readFileSync(`prisma/templates/requirements/${f}.json`, "utf8")) as { rules: Parameters<typeof simulationAllowance>[0] }).rules;
  it("ARRT allows ten simulated procedures, never pediatric; ARC/STSA and NATCEP allow none", () => {
    expect(simulationAllowance(rulesOf("radiography"))).toEqual({ max: 10, unit: "procedures", note: "up to 10 procedures may be simulated; pediatric procedures may not be" });
    expect(simulationAllowance(rulesOf("surgical-technology"))).toBeNull();
    expect(simulationAllowance(rulesOf("nurse-aide"))).toBeNull();
  });

});

describe("the Surgical Technology sheet's rotation wording", () => {
  it("the seed maps the sheet's bare \"Other\" (SUR 135) to the operating-room setting and reads the either/or rule as reviewed", () => {
    const seed = readFileSync("prisma/seed.ts", "utf8");
    expect(seed).toMatch(/\["Other", "ORS", "Surgical"\]/);
    const backfill = readFileSync("scripts/backfill-requirements.ts", "utf8");
    expect(backfill).toMatch(/"Operating Room or Doctor's Office": \{ rule: \{ kind: "any-of", settings: \["ORS", "AMB"\] \}, mixing: "allowed"/);
  });
});
