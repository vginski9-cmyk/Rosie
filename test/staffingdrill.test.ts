import { describe, expect, it } from "vitest";
import { drillDown, mondayOf, type DrillAssignment } from "../src/lib/staffingdrill";
import type { DatedInstance, WorkloadAssumptions } from "../src/lib/capacitymodel";

const asm: WorkloadAssumptions = { facContactHours: 16, facWorkWeekHours: 40, facTermWeeks: 16, preContactHours: 40, preWorkWeekHours: 40, preTermWeeks: 16 };
const inst = (o: Partial<DatedInstance> & { id: string; kind: "CLASS" | "LAB" | "CLINICAL"; AB?: number; AE?: number; AA?: number; AD?: number; Y?: number }): DatedInstance => ({
  session: { id: o.id, kind: o.kind, number: 1, title: "t", deliveryMode: null, location: null, lengthHours: 8, maxStudents: 10, facultyNeeded: 1, preceptorsNeeded: 1, supportStaffNeeded: 0, week: 1, dayOfWeek: "Tue", startTime: "08:00", rotationType: null, clinicalMode: null, notes: null, facultyContactPolicy: null, supportContactPolicy: null, preceptorContactPolicy: null } as unknown as DatedInstance["session"],
  computed: { C: 40, Y: o.Y ?? 4, X: null, Z: null, AA: o.AA ?? 0, AB: o.AB ?? 0, AC: null, AD: o.AD ?? 0, AE: o.AE ?? 0, divByZero: false } as unknown as DatedInstance["computed"],
  cohortId: "c1", cohort: "Class of 2028", programId: "p", program: "Radiography", courseCode: "RAD-151", courseTitle: "Clinical I", courseId: "k", termIndex: 1, termName: "Term 1", semester: "Fall", weekOfTerm: 1,
  monday: null, mondayIso: "2027-03-22", date: null, dateIso: "2027-03-23", month: "2027-03", holiday: null, ...o,
} as DatedInstance);
const a = (o: Partial<DrillAssignment>): DrillAssignment => ({ personId: "p1", personName: "Beatriz Quinn", role: "preceptor", contactHours: 8, sessionId: "s1", sectionIndex: 1, dateIso: "2027-03-23", cohortId: "c1", cohortName: "Class of 2028", courseCode: "RAD-151", kind: "CLINICAL", employerName: "Moore Regional", ...o });

describe("staffing drill-down", () => {
  it("finds Monday", () => { expect(mondayOf("2027-03-23")).toBe("2027-03-22"); });
  it("converts each person's contact hours with the bar's own divisor and shows the gap", () => {
    const rows = [inst({ id: "s1", kind: "CLINICAL", AE: 1.2, Y: 6 })];
    const r = drillDown(rows, [a({}), a({ personId: "p2", personName: "Chris Alvarez", sectionIndex: 2, contactHours: 8 }), a({ personId: "p3", personName: "Chris Kim", dateIso: "2027-03-30" })], new Map([["c1", asm]]), "weekly");
    expect(r.need.preceptor).toBeCloseTo(1.2, 6);
    expect(r.people.map((p) => p.name)).toEqual(["Beatriz Quinn", "Chris Alvarez"]);
    expect(r.people[0].fte).toBeCloseTo(0.2, 6); // 8 h ÷ 40 h preceptor week
    expect(r.assigned.preceptor).toBeCloseTo(0.4, 6);
    expect(r.unfilled.preceptor).toBeCloseTo(0.8, 6);
    expect(r.uncovered).toHaveLength(0);
  });
  it("splits faculty from preceptors and uses the semester divisor for semester bars", () => {
    const rows = [inst({ id: "s1", kind: "CLASS", AA: 0.5 }), inst({ id: "s2", kind: "CLINICAL", AD: 0.25, dateIso: "2027-03-25" })];
    const r = drillDown(rows, [a({ role: "instructor", personName: "Dana Jacobs", contactHours: 32, kind: "CLASS" }), a({ personId: "p2", sessionId: "s2", dateIso: "2027-03-25", contactHours: 80 })], new Map([["c1", asm]]), "semesterly");
    expect(r.assigned.faculty).toBeCloseTo(32 / (16 * 16), 6);
    expect(r.assigned.preceptor).toBeCloseTo(80 / (40 * 16), 6);
    expect(r.assigned.facultyPeople).toBe(1); expect(r.assigned.preceptorPeople).toBe(1);
  });
  it("lists sessions nobody covers", () => {
    const rows = [inst({ id: "s1", kind: "CLASS", AB: 0.5 }), inst({ id: "s9", kind: "LAB", AB: 0.5, dateIso: "2027-03-24", courseCode: "RAD-110" })];
    const r = drillDown(rows, [a({ role: "instructor", kind: "CLASS" })], new Map([["c1", asm]]), "weekly");
    expect(r.uncovered).toEqual([{ courseCode: "RAD-110", title: "t", kind: "LAB", dateIso: "2027-03-24", sections: 4, cohort: "Class of 2028" }]);
  });
  it("matches undated-day instances by week", () => {
    const rows = [inst({ id: "s1", kind: "CLASS", AB: 0.5, dateIso: null })];
    const r = drillDown(rows, [a({ role: "instructor", kind: "CLASS", dateIso: "2027-03-26" })], new Map([["c1", asm]]), "weekly");
    expect(r.people).toHaveLength(1); expect(r.uncovered).toHaveLength(0);
  });
});
