import { describe, expect, it } from "vitest";
import { sliceBy, siteStats, siteByPeriod, concentration, applyFilter, optionsOf, pivot, rowsToCsv, pivotToCsv, supervisedBy, supervisorMissing, ratioLabel, NO_SEAT, type LoadRow, type SiteSeats } from "../src/lib/siteload";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const row = (o: Partial<LoadRow>): LoadRow => { const date = o.date ?? "2026-08-18"; const d = new Date(date + "T00:00:00Z"); return { studentId: "s1", student: "Ada", cohortId: "c1", cohort: "Class of 2028", programId: "p1", program: "Radiography", familyId: "f1", family: "Radiography", course: "RAD-151", term: "Term 1", date, year: d.getUTCFullYear(), semester: "Fall", dayOfWeek: DOW[d.getUTCDay()], hours: 8, status: "scheduled", employerId: "e1", site: "Moore Regional", system: "FirstHealth", county: "Moore", ring: "Core", facilityType: "Acute care hospital", driveMinutes: 9, studentStatus: "enrolled", keepAssignments: false, setting: "GEN", preceptorId: "q1", preceptor: "B. Quinn", instructorId: null, instructor: null, supervision: "precepted" as const, instructorNeeded: false, preceptorNeeded: true, learnersOnShift: 1, instructorHours: 0, instructorShare: 0, instructorOversight: false, preceptorHours: 8, preceptorShare: 8, agreement: "secured", assetId: "a1", asset: "H001-GEN-01", block: "Day", seatsPerShift: 2, ...o }; };
const rows = [
  row({}), row({ date: "2026-08-19" }), row({ studentId: "s2", student: "Bo", date: "2026-08-18", preceptorId: "q2" }),
  row({ studentId: "s3", student: "Cy", cohortId: "c2", programId: "p2", employerId: "e2", site: "Central Carolina", system: "Duke LifePoint", county: "Lee", ring: "Ring 1", program: "Surgical Technology", setting: "ORS", date: "2026-08-25", assetId: "b1", asset: "H002-OR-01", seatsPerShift: 1 }),
];

describe("clinical site load", () => {
  // Moore Regional: two GEN rooms of 2 seats each (a1, a2) and a fluoro room of 1 seat that surgical technology never uses.
  const seats: SiteSeats[] = [{ employerId: "e1", preceptorsOnRecord: 5, assets: [
    { assetId: "a1", name: "H001-GEN-01", settingCode: "GEN", learnersPerShift: 2, blocks: ["Day", "Evening"] },
    { assetId: "a2", name: "H001-GEN-02", settingCode: "GEN", learnersPerShift: 2, blocks: ["Day"] },
    { assetId: "a3", name: "H001-FLUORO-01", settingCode: "FLUORO", learnersPerShift: 1, blocks: ["Day"] },
  ] }];
  const familySettings = { f1: ["GEN", "FLUORO"], f2: ["ORS"] };
  it("ranks sites by student-shifts with share, students, programs and settings — full is measured shift by shift against the seats open that shift", () => {
    const s = siteStats(rows, seats, familySettings);
    expect(s[0].site).toBe("Moore Regional");
    expect(s[0].studentDays).toBe(3); expect(s[0].students).toBe(2); expect(s[0].share).toBeCloseTo(0.75, 6);
    expect(s[0].peakDayStudents).toBe(2); expect(s[0].avgStudentsPerActiveDay).toBeCloseTo(1.5, 6);
    // Two Day shifts hosted (Aug 18 with 2 students, Aug 19 with 1); radiography's Day seats = 2 + 2 + 1 = 5 each → 3 of 10.
    expect(s[0].placed).toBe(3); expect(s[0].unplaced).toBe(0);
    expect(s[0].shiftsUsed).toBe(2); expect(s[0].peakShiftStudents).toBe(2); expect(s[0].avgStudentsPerShift).toBeCloseTo(1.5, 6);
    expect(s[0].seatsPerShift).toBe(5);
    expect(s[0].utilization).toBeCloseTo(0.3, 6); expect(s[0].peakShare).toBeCloseTo(0.4, 6);
    // Asset by asset: everything sat on a1 (2 seats): 3 student-shifts over 2 shifts, fullest 2 of 2, fill 3 of 4.
    expect(s[0].assets).toEqual([{ assetId: "a1", name: "H001-GEN-01", settingCode: "GEN", seatsPerShift: 2, studentShifts: 3, shiftsUsed: 2, peakStudents: 2, fill: 0.75 }]);
    expect(s[0].preceptorsUsed).toBe(2); expect(s[0].preceptorsOnRecord).toBe(5);
    expect(s[0].programs).toEqual([{ name: "Radiography", studentDays: 3, students: 2 }]);
    expect(s[1].site).toBe("Central Carolina"); expect(s[1].utilization).toBeNull(); expect(s[1].seatsPerShift).toBeNull();
  });
  it("an Evening shift is measured against Evening seats, never against the day's — and an asset in use always counts as open", () => {
    // Aug 18: a1 hosts 2 on Day; the same room hosts 1 on Evening. Evening seats in GEN/FLUORO = a1 only (2).
    const r = [...rows.slice(0, 3), row({ studentId: "s3", student: "Cy", date: "2026-08-18", block: "Evening" })];
    const s = siteStats(r, seats, familySettings)[0];
    expect(s.shiftsUsed).toBe(3); expect(s.utilization).toBeCloseTo(4 / 12, 6); expect(s.peakShare).toBeCloseTo(0.5, 6);
    // A room booked outside its listed blocks (a hand-made booking) still counts as a seat that shift.
    const t = siteStats([row({ assetId: "a2", asset: "H001-GEN-02", block: "Night" })], seats, familySettings)[0];
    expect(t.utilization).toBeCloseTo(0.5, 6);
  });
  it("a student-shift with no seat is shown at its pattern site but is never load on the site's seats", () => {
    const r = [...rows.slice(0, 3), row({ studentId: "s4", student: "Di", assetId: null, asset: null, block: null, seatsPerShift: null })];
    const s = siteStats(r, seats, familySettings)[0];
    expect(s.studentDays).toBe(4); expect(s.placed).toBe(3); expect(s.unplaced).toBe(1);
    expect(s.utilization).toBeCloseTo(0.3, 6);
    expect(optionsOf(r, "seat")).toEqual(["booked seat", NO_SEAT]);
    expect(applyFilter(r, { seat: new Set([NO_SEAT]) })).toHaveLength(1);
  });
  it("a site over its seats on some shift is flagged by the fullest shift, not hidden by the average", () => {
    // 3 students on one Day shift of a 2-seat room (a hand-made double booking) and an empty second shift.
    const r = [row({}), row({ studentId: "s2" }), row({ studentId: "s3" }), row({ date: "2026-08-19" })];
    const one = [{ employerId: "e1", preceptorsOnRecord: 0, assets: [{ assetId: "a1", name: "H001-GEN-01", settingCode: "GEN", learnersPerShift: 2, blocks: ["Day"] }] }];
    const s = siteStats(r, one, { f1: ["GEN"] })[0];
    expect(s.utilization).toBeCloseTo(1, 6); expect(s.peakShare).toBeCloseTo(1.5, 6);
    expect(s.assets[0].peakStudents).toBe(3);
  });
  it("reads drive-time bands, assets and shifts as dimensions — never a ring name", () => {
    expect(optionsOf(rows, "ring")).toEqual(["≤ 30 min", "30–60 min"]);
    expect(sliceBy(rows, "ring").map((x) => [x.label, x.studentDays])).toEqual([["≤ 30 min", 3], ["30–60 min", 1]]);
    expect(optionsOf(rows, "asset")).toEqual(["H001-GEN-01 — Moore Regional", "H002-OR-01 — Central Carolina"]);
    expect(optionsOf(rows, "block")).toEqual(["Day"]);
    expect(rowsToCsv(rows).split("\r\n")[0]).toContain("Drive time,Facility type,Drive min,Setting,Asset,Shift,Seats per shift");
    expect(rowsToCsv(rows)).not.toMatch(/Core|Ring 1/);
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

describe("supervision on a shift — instructors and preceptors, and the time each gives", () => {
  // Lenoir-style instructor-led group: 6 h, ten learners on the shift, one instructor; no preceptor required.
  const led = (o: Partial<LoadRow>): LoadRow => row({ program: "Nurse Aide", cohort: "Cohort 41", cohortId: "c9", programId: "p9", employerId: "e9", site: "Kinston Rehab", setting: "LTC", hours: 6, supervision: "instructor-led", instructorNeeded: true, preceptorNeeded: false, preceptorId: null, preceptor: null, instructorId: "i1", instructor: "R. Ellis", learnersOnShift: 10, instructorHours: 6, instructorShare: 0.6, preceptorHours: 0, preceptorShare: 0, ...o });
  const group = Array.from({ length: 10 }, (_, i) => led({ studentId: `n${i}`, student: `Learner ${i}` }));
  it("reads each role by what the template requires: named, missing, or none required — never a gap for a role the model does not ask for", () => {
    expect(supervisedBy(group[0])).toBe("instructor named");
    expect(supervisedBy(led({ instructorId: null }))).toBe("nobody named");
    expect(supervisedBy(rows[0])).toBe("preceptor named");
    expect(supervisedBy(led({ preceptorId: "q1", preceptorNeeded: true }))).toBe("instructor and preceptor");
    expect(supervisedBy(led({ instructorId: null, instructorNeeded: false }))).toBe("none required");
    expect(supervisorMissing(led({ instructorId: null }))).toEqual({ instructor: true, preceptor: false });
    expect(supervisorMissing(rows[0])).toEqual({ instructor: false, preceptor: false });
    expect(ratioLabel(group[0])).toBe("1 : 10"); expect(ratioLabel(rows[0])).toBe("1 : 1");
    expect(optionsOf([...group, rows[0], led({ instructorId: null, instructor: null, instructorNeeded: true })], "instructor")).toEqual(["(none named)", "(none required)", "R. Ellis"]);
    expect(optionsOf([...group, rows[0]], "supervision")).toEqual(["instructor-led", "precepted"]);
    expect(optionsOf([...group, rows[0]], "supervised")).toEqual(["instructor named", "preceptor named"]);
  });
  it("instructor hours are the learners' shares summed — over a shift they add back up to the instructor's time on it", () => {
    const p = pivot(group, "instructor", null, "instructorHours");
    expect(p.rows).toHaveLength(1); expect(p.rows[0].label).toBe("R. Ellis");
    expect(p.rows[0].total).toBeCloseTo(6, 6); // ten × 0.6 h = the 6 h the instructor was on the shift, not 60
    expect(pivot(group, "site", null, "instructors").grand).toBe(1);
    expect(pivot(group, "site", null, "preceptorHours").grand).toBe(0);
    expect(pivot(rows, "preceptor", null, "preceptorHours").grand).toBe(32); // four 1:1 precepted shifts of 8 h
    const byRatio = pivot([...group, rows[0]], "ratio", null, "studentDays");
    expect(byRatio.rows.map((r) => r.label)).toEqual(["1 : 10", "1 : 1"]);
  });
  it("site stats carry instructors named, the hours received and the shifts whose required supervisor is missing", () => {
    const s = siteStats([...group, led({ studentId: "n10", instructorId: null, instructor: null, instructorShare: 0 })], [], {})[0];
    expect(s.instructorsUsed).toBe(1); expect(s.preceptorsUsed).toBe(0);
    expect(s.instructorHours).toBeCloseTo(6, 6); expect(s.preceptorHours).toBe(0);
    expect(s.studentDaysPerInstructor).toBe(11); expect(s.unsupervisedShifts).toBe(1);
    expect(siteStats(rows, [], {})[0].unsupervisedShifts).toBe(0);
  });
  it("the CSV states both roles, the model, who supervised, the learners on the shift and each role's hours on it and for this student", () => {
    const csv = rowsToCsv([group[0], rows[0]]);
    const head = csv.split("\r\n")[0].split(",");
    for (const col of ["Preceptor", "Instructor", "Supervision", "Supervised by", "Learners on shift", "Instructor hours on shift", "Instructor hours (this student's share)", "Preceptor hours on shift", "Preceptor hours (this student's share)"]) expect(head).toContain(col);
    const at = (line: string[], col: string) => line[head.indexOf(col)];
    const l1 = csv.split("\r\n")[1].split(","), l2 = csv.split("\r\n")[2].split(",");
    expect([at(l1, "Preceptor"), at(l1, "Instructor"), at(l1, "Supervision"), at(l1, "Supervised by"), at(l1, "Learners on shift"), at(l1, "Instructor hours on shift"), at(l1, "Instructor hours (this student's share)")]).toEqual(["none required", "R. Ellis", "instructor-led", "instructor named", "10", "6", "0.6"]);
    expect([at(l2, "Preceptor"), at(l2, "Instructor"), at(l2, "Supervision"), at(l2, "Preceptor hours on shift"), at(l2, "Preceptor hours (this student's share)")]).toEqual(["B. Quinn", "none required", "precepted", "8", "8"]);
    // A filter on the instructor or on who supervised narrows the rows like any other dimension.
    expect(applyFilter([...group, rows[0]], { instructor: new Set(["R. Ellis"]) })).toHaveLength(10);
    expect(applyFilter([...group, rows[0]], { supervised: new Set(["preceptor named"]) })).toHaveLength(1);
  });
});
