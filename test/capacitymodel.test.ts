import { describe, it, expect } from "vitest";
import {
  computeColumns, deriveAssumptions, DEFAULT_ASSUMPTIONS, buildInstances,
  weeklyNeed, settingAsks, shiftBoard, CAPACITY_HEADERS,
  type SessionInput, type CohortCalendarInput,
} from "../src/lib/capacitymodel";

// A class session straight from the workbook's Table1 (SUR 110, session 1):
// K=3, L=20, M=1 — at the workbook's Term-1 enrollment of 250:
// Y=ROUNDUP(250/20)=13, X=3×13=39, Z=3×1×13=39, AA=39/288, AB=39/16.
const classRow = (over: Partial<SessionInput> = {}): SessionInput => ({
  id: "s1", kind: "CLASS", number: 1, title: "Mod 1", deliveryMode: "Hybrid", location: "In-person",
  lengthHours: 3, maxStudents: 20, facultyNeeded: 1, facultyContactPolicy: 2.5,
  supportStaffNeeded: 0, supportContactPolicy: 2, week: 1, dayOfWeek: "Wednesday",
  notes: null, preceptorsNeeded: 0, preceptorContactPolicy: null, rotationType: null, clinicalMode: null,
  ...over,
});

describe("computeColumns — the workbook formulas to the cell", () => {
  it("computes Y, X, Z, AA, AB exactly (class row @ 250)", () => {
    const c = computeColumns(classRow(), 250);
    expect(c.Y).toBe(13);              // ROUNDUP(250/20)
    expect(c.X).toBe(39);              // 3×13
    expect(c.Z).toBe(39);              // 3×1×13
    expect(c.AA).toBeCloseTo(39 / 288, 10); // Z/AM2, AM2=18×16
    expect(c.AB).toBeCloseTo(39 / 16, 10);  // Z/AI2
    expect(c.AC).toBe(0);
  });
  it("computes the preceptor chain AC, AD, AE (clinical row)", () => {
    // Clinical: K=8, L=2 (2 students per preceptor), T=1, U=1 @ 30 students:
    // Y=15, AC=15×1×8×1=120, AD=120/(18×40)=120/720, AE=120/40=3.
    const c = computeColumns(classRow({ kind: "CLINICAL", lengthHours: 8, maxStudents: 2, preceptorsNeeded: 1, preceptorContactPolicy: 1, rotationType: "Precepted Experience" }), 30);
    expect(c.Y).toBe(15);
    expect(c.AC).toBe(120);
    expect(c.AD).toBeCloseTo(120 / 720, 10);
    expect(c.AE).toBeCloseTo(3, 10);
  });
  it("treats blank policies as 0 like Excel and flags L=0 as div-by-zero", () => {
    const blank = computeColumns(classRow({ preceptorsNeeded: 2, preceptorContactPolicy: null }), 40);
    expect(blank.AC).toBe(0); // U blank → 0
    const dz = computeColumns(classRow({ maxStudents: 0 }), 40);
    expect(dz.divByZero).toBe(true);
    expect(dz.Y).toBeNull();
  });
});

describe("deriveAssumptions — AK/AM/AN helper cells", () => {
  it("derives conversions the workbook way", () => {
    const d = deriveAssumptions(DEFAULT_ASSUMPTIONS);
    expect(d.facConversion).toBeCloseTo(40 / 16, 10);  // AK2=AJ2/AI2
    expect(d.facSemesterHours).toBe(288);              // AM2=AL2×AI2=18×16
    expect(d.facWeeklyHours).toBe(16);                 // AN2=AI2
    expect(d.preSemesterHours).toBe(720);              // AM5=18×40
    expect(d.preWeeklyHours).toBe(40);                 // AN5=AI5
  });
});

describe("headers are preserved word for word", () => {
  it("keeps the exact strings, typos included", () => {
    expect(CAPACITY_HEADERS.L).toBe("Max number of students that ONE session can accommodate");
    expect(CAPACITY_HEADERS.R).toBe("This session occurs on ____.");
    expect(CAPACITY_HEADERS.N).toBe("Contact hour policy for faculty during session (___hrs per contact hour)");
    expect(CAPACITY_HEADERS.Y).toBe("Number of sections required to service hour requirements");
  });
});

const cohortInput = (over: Partial<CohortCalendarInput> = {}): CohortCalendarInput => ({
  cohortId: "c1", cohort: "Class of 2027", programId: "p1", program: "Surg Tech AAS",
  enrollmentByTerm: { 1: 40, 2: 36 },
  termStartByIndex: { 1: new Date("2026-08-24T00:00:00Z"), 2: new Date("2027-01-11T00:00:00Z") },
  courses: [
    { code: "SUR 110", title: "Intro", termIndex: 1, termName: "Term 1", sessions: [classRow({ id: "a", week: 1, dayOfWeek: "Wednesday" }), classRow({ id: "b", number: 2, week: 2, dayOfWeek: "Wednesday" })] },
    { code: "SUR 122", title: "Clinical I", termIndex: 2, termName: "Term 2", sessions: [
      classRow({ id: "cl1", kind: "CLINICAL", lengthHours: 8, maxStudents: 2, preceptorsNeeded: 1, preceptorContactPolicy: 1, rotationType: "Precepted Experience", week: 1, dayOfWeek: "Tuesday" }),
      classRow({ id: "cl2", kind: "CLINICAL", number: 2, lengthHours: 8, maxStudents: 2, preceptorsNeeded: 1, preceptorContactPolicy: 1, rotationType: "Observation", week: 2, dayOfWeek: "Tuesday" }),
    ] },
  ],
  ...over,
});

describe("buildInstances — the calendar layer", () => {
  const inst = buildInstances(cohortInput());
  it("lands Week N · day on a real date from the term start", () => {
    const a = inst.find((i) => i.session.id === "a")!;
    expect(a.dateIso).toBe("2026-08-26"); // Mon 8/24 + Wednesday offset 2
    const b = inst.find((i) => i.session.id === "b")!;
    expect(b.dateIso).toBe("2026-09-02"); // week 2
  });
  it("uses the right term's enrollment for each row", () => {
    expect(inst.find((i) => i.session.id === "a")!.computed.C).toBe(40);
    expect(inst.find((i) => i.session.id === "cl1")!.computed.C).toBe(36);
    expect(inst.find((i) => i.session.id === "cl1")!.computed.Y).toBe(18); // ceil(36/2)
  });
  it("labels the semester from the term start month", () => {
    expect(inst.find((i) => i.session.id === "a")!.semester).toBe("Fall");
    expect(inst.find((i) => i.session.id === "cl1")!.semester).toBe("Spring");
  });
});

describe("pivots", () => {
  const inst = buildInstances(cohortInput());
  it("weeklyNeed sums weekly FTE columns per calendar week and rounds people up", () => {
    const rows = weeklyNeed(inst);
    const w1t2 = rows.find((r) => r.mondayIso === "2027-01-11")!;
    // cl1: AC=18×1×8×1=144 → AE=144/40=3.6 preceptor FTE that week → 4 people
    expect(w1t2.preceptorFte).toBeCloseTo(3.6, 10);
    expect(w1t2.preceptorHeads).toBe(4);
  });
  it("settingAsks groups clinical demand by rotation type with peaks and spans", () => {
    const asks = settingAsks(inst);
    expect(asks.map((a) => a.setting).sort()).toEqual(["Observation", "Precepted Experience"]);
    const pe = asks.find((a) => a.setting === "Precepted Experience")!;
    expect(pe.sectionsTotal).toBe(18);
    expect(pe.preceptorHours).toBe(144);
    expect(pe.days).toEqual(["Tuesday"]);
  });
  it("shiftBoard counts sections to cover per real date", () => {
    const board = shiftBoard(inst);
    const jan12 = board.find((d) => d.dateIso === "2027-01-12")!; // Tue of term-2 week 1
    expect(jan12.shifts).toBe(18);
    expect(jan12.preceptorsOnSite).toBe(18);
  });
});
