import { describe, it, expect } from "vitest";
import { resolvePolicy, coverageOf, personLoad, creditPerContactHour, type PolicyLite, type DatedAssignment } from "../src/lib/workload";

const INST = "inst1";
const policies: PolicyLite[] = [
  { id: "p-fac", institutionId: INST, employerId: null, role: "instructor", employmentType: null, title: null, contactHoursPerWeek: 16, workWeekHours: 40, termWeeks: 16, annualWeeks: 32, hoursPerContactHour: 2.5, maxContactHoursPerWeek: null },
  { id: "p-adj", institutionId: INST, employerId: null, role: "instructor", employmentType: "adjunct", title: null, contactHoursPerWeek: 18, workWeekHours: 40, termWeeks: 16, annualWeeks: 32, hoursPerContactHour: null, maxContactHoursPerWeek: 18 },
  { id: "p-coord", institutionId: INST, employerId: null, role: "instructor", employmentType: null, title: "Clinical Coordinator", contactHoursPerWeek: 8, workWeekHours: 40, termWeeks: 16, annualWeeks: 48, hoursPerContactHour: 2.5, maxContactHoursPerWeek: null },
  { id: "p-site", institutionId: INST, employerId: "emp1", role: "preceptor", employmentType: null, title: null, contactHoursPerWeek: 36, workWeekHours: 36, termWeeks: 16, annualWeeks: 48, hoursPerContactHour: 1, maxContactHoursPerWeek: 36 },
];
const person = (o: Partial<{ role: string; employmentType: string | null; title: string | null; employerId: string | null }>) => ({ id: "x", institutionId: INST, employerId: null, role: "instructor", employmentType: "full-time", title: null, ...o });

describe("resolvePolicy", () => {
  it("picks the institution's role policy for full-time faculty", () => {
    expect(resolvePolicy(person({}), policies).policy.id).toBe("p-fac");
  });
  it("prefers the employment-type policy for an adjunct", () => {
    expect(resolvePolicy(person({ employmentType: "adjunct" }), policies).policy.id).toBe("p-adj");
  });
  it("prefers the title policy over the plain role policy", () => {
    expect(resolvePolicy(person({ title: "clinical coordinator" }), policies).policy.id).toBe("p-coord");
  });
  it("uses the employer's policy for a preceptor at that site, the default elsewhere", () => {
    expect(resolvePolicy(person({ role: "preceptor", employmentType: "preceptor", employerId: "emp1" }), policies).policy.id).toBe("p-site");
    const r = resolvePolicy(person({ role: "preceptor", employmentType: "preceptor", employerId: "emp2" }), policies);
    expect(r.source).toBe("default"); expect(r.policy.contactHoursPerWeek).toBe(40);
  });
  it("credits work hours per contact hour from the policy or the week ÷ load", () => {
    expect(creditPerContactHour(policies[0])).toBe(2.5);
    expect(creditPerContactHour(policies[1])).toBeCloseTo(40 / 18, 10);
  });
});

describe("coverageOf", () => {
  const need = { lengthHours: 3, facultyNeeded: 1, preceptorsNeeded: 0, supportStaffNeeded: 0 };
  it("adds up split teaching to the session's contact hours", () => {
    const c = coverageOf(need, [
      { id: "a", personId: "A", role: "instructor", contactHours: 1, startOffsetMin: 0, sectionIndex: 1 },
      { id: "b", personId: "B", role: "instructor", contactHours: 0.75, startOffsetMin: 60, sectionIndex: 1 },
      { id: "c", personId: "C", role: "instructor", contactHours: 1.25, startOffsetMin: 105, sectionIndex: 1 },
    ]);
    expect(c.faculty).toEqual({ required: 3, assigned: 3 });
    expect(c.status).toBe("staffed");
    expect(c.coTeaching).toEqual([]);
    expect(c.overruns).toEqual([]);
  });
  it("flags co-teaching when two people's spans overlap, and partial coverage", () => {
    const c = coverageOf(need, [
      { id: "a", personId: "A", role: "instructor", contactHours: 2, startOffsetMin: 0, sectionIndex: 1 },
      { id: "b", personId: "B", role: "instructor", contactHours: 1, startOffsetMin: 60, sectionIndex: 1 },
    ]);
    expect(c.coTeaching).toEqual([["a", "b"]]);
    expect(c.status).toBe("staffed"); // 3 h assigned of 3 required, even though 1 h of it is doubled up
    const p = coverageOf({ ...need, facultyNeeded: 2 }, [{ id: "a", personId: "A", role: "instructor", contactHours: 3, startOffsetMin: null, sectionIndex: 1 }]);
    expect(p.faculty).toEqual({ required: 6, assigned: 3 });
    expect(p.status).toBe("partial");
  });
  it("flags an assignment that runs past the end of the session", () => {
    const c = coverageOf(need, [{ id: "a", personId: "A", role: "instructor", contactHours: 2, startOffsetMin: 90, sectionIndex: 1 }]);
    expect(c.overruns).toEqual(["a"]);
  });
  it("counts preceptor and support hours against their own needs", () => {
    const c = coverageOf({ lengthHours: 8, facultyNeeded: 0, preceptorsNeeded: 1, supportStaffNeeded: 0 }, [{ id: "p", personId: "P", role: "preceptor", contactHours: 8, startOffsetMin: null, sectionIndex: 1 }]);
    expect(c.preceptor).toEqual({ required: 8, assigned: 8 }); expect(c.status).toBe("staffed");
    expect(coverageOf({ lengthHours: 8, facultyNeeded: 0, preceptorsNeeded: 0, supportStaffNeeded: 0 }, []).status).toBe("unstaffed");
  });
});

describe("personLoad", () => {
  const a = (id: string, dateIso: string | null, h: number, termKey = "Fall 2026", year: number | null = 2026): DatedAssignment => ({ id, personId: "x", role: "instructor", contactHours: h, startOffsetMin: null, sectionIndex: 1, dateIso, termKey, year, cohortId: "c", cohortName: "Class of 2028", programName: "Radiography", courseCode: "RAD-110", kind: "CLASS" });
  it("rolls contact hours up by day, week, term and year and credits them by the policy", () => {
    const load = personLoad(person({}), [a("1", "2026-08-24", 2), a("2", "2026-08-26", 3), a("3", "2026-08-31", 2), a("4", "2027-01-19", 4, "Spring 2027", 2027)], policies);
    expect(load.policy.id).toBe("p-fac");
    expect(load.totalContactHours).toBe(11);
    expect(load.totalCreditedHours).toBe(27.5);
    expect(load.weekly.map((w) => [w.key, w.contactHours])).toEqual([["2026-08-24", 5], ["2026-08-31", 2], ["2027-01-18", 4]]);
    expect(load.daily.find((d) => d.key === "2026-08-26")?.contactHours).toBe(3);
    expect(load.terms.map((t) => [t.key, t.contactHours])).toEqual([["Fall 2026", 7], ["Spring 2027", 4]]);
    expect(load.years.map((y) => [y.key, y.contactHours])).toEqual([["2026", 7], ["2027", 4]]);
    expect(load.peakWeek?.key).toBe("2026-08-24");
    expect(load.peakWeekLoad).toBeCloseTo(5 / 16, 10);
    expect(load.termFte[0].fte).toBeCloseTo(7 / 256, 10);
    expect(load.yearFte[0].fte).toBeCloseTo(7 / 512, 10);
    expect(load.overloadedWeeks).toEqual([]);
  });
  it("flags weeks over the policy cap and keeps undated hours separate", () => {
    const load = personLoad(person({ employmentType: "adjunct" }), [a("1", "2026-08-24", 10), a("2", "2026-08-25", 9), a("3", null, 4)], policies);
    expect(load.overloadedWeeks).toEqual(["2026-08-24"]);
    expect(load.undatedHours).toBe(4);
    expect(load.peakWeekLoad).toBeCloseTo(19 / 18, 10);
  });
});
