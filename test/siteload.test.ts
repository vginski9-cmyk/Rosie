import { describe, expect, it } from "vitest";
import { sliceBy, siteStats, siteByPeriod, concentration, applyFilter, optionsOf, pivot, rowsToCsv, pivotToCsv, type LoadRow } from "../src/lib/siteload";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const row = (o: Partial<LoadRow>): LoadRow => { const date = o.date ?? "2026-08-18"; const d = new Date(date + "T00:00:00Z"); return { studentId: "s1", student: "Ada", cohortId: "c1", cohort: "Class of 2028", programId: "p1", program: "Radiography", familyId: "f1", family: "Radiography", course: "RAD-151", term: "Term 1", date, year: d.getUTCFullYear(), semester: "Fall", dayOfWeek: DOW[d.getUTCDay()], hours: 8, status: "scheduled", employerId: "e1", site: "Moore Regional", system: "FirstHealth", county: "Moore", ring: "Core", facilityType: "Acute care hospital", driveMinutes: 9, setting: "GEN", preceptorId: "q1", preceptor: "B. Quinn", agreement: "secured", ...o }; };
const rows = [
  row({}), row({ date: "2026-08-19" }), row({ studentId: "s2", student: "Bo", date: "2026-08-18", preceptorId: "q2" }),
  row({ studentId: "s3", student: "Cy", cohortId: "c2", programId: "p2", employerId: "e2", site: "Central Carolina", system: "Duke LifePoint", county: "Lee", ring: "Ring 1", program: "Surgical Technology", setting: "ORS", date: "2026-08-25" }),
];

describe("clinical site load", () => {
  it("ranks sites by student-days with share, students, programs and settings", () => {
    const s = siteStats(rows, [{ employerId: "e1", seatsPerDay: 4, preceptorsOnRecord: 5 }]);
    expect(s[0].site).toBe("Moore Regional");
    expect(s[0].studentDays).toBe(3); expect(s[0].students).toBe(2); expect(s[0].share).toBeCloseTo(0.75, 6);
    expect(s[0].peakDayStudents).toBe(2); expect(s[0].avgStudentsPerActiveDay).toBeCloseTo(1.5, 6);
    expect(s[0].utilization).toBeCloseTo(0.375, 6);
    expect(s[0].preceptorsUsed).toBe(2); expect(s[0].preceptorsOnRecord).toBe(5);
    expect(s[0].programs).toEqual([{ name: "Radiography", studentDays: 3, students: 2 }]);
    expect(s[1].site).toBe("Central Carolina"); expect(s[1].utilization).toBeNull();
  });
  it("groups by system, county, setting and month", () => {
    expect(sliceBy(rows, "system").map((x) => [x.label, x.studentDays])).toEqual([["FirstHealth", 3], ["Duke LifePoint", 1]]);
    expect(sliceBy(rows, "county")[0]).toMatchObject({ label: "Moore", studentDays: 3, students: 2, sites: 1 });
    expect(sliceBy(rows, "setting").map((x) => x.key)).toEqual(["GEN", "ORS"]);
    expect(sliceBy(rows, "month")[0].key).toBe("2026-08");
  });
  it("builds the site × week grid", () => {
    const g = siteByPeriod(rows, "week");
    expect(g.periods).toEqual(["2026-08-17", "2026-08-24"]);
    expect(g.sites[0].cells).toEqual({ "2026-08-17": 2 });
    expect(g.sites[1].cells).toEqual({ "2026-08-24": 1 });
  });
  it("filters on any dimension and a date window", () => {
    expect(applyFilter(rows, { county: new Set(["Lee"]) })).toHaveLength(1);
    expect(applyFilter(rows, { dayOfWeek: new Set(["Tue"]) })).toHaveLength(3);
    expect(applyFilter(rows, { from: "2026-08-19", to: "2026-08-31" })).toHaveLength(2);
    expect(applyFilter(rows, { program: new Set(["Radiography"]), semester: new Set(["Fall 2026"]) })).toHaveLength(3);
    expect(optionsOf(rows, "semester")).toEqual(["Fall 2026"]);
    expect(optionsOf(rows, "dayOfWeek")).toEqual(["Tue", "Wed"]);
    // two programs can both run a "Class of 2028" — the cohort option keeps them apart
    expect(optionsOf(rows, "cohort")).toEqual(["Radiography · Class of 2028", "Surgical Technology · Class of 2028"]);
    expect(applyFilter(rows, { cohort: new Set(["Surgical Technology · Class of 2028"]) })).toHaveLength(1);
  });
  it("pivots any rows by any columns for any measure", () => {
    const p = pivot(rows, "site", "week", "students");
    expect(p.cols.map((c) => c.label)).toEqual(["2026-08-17", "2026-08-24"]);
    expect(p.rows[0]).toMatchObject({ label: "Moore Regional", cells: { "2026-08-17": 2 }, total: 2 });
    expect(p.grand).toBe(3);
    const q = pivot(rows, "semester", null, "hours");
    expect(q.rows[0]).toMatchObject({ label: "Fall 2026", total: 32 });
    expect(pivotToCsv(p, "Site").split("\r\n")[0]).toBe("Site,2026-08-17,2026-08-24,Total");
    expect(rowsToCsv(rows).split("\r\n")[1]).toContain("2026-08-18,Tue,2026,Fall,2026-08-17,Term 1,Radiography");
  });
  it("measures concentration", () => {
    expect(concentration(siteStats(rows), 1)).toEqual({ topShare: 0.75, top: ["Moore Regional"] });
  });
});
