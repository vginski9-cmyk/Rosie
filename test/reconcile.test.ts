import { describe, expect, it } from "vitest";
import { clinicalDemandRows, learnerShifts, sectionShifts, inWindow } from "../src/lib/clinicaldemand";
import { demandUnits } from "../src/lib/scheduler";
import { assetDemand } from "../src/lib/assetmap";
import { withdrawnRule, type LoadRow } from "../src/lib/siteload";
import type { DatedInstance } from "../src/lib/capacitymodel";

// Phase 4 (docs/metrics-audit.md): identical scope parameters produce identical totals across the
// capacity views, because they share one definition of dated clinical demand; withdrawn students
// leave future demand unless explicitly kept.

const inst = (id: string, dateIso: string, C: number, Y: number, max: number, rotationType = "General Radiography", startTime: string | null = "07:00", kind = "CLINICAL"): DatedInstance => ({
  session: { id, kind, number: 1, title: null, lengthHours: 8, maxStudents: max, rotationType, startTime, preceptorsNeeded: 1, facultyNeeded: 0, clinicalMode: "Preceptor-led", dayOfWeek: "Mon", week: 1, location: null, deliveryMode: null, notes: null, supportStaffNeeded: 0 },
  computed: { C, Y }, cohortId: "co1", cohort: "Class of 2028", programId: "p1", program: "Rad", courseCode: "RAD-151", courseTitle: "Clin I", courseId: "c1",
  termIndex: 1, termName: "Term 1", semester: "Fall", weekOfTerm: 1, monday: null, mondayIso: dateIso, date: null, dateIso, month: dateIso.slice(0, 7), holiday: null,
} as unknown as DatedInstance);

const rotations = [{ rotationType: "General Radiography", settingCode: "GEN" }, { rotationType: "Operating Room", settingCode: "ORS" }];
const rows = [
  inst("s1", "2026-08-17", 41, 4, 12),            // 41 students in 4 sections of 12 → 41 learner-shifts, 4 shifts
  inst("s2", "2026-08-18", 19, 1, 20, "Operating Room"),
  inst("s3", "2026-08-19", 41, 2, 25, "Unmapped rotation"), // no setting code — still demand
  inst("s4", "2026-08-20", 30, 1, 30, "General Radiography", null, "LAB"), // not clinical
  inst("s5", "2026-09-30", 41, 4, 12),            // outside the window below
];

describe("one definition of dated clinical demand", () => {
  it("the scheduler and site capacity count the same learner-shifts and shifts for the same rows", () => {
    const base = clinicalDemandRows(rows, rotations);
    const sched = demandUnits(rows, rotations);
    const cap = assetDemand(rows, rotations);
    expect(learnerShifts(base)).toBe(41 + 19 + 41 + 41);
    expect(sched.reduce((n, u) => n + u.seats, 0)).toBe(learnerShifts(base));
    expect(cap.reduce((n, d) => n + d.students, 0)).toBe(learnerShifts(base));
    expect(sched.length).toBe(sectionShifts(base));
    expect(cap.reduce((n, d) => n + d.sections, 0)).toBe(sectionShifts(base));
  });
  it("agrees inside any window, and a lab is never clinical demand", () => {
    const base = inWindow(clinicalDemandRows(rows, rotations), "2026-08-17", "2026-08-31");
    const sched = demandUnits(rows, rotations).filter((u) => u.date >= "2026-08-17" && u.date <= "2026-08-31");
    const cap = assetDemand(rows, rotations).filter((d) => d.iso >= "2026-08-17" && d.iso <= "2026-08-31");
    expect(learnerShifts(base)).toBe(101);
    expect(sched.reduce((n, u) => n + u.seats, 0)).toBe(101);
    expect(cap.reduce((n, d) => n + d.students, 0)).toBe(101);
    expect(base.some((d) => d.row.session.kind === "LAB")).toBe(false);
  });
  it("caps students at sections × seats, and maps the setting the same way in both views", () => {
    const over = [inst("x", "2026-08-17", 50, 2, 12)]; // only 24 can sit
    expect(learnerShifts(clinicalDemandRows(over, rotations))).toBe(24);
    expect(demandUnits(over, rotations).reduce((n, u) => n + u.seats, 0)).toBe(24);
    expect(assetDemand(over, rotations)[0].students).toBe(24);
    expect(demandUnits(rows, rotations).find((u) => u.sessionId === "s2")!.settingCode).toBe("ORS");
    expect(assetDemand(rows, rotations).find((d) => d.sessionId === "s2")!.settingCode).toBe("ORS");
    expect(assetDemand(rows, rotations).find((d) => d.sessionId === "s3")!.settingCode).toBeNull();
  });
});

describe("withdrawn students leave future demand unless kept", () => {
  const row = (o: Partial<LoadRow>): LoadRow => ({ studentId: "s1", student: "Ada", cohortId: "c1", cohort: "Class of 2028", programId: "p1", program: "Radiography", familyId: "f1", family: "Radiography", course: "RAD-151", term: "Term 1", date: "2026-08-18", year: 2026, semester: "Fall", dayOfWeek: "Tue", hours: 8, status: "scheduled", employerId: "e1", site: "Moore Regional", system: null, county: null, ring: null, facilityType: null, driveMinutes: null, setting: "GEN", preceptorId: null, preceptor: null, instructorId: null, instructor: null, supervision: "precepted" as const, instructorNeeded: false, preceptorNeeded: true, learnersOnShift: 1, instructorHours: 0, instructorShare: 0, instructorOversight: false, preceptorHours: 8, preceptorShare: 8, agreement: "secured", studentStatus: "enrolled", keepAssignments: false, assetId: null, asset: null, block: null, seatsPerShift: null, ...o });
  const today = "2026-09-18";
  it("keeps a withdrawn student's past shifts, drops their future and undated ones, and counts what it dropped", () => {
    const r = withdrawnRule([
      row({ studentId: "w", studentStatus: "withdrawn", date: "2026-08-18" }),
      row({ studentId: "w", studentStatus: "withdrawn", date: "2026-10-06" }),
      row({ studentId: "w", studentStatus: "withdrawn", date: null }),
      row({ studentId: "a", date: "2026-10-06" }),
    ], today);
    expect(r.rows.map((x) => `${x.studentId}:${x.date}`)).toEqual(["w:2026-08-18", "a:2026-10-06"]);
    expect(r).toMatchObject({ excluded: 2, kept: 0, students: 1 });
  });
  it("an explicit flag keeps them on the books", () => {
    const r = withdrawnRule([row({ studentId: "w", studentStatus: "withdrawn", keepAssignments: true, date: "2026-10-06" })], today);
    expect(r.rows).toHaveLength(1);
    expect(r).toMatchObject({ excluded: 0, kept: 1 });
  });
});
