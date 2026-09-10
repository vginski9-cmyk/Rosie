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
