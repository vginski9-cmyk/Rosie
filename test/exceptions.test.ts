import { describe, it, expect } from "vitest";
import { overCapacityDays, unsecuredPlacements, unsupervisedShifts, sortExceptions, blockedFamilies, requirementFindings, type LoadRowLite, type ExceptionItem } from "../src/lib/exceptions";

// Phase 7 (docs/metrics-audit.md §13): the exception queue's rules over site-load rows.

const row = (o: Partial<LoadRowLite> & { studentId: string; date: string }): LoadRowLite => ({ cohortId: "c1", cohort: "Class of 2028", programId: "p1", familyId: "f1", family: "Radiography", status: "scheduled", employerId: "e1", site: "Moore Regional", agreement: "secured", preceptorId: "pr1", preceptorsNeeded: 1, ...o });
const today = "2026-09-18";

describe("exception rules", () => {
  it("a site over its students-at-once on a day is one exception per site, counting the days and the worst one", () => {
    const rows = [
      ...["a", "b", "c", "d"].map((s) => row({ studentId: s, date: "2026-10-06" })),   // 4 at once
      ...["a", "b", "c"].map((s) => row({ studentId: s, date: "2026-10-13" })),        // 3 — over a cap of 2
      ...["a", "b"].map((s) => row({ studentId: s, date: "2026-10-20" })),             // 2 — at the cap
      ...["a", "b", "c"].map((s) => row({ studentId: s, date: "2026-08-04" })),        // past — ignored
      ...["a", "b", "c"].map((s) => row({ studentId: s, date: "2026-10-27", status: "completed" })), // logged — ignored
    ];
    const over = overCapacityDays(rows, [{ familyId: "f1", employerId: "e1", studentsAtOnce: 2 }], today);
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({ employerId: "e1", days: 2, worst: { date: "2026-10-06", students: 4, cap: 2 } });
    // No cap on record means unknown, never over.
    expect(overCapacityDays(rows, [{ familyId: "f1", employerId: "e1", studentsAtOnce: null }], today)).toHaveLength(0);
  });
  it("future shifts at sites without a secured agreement roll up by family with the sites named", () => {
    const rows = [
      row({ studentId: "a", date: "2026-10-06", agreement: "asked", site: "Randolph", employerId: "e2" }),
      row({ studentId: "b", date: "2026-10-06", agreement: "none", site: "Randolph", employerId: "e2" }),
      row({ studentId: "a", date: "2026-10-13", agreement: "prospect", site: "Hoke", employerId: "e3" }),
      row({ studentId: "c", date: "2026-10-13", agreement: "secured" }),
      row({ studentId: "d", date: "2026-08-01", agreement: "none", employerId: "e2" }),
    ];
    const u = unsecuredPlacements(rows, today);
    expect(u).toHaveLength(1);
    expect(u[0]).toMatchObject({ familyId: "f1", shifts: 3, students: 2, sites: ["Hoke", "Randolph"] });
  });
  it("an unnamed supervisor is a gap only where the session needs that role, and only ahead of today", () => {
    const rows = [
      row({ studentId: "a", date: "2026-10-06", preceptorId: null }),
      row({ studentId: "b", date: "2026-10-06", preceptorId: null }),
      row({ studentId: "a", date: "2026-10-13", preceptorId: null, preceptorsNeeded: 0 }), // instructor-led, no model on the row — no preceptor needed, no instructor asked for
      row({ studentId: "a", date: "2026-08-04", preceptorId: null }),                     // past
      row({ studentId: "c", date: "2026-10-20" }),
    ];
    const p = unsupervisedShifts(rows, today);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ cohortId: "c1", shifts: 2, students: 2, noPreceptor: 2, noInstructor: 0 });
    // Instructor-led shifts: an instructor missing is the gap; a preceptor is not required there. A combined shift missing both counts once, in both splits.
    const led = [
      row({ studentId: "a", date: "2026-10-06", preceptorId: null, preceptorsNeeded: 0, instructorNeeded: true, instructorId: null }),
      row({ studentId: "b", date: "2026-10-06", preceptorId: null, preceptorsNeeded: 0, instructorNeeded: true, instructorId: "i1" }),
      row({ studentId: "c", date: "2026-10-06", preceptorId: null, preceptorNeeded: true, instructorNeeded: true, instructorId: null }),
    ];
    expect(unsupervisedShifts(led, today)[0]).toMatchObject({ shifts: 2, noInstructor: 2, noPreceptor: 1 });
  });
  it("sorts blockers first and names the families that may not read green", () => {
    const item = (o: Partial<ExceptionItem> & { id: string; severity: ExceptionItem["severity"] }): ExceptionItem => ({ kind: "other", institutionId: null, institution: null, familyId: null, family: null, title: o.id, detail: "", href: "/", fix: "", count: 1, ...o });
    const items = sortExceptions([item({ id: "n", severity: "info" }), item({ id: "w", severity: "warning", count: 9 }), item({ id: "b2", severity: "blocker", count: 2, familyId: "f1" }), item({ id: "b1", severity: "blocker", count: 7, familyId: "f1" })]);
    expect(items.map((x) => x.id)).toEqual(["b1", "b2", "w", "n"]);
    expect([...blockedFamilies(items).entries()]).toEqual([["f1", 2]]);
  });
});

describe("requirement findings — the evaluation service's evidence gaps before any plan runs", () => {
  const s = (o: Partial<import("../src/lib/exceptions").ClinicalSessionLite> & { id: string }) => ({ programId: "p1", program: "Nurse Aide I", rotationType: "Acute MedSurg or LTC", clinicalMode: "Instructor-Led Clinical Group", facultyNeeded: 1, preceptorsNeeded: 0, maxStudents: 10, ...o });
  it("a compound rotation wording with no stored rule is unreviewed; a single mapped code is reviewed; an unknown mode or a missing count needs supervision review; a blank limit is unknown, an explicit 'unrestricted' is not", () => {
    const f = requirementFindings(
      [s({ id: "a" }), s({ id: "b", rotationType: "LTC" }), s({ id: "c", rotationType: "LTC", clinicalMode: null }), s({ id: "d", rotationType: "LTC", facultyNeeded: 0 })],
      [{ rotationType: "Acute MedSurg or LTC", settingCode: "BEDS" }, { rotationType: "LTC", settingCode: "LTC" }],
      [{ familyId: "f", family: "NA", employerId: "e1", site: "Crystal Coast SNF", agreementStatus: "secured", studentsAtOnce: null, studentsAtOnceMode: "unknown" }, { familyId: "f", family: "NA", employerId: "e2", site: "Carteret Health", agreementStatus: "secured", studentsAtOnce: null, studentsAtOnceMode: "unrestricted" }, { familyId: "f", family: "NA", employerId: "e3", site: "Asked Site", agreementStatus: "asked", studentsAtOnce: null, studentsAtOnceMode: "unknown" }],
    );
    expect(f.unreviewedRules).toHaveLength(1); expect(f.unreviewedRules[0]).toMatchObject({ rotationType: "Acute MedSurg or LTC", sessions: 1 }); expect(f.unreviewedRules[0].rule).toMatch(/BEDS.*LTC/);
    expect(f.supervisionUnknown).toHaveLength(1); expect(f.supervisionUnknown[0].sessions).toBe(2);
    expect(f.supervisionUnknown[0].questions.join(" ")).toMatch(/No clinical mode is recorded/); expect(f.supervisionUnknown[0].questions.join(" ")).toMatch(/no count or ratio/);
    expect(f.limitsUnknown.map((x) => x.employerId)).toEqual(["e1"]);
  });
});
