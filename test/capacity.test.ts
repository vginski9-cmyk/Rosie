import { describe, it, expect } from "vitest";
import {
  sessionDemand,
  termDemand,
  programDemand,
  DEFAULT_CONFIG,
  type SessionArchetype,
  type TermArchetype,
} from "../src/lib/capacity";

const mk = (over: Partial<SessionArchetype>): SessionArchetype => ({
  id: "s",
  kind: "CLASS",
  lengthHours: 4,
  maxStudents: 40,
  facultyNeeded: 1,
  supportStaffNeeded: 0,
  preceptorsNeeded: 0,
  ...over,
});

describe("sessionDemand", () => {
  it("one section when enrollment fits capacity", () => {
    const d = sessionDemand(mk({ maxStudents: 40 }), 30);
    expect(d.sections).toBe(1);
    expect(d.facultyInstances).toBe(1);
    expect(d.facultyContactHours).toBe(4); // 1 section * 1 faculty * 4h
    expect(d.studentContactHours).toBe(120); // 30 * 4
  });

  it("splits into sections by capacity (ceil)", () => {
    // 41 students, capacity 40 -> 2 sections
    const d = sessionDemand(mk({ maxStudents: 40 }), 41);
    expect(d.sections).toBe(2);
  });

  it("lab needing 3 faculty per station scales staffing", () => {
    // 20-student labs, 3 faculty each, 8h. 60 students -> 3 sections.
    const d = sessionDemand(mk({ kind: "LAB", maxStudents: 20, facultyNeeded: 3, lengthHours: 8 }), 60);
    expect(d.sections).toBe(3);
    expect(d.facultyInstances).toBe(9);
    expect(d.facultyContactHours).toBe(72); // 9 * 8
  });

  it("clinical sections become WBL slots", () => {
    const d = sessionDemand(mk({ kind: "CLINICAL", maxStudents: 8, facultyNeeded: 1, preceptorsNeeded: 1, lengthHours: 8 }), 41);
    expect(d.sections).toBe(6); // ceil(41/8)
    expect(d.wblSlots).toBe(6);
    expect(d.preceptorInstances).toBe(6);
  });

  it("zero enrollment produces zero demand", () => {
    expect(sessionDemand(mk({}), 0).sections).toBe(0);
  });
});

describe("termDemand", () => {
  const term: TermArchetype = {
    id: "t1",
    index: 1,
    name: "Term 1",
    startWeek: 1,
    endWeek: 16,
    courses: [
      {
        id: "c1",
        name: "NUR 111",
        sequenceOrder: 0,
        sessions: [
          // 16 weekly 4h classes, cap 40
          ...Array.from({ length: 16 }, (_, i) => mk({ id: `cl${i}`, kind: "CLASS", lengthHours: 4, maxStudents: 40 })),
          // 12 labs, 8h, cap 20, 3 faculty
          ...Array.from({ length: 12 }, (_, i) => mk({ id: `lb${i}`, kind: "LAB", lengthHours: 8, maxStudents: 20, facultyNeeded: 3 })),
          // 12 clinicals, 8h, cap 8, 1 faculty, 1 preceptor
          ...Array.from({ length: 12 }, (_, i) => mk({ id: `cn${i}`, kind: "CLINICAL", lengthHours: 8, maxStudents: 8, facultyNeeded: 1, preceptorsNeeded: 1 })),
        ],
      },
    ],
  };

  it("aggregates sections by kind for a 40-student cohort", () => {
    const d = termDemand(term, 40, DEFAULT_CONFIG);
    expect(d.weeks).toBe(16);
    expect(d.totals.classSections).toBe(16); // 1 each * 16
    expect(d.totals.labSections).toBe(24); // 2 sections * 12
    expect(d.totals.clinicalSections).toBe(60); // 5 sections (ceil 40/8) * 12
    expect(d.totals.wblSlots).toBe(60);
  });

  it("computes a positive faculty FTE", () => {
    const d = termDemand(term, 40, DEFAULT_CONFIG);
    expect(d.totals.facultyFTE).toBeGreaterThan(0);
  });
});

describe("programDemand", () => {
  it("models attrition across terms and sums per-term FTE", () => {
    const terms: TermArchetype[] = [1, 2].map((i) => ({
      id: `t${i}`,
      index: i,
      name: `Term ${i}`,
      startWeek: 1,
      endWeek: 16,
      courses: [{ id: `c${i}`, name: `C${i}`, sequenceOrder: 0, sessions: [mk({ id: `s${i}`, maxStudents: 30 })] }],
    }));
    const d = programDemand(terms, { 1: 60, 2: 30 });
    // Term 1: ceil(60/30)=2 sections; Term 2: ceil(30/30)=1 section
    expect(d.terms[0].totals.classSections).toBe(2);
    expect(d.terms[1].totals.classSections).toBe(1);
    expect(d.totals.classSections).toBe(3);
    expect(d.totals.facultyFTE).toBeCloseTo(d.terms[0].totals.facultyFTE + d.terms[1].totals.facultyFTE);
  });
});
