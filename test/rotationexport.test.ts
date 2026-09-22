import { describe, expect, it } from "vitest";
import { rotationSheets, sheetToCsv, mondayOf, type RotationRow } from "../src/lib/rotationexport";

const row = (o: Partial<RotationRow>): RotationRow => ({ student: "Ada", seat: 1, cohort: "Class of 2028", program: "Radiography", course: "RAD-151", courseName: "Clinical I", term: "Term 1", week: 1, date: "2026-08-18", weekday: "Tue", start: "08:00", hours: 8, session: "CLINICAL 1", setting: "GEN", area: "GEN", site: "Moore Regional", asset: "GEN 1", preceptor: "B. Quinn", status: "scheduled", hoursLogged: null, pinned: false, note: null, ...o });

describe("rotation export", () => {
  it("finds the Monday of a week", () => { expect(mondayOf("2026-08-18")).toBe("2026-08-17"); expect(mondayOf("2026-08-17")).toBe("2026-08-17"); expect(mondayOf("2026-08-23")).toBe("2026-08-17"); });
  it("builds the log, the week grid and the site load", () => {
    const rows = [row({}), row({ date: "2026-08-20", weekday: "Thu", session: "CLINICAL 2" }), row({ student: "Bo", seat: 2, site: "Central Carolina", setting: "ED", date: "2026-08-25", weekday: "Tue", week: 2 })];
    const s = rotationSheets(rows);
    expect(s["Rotation log"]).toHaveLength(4);
    expect(s["Rotation log"][1][0]).toBe("Ada");
    expect(s["Week by week"][0]).toEqual(["Student", "Seat", "Week of 2026-08-17", "Week of 2026-08-24", "Shifts", "Hours"]);
    expect(s["Week by week"][1]).toEqual(["Ada", 1, "Moore Regional · GEN (2d)", "", 2, 16]);
    expect(s["Week by week"][2]).toEqual(["Bo", 2, "", "Central Carolina · ED (1d)", 1, 8]);
    expect(s["Site load"][1]).toEqual(["Central Carolina", "ED", "", "1 students · 1d", 1, 1]);
  });
  it("adds a course column when several courses are exported together", () => {
    const s = rotationSheets([row({}), row({ course: "RAD-161", date: "2027-01-12", weekday: "Tue" })]);
    expect(s["Week by week"][0][2]).toBe("Course");
    expect(s["Week by week"]).toHaveLength(3);
  });
  it("writes CSV with quoting", () => {
    expect(sheetToCsv([["a", 'b "c"', null], [1, "x,y", 2]])).toBe('a,"b ""c""",\r\n1,"x,y",2\r\n');
  });
});

describe("rotation log — supervision columns", () => {
  it("states the instructor, the model, the learners on the shift and this student's share of each role's hours; a row without them exports blank", () => {
    const r1 = { student: "Ada", seat: 1, cohort: "Cohort 41", program: "Nurse Aide", course: "NAS-101", courseName: "Nurse Aide I", term: "Term 1", week: 3, date: "2026-09-08", weekday: "Tue", start: "07:00", hours: 6, session: "CLINICAL 1", setting: "LTC", area: "LTC", site: "Kinston Rehab", asset: "LTC 1", preceptor: null, status: "completed", hoursLogged: 6, pinned: false, note: null, instructor: "R. Ellis", supervision: "instructor-led", learnersOnShift: 10, instructorHours: 0.6, preceptorHours: 0 };
    const r2 = { ...r1, student: "Bo", seat: 2, instructor: undefined, supervision: undefined, learnersOnShift: undefined, instructorHours: undefined, preceptorHours: undefined };
    const log = rotationSheets([r1, r2])["Rotation log"];
    const head = log[0] as string[];
    for (const col of ["Preceptor", "Instructor", "Supervision", "Learners on shift", "Instructor hours (student's share)", "Preceptor hours (student's share)"]) expect(head).toContain(col);
    const at = (line: (string | number | null)[], col: string) => line[head.indexOf(col)];
    expect([at(log[1], "Instructor"), at(log[1], "Supervision"), at(log[1], "Learners on shift"), at(log[1], "Instructor hours (student's share)"), at(log[1], "Preceptor hours (student's share)")]).toEqual(["R. Ellis", "instructor-led", 10, 0.6, 0]);
    expect([at(log[2], "Instructor"), at(log[2], "Supervision"), at(log[2], "Instructor hours (student's share)")]).toEqual([null, null, null]);
  });
});
