import { describe, it, expect } from "vitest";
import { explainSession, hm } from "../src/lib/explain";
import { DEFAULT_ASSUMPTIONS, type SessionInput } from "../src/lib/capacitymodel";

const s = (over: Partial<SessionInput>): SessionInput => ({ id: "x", kind: "CLINICAL", number: 1, title: null, deliveryMode: "In-person", location: "Clinical site", lengthHours: 7.5, maxStudents: 1, facultyNeeded: 0.05, facultyContactPolicy: null, supportStaffNeeded: 0, supportContactPolicy: null, week: 1, dayOfWeek: "Tue", notes: null, preceptorsNeeded: 1, preceptorContactPolicy: 1, rotationType: "General", clinicalMode: "Precepted", ...over } as unknown as SessionInput);

describe("what the design numbers mean", () => {
  it("0.05 of an instructor on a 7.5 h precepted shift is 22 min 30 s per student per shift", () => {
    const m = explainSession(s({}), 41, DEFAULT_ASSUMPTIONS, { occurrencesPerWeek: 2, weeks: 16 });
    expect(m.sections).toBe(41);
    const inst = m.roles.find((r) => r.role === "instructor")!;
    expect(inst.perSectionShift).toBe(0.375); expect(inst.perStudentShift).toBe(0.375);
    expect(inst.perStudentWeek).toBe(0.75); expect(inst.perStudentTerm).toBe(12);
    expect(inst.perCohortShift).toBe(15.375); expect(inst.perCohortWeek).toBe(30.75);
    expect(inst.fteWeek).toBe(30.75 / 16);
    expect(inst.headsAtOnce).toBe(3); // 0.05 × 41 = 2.05 → 3 people visiting sections in turn
    expect(inst.text).toContain("22 min 30 s");
    const pre = m.roles.find((r) => r.role === "preceptor")!;
    expect(pre.perStudentShift).toBe(7.5); expect(pre.headsAtOnce).toBe(41);
  });
  it("a whole instructor per class section reads as on duty for the full session", () => {
    const m = explainSession(s({ kind: "CLASS", lengthHours: 2.1666, maxStudents: 25, facultyNeeded: 1, preceptorsNeeded: 0 }), 41, DEFAULT_ASSUMPTIONS, { occurrencesPerWeek: 1, weeks: 16 });
    expect(m.sections).toBe(2); expect(m.studentsPerSection).toBe(20.5);
    const inst = m.roles.find((r) => r.role === "instructor")!;
    expect(inst.headsAtOnce).toBe(2); expect(inst.perCohortShift).toBe(4.3332);
    expect(inst.text).toMatch(/on duty at once/);
  });
  it("formats hours as hours, minutes and seconds", () => {
    expect(hm(0.375)).toBe("0.375 h (22 min 30 s)"); expect(hm(7.5)).toBe("7.5 h (7 h 30 min)"); expect(hm(2)).toBe("2 h");
  });
});
