import { describe, it, expect } from "vitest";
import { mapHeader, detectHeader, rowsToSessions, parseTime, parseDay, parseKind, textToRows } from "../src/lib/sheetimport";
import { CAPACITY_HEADERS } from "../src/lib/capacitymodel";

describe("sheet import", () => {
  it("recognizes the workbook's own headers, column by column", () => {
    expect(mapHeader(CAPACITY_HEADERS.A)).toBe("termNumber");
    expect(mapHeader(CAPACITY_HEADERS.B)).toBe("semester");
    expect(mapHeader(CAPACITY_HEADERS.D)).toBe("courseCode");
    expect(mapHeader(CAPACITY_HEADERS.E)).toBe("courseTitle");
    expect(mapHeader(CAPACITY_HEADERS.F)).toBe("kind");
    expect(mapHeader(CAPACITY_HEADERS.G)).toBe("number");
    expect(mapHeader(CAPACITY_HEADERS.H)).toBe("title");
    expect(mapHeader(CAPACITY_HEADERS.I)).toBe("deliveryMode");
    expect(mapHeader(CAPACITY_HEADERS.J)).toBe("location");
    expect(mapHeader(CAPACITY_HEADERS.K)).toBe("lengthHours");
    expect(mapHeader(CAPACITY_HEADERS.L)).toBe("maxStudents");
    expect(mapHeader(CAPACITY_HEADERS.M)).toBe("facultyNeeded");
    expect(mapHeader(CAPACITY_HEADERS.N)).toBe("facultyContactPolicy");
    expect(mapHeader(CAPACITY_HEADERS.O)).toBe("supportStaffNeeded");
    expect(mapHeader(CAPACITY_HEADERS.P)).toBe("supportContactPolicy");
    expect(mapHeader(CAPACITY_HEADERS.Q)).toBe("week");
    expect(mapHeader(CAPACITY_HEADERS.R)).toBe("dayOfWeek");
    expect(mapHeader(CAPACITY_HEADERS.S)).toBe("notes");
    expect(mapHeader(CAPACITY_HEADERS.T)).toBe("preceptorsNeeded");
    expect(mapHeader(CAPACITY_HEADERS.U)).toBe("preceptorContactPolicy");
    expect(mapHeader(CAPACITY_HEADERS.V)).toBe("rotationType");
    expect(mapHeader(CAPACITY_HEADERS.W)).toBe("clinicalMode");
    // Formula columns are not inputs.
    expect(mapHeader(CAPACITY_HEADERS.Y)).toBeNull();
  });

  it("recognizes everyday spreadsheet headers too", () => {
    expect(mapHeader("Course #")).toBe("courseCode");
    expect(mapHeader("Course Name")).toBe("courseTitle");
    expect(mapHeader("Type")).toBe("kind");
    expect(mapHeader("Duration")).toBe("lengthHours");
    expect(mapHeader("Capacity")).toBe("maxStudents");
    expect(mapHeader("Instructors")).toBe("facultyNeeded");
    expect(mapHeader("Day")).toBe("dayOfWeek");
    expect(mapHeader("Start Time")).toBe("startTime");
    expect(mapHeader("Rotation")).toBe("rotationType");
    expect(mapHeader("Comments")).toBe("notes");
    expect(mapHeader("Random column")).toBeNull();
  });

  it("finds the header row under a title block, fills merged cells down, numbers sessions, parses days & times", () => {
    const rows: unknown[][] = [
      ["Surgical Technology — Raw Data & Calculations"],
      [],
      ["Term Number", "Semester", "Course Code", "Course Title", "Session Type", "Session title (if used)", "Session length (in hours)", "Max number of students that ONE session can accommodate", "Number of faculty required to teach full session", "This session occurs during Week __ of term", "This session occurs on ____.", "Start time", "Clinical Rotation Type", "Clinical Mode"],
      [1, "Fall", "SUR-111", "Intro to Surgical Technology", "Class", "Lecture 1", 4, 24, 1, 1, "Monday", "8:00 AM"],
      ["", "", "", "", "Class", "Lecture 2", 4, 24, 1, 2, "M", "0800"],
      ["", "", "", "", "Lab", "Skills Lab 1", 4, 12, 2, 1, "Wed", 0.5],
      [2, "Spring", "SUR-134", "Surgical Procedures I", "Clinical", "OR Rotation", 8, 2, 0, 1, "Thurs", "7:00", "Operating Room", "Preceptor-led"],
      ["", "", "", "", "Clinical", "OR Rotation", 8, 2, 0, 2, "R", "7am", "Operating Room", "Preceptor-led"],
    ];
    const det = detectHeader(rows)!;
    expect(det.headerRow).toBe(2);
    expect(Object.values(det.map)).toContain("courseCode");
    const res = rowsToSessions(rows, det);
    expect(res.skipped).toBe(0);
    expect(res.sessions.map((s) => [s.termNumber, s.courseCode, s.kind, s.number, s.dayOfWeek, s.startTime])).toEqual([
      [1, "SUR-111", "CLASS", 1, "Mon", "08:00"],
      [1, "SUR-111", "CLASS", 2, "Mon", "08:00"],
      [1, "SUR-111", "LAB", 1, "Wed", "12:00"],
      [2, "SUR-134", "CLINICAL", 1, "Thu", "07:00"],
      [2, "SUR-134", "CLINICAL", 2, "Thu", "07:00"],
    ]);
    expect(res.sessions[3]).toMatchObject({ rotationType: "Operating Room", clinicalMode: "Preceptor-led", lengthHours: 8, maxStudents: 2, facultyNeeded: 0, semester: "Spring" });
  });

  it("parses helpers", () => {
    expect(parseTime("1:30 PM")).toBe("13:30");
    expect(parseTime("12:00 am")).toBe("00:00");
    expect(parseTime("1330")).toBe("13:30");
    expect(parseDay("Tuesday")).toBe("Tue");
    expect(parseDay("th")).toBe("Thu");
    expect(parseKind("Didactic")).toBe("CLASS");
    expect(parseKind("Clinical Practicum")).toBe("CLINICAL");
    expect(parseKind("Sim Lab")).toBe("LAB");
    expect(textToRows("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  });
});
