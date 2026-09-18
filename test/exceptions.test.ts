import { describe, it, expect } from "vitest";
import { overCapacityDays, unsecuredPlacements, unpreceptedShifts, sortExceptions, blockedFamilies, type LoadRowLite, type ExceptionItem } from "../src/lib/exceptions";

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
  it("an unnamed preceptor is a gap only where the session needs one, and only ahead of today", () => {
    const rows = [
      row({ studentId: "a", date: "2026-10-06", preceptorId: null }),
      row({ studentId: "b", date: "2026-10-06", preceptorId: null }),
      row({ studentId: "a", date: "2026-10-13", preceptorId: null, preceptorsNeeded: 0 }), // instructor-led
      row({ studentId: "a", date: "2026-08-04", preceptorId: null }),                     // past
      row({ studentId: "c", date: "2026-10-20" }),
    ];
    const p = unpreceptedShifts(rows, today);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ cohortId: "c1", shifts: 2, students: 2 });
  });
  it("sorts blockers first and names the families that may not read green", () => {
    const item = (o: Partial<ExceptionItem> & { id: string; severity: ExceptionItem["severity"] }): ExceptionItem => ({ kind: "other", institutionId: null, institution: null, familyId: null, family: null, title: o.id, detail: "", href: "/", fix: "", count: 1, ...o });
    const items = sortExceptions([item({ id: "n", severity: "info" }), item({ id: "w", severity: "warning", count: 9 }), item({ id: "b2", severity: "blocker", count: 2, familyId: "f1" }), item({ id: "b1", severity: "blocker", count: 7, familyId: "f1" })]);
    expect(items.map((x) => x.id)).toEqual(["b1", "b2", "w", "n"]);
    expect([...blockedFamilies(items).entries()]).toEqual([["f1", 2]]);
  });
});
