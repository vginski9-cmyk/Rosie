import { describe, it, expect } from "vitest";
import { sessionService, courseService, roundUpInt, type ServiceSession } from "../src/lib/service";

// Validated against the real "Database for FTEs_Clinicals" sheet, row 2:
// Nursing 212 clinical, length 12.5, maxStudents 1, faculty 0.1/3, preceptors 1,
// enrollment 70.90225563909773 → sheet outputs below.
const clinicalRow: ServiceSession = {
  id: "n212",
  kind: "CLINICAL",
  lengthHours: 12.5,
  maxStudents: 1,
  facultyNeeded: 0.1 / 3,
  preceptorsNeeded: 1,
};
const ENR = 70.90225563909773;

describe("roundUpInt (Excel ROUNDUP)", () => {
  it("rounds away from zero to the next integer", () => {
    expect(roundUpInt(70.9)).toBe(71);
    expect(roundUpInt(71)).toBe(71); // already integral, no bump
    expect(roundUpInt(5.01)).toBe(6);
  });
});

describe("sessionService matches the FTEs_Clinicals sheet", () => {
  const r = sessionService(clinicalRow, ENR);
  it("sections = ROUNDUP(enrollment / maxStudents)", () => {
    expect(r.sections).toBe(71);
  });
  it("space hours = sections × length", () => {
    expect(r.spaceHours).toBeCloseTo(887.5, 4);
  });
  it("faculty contact hours = sections × faculty × length", () => {
    expect(r.facultyContactHours).toBeCloseTo(29.583333333, 4);
  });
  it("faculty weekly = hours / 18, faculty FTE = hours / 288", () => {
    expect(r.facultyWeeklyHours).toBeCloseTo(1.6435185185, 4);
    expect(r.facultyFte).toBeCloseTo(0.1027199074, 6);
  });
  it("preceptor hours = sections × preceptors × length", () => {
    expect(r.preceptorContactHours).toBeCloseTo(887.5, 4);
  });
  it("preceptor weekly = hours / 40, preceptor FTE = hours / 640", () => {
    expect(r.preceptorWeeklyFte).toBeCloseTo(22.1875, 4);
    expect(r.preceptorFte).toBeCloseTo(1.38671875, 6);
  });
});

describe("courseService aggregates across sessions", () => {
  it("sums per-session demand and splits sections by kind", () => {
    const sessions: ServiceSession[] = [
      { id: "a", kind: "CLASS", lengthHours: 3, maxStudents: 30, facultyNeeded: 1, preceptorsNeeded: 0 },
      { id: "b", kind: "CLINICAL", lengthHours: 12, maxStudents: 8, facultyNeeded: 0, preceptorsNeeded: 1 },
    ];
    const { totals } = courseService(sessions, 40);
    expect(totals.classSections).toBe(roundUpInt(40 / 30)); // 2
    expect(totals.clinicalSections).toBe(roundUpInt(40 / 8)); // 5
    expect(totals.sections).toBe(2 + 5);
    expect(totals.preceptorContactHours).toBe(5 * 1 * 12);
  });
});
