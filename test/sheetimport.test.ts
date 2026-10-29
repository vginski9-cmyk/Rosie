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

// The Program Planning Template's "Program Data_All Together" sheet (Craven's Nurse Aide workbook, 2026-10-27): a header row
// that names the program before the sessions, and count cells the college wrote as text.
describe("sheet import — the Program Planning Template", () => {
  const header = ["Institution Name", "Program Name", "Program Type", "Term", "Course", "Session Type", "Session Number", "session title (if used)", "Session Delivery Mode", "Session Location", "Session length (in hours)", "Max number of students that ONE session can accommodate", "Number of faculty required to teach full session", "Contact hour policy for faculty during session (___hrs per contact hour)", "Number of support staff required to teach full session", "Contact hour policy for support staff during session (___hrs per contact hour)", "This session occurs during  Week __ of term", "This session occurs on ____.", "Notes", "Number of preceptors required to teach full clinical session", "Contact hour policy for preceptors during session (___hrs per contact hour)", "Clinical Rotation Type", "Clinical Mode"];
  const row1 = ["Craven CC", "Nurse Aide Level I", "Hybrid", "Term 6", "Nurse Aide Level I", "Class", "1", "Module A: The Nurse Aide I", "In-person + online", "Classroom", "1.8", "*10 CCP;16 &22 seats Non-CCP", "*1:10 ratio", "1", "0", "1", "1", "Tuesday", "Class, 8:30a-12p Day; 5;30-9p Evening non-CCP; 7:30a-11a CCP + online CCP", "0", "1", "", ""];
  const row2 = ["Craven CC", "Nurse Aide Level I", "Hybrid", "Term 6", "Nurse Aide Level I", "Clinical", "1", "Personal Care Skills", "In-person", "Clinical", "4", "*1:10 ratio", "*1:10 ratio", "1", "0", "1", "10", "Tuesday", "Clinical, 5:30-9:30p", "0", "1", "Long-Term Care", "Instructor-Led Clinical Group"];
  it("keeps the session-type column for the kind although Program Type comes first, and reads the program's own headers as nothing", () => {
    const det = detectHeader([header, row1])!;
    expect(det.map[5]).toBe("kind");
    expect(Object.values(det.map)).not.toContain(undefined);
    expect([mapHeader("Program Type"), mapHeader("Program Name"), mapHeader("Institution Name"), mapHeader("VERSION")]).toEqual([null, null, null, null]);
    expect([det.map[3], det.map[4], det.map[16], det.map[17]]).toEqual(["termNumber", "courseCode", "week", "dayOfWeek"]);
    expect(det.unmapped.map((u) => u.header)).toEqual(["Institution Name", "Program Name", "Program Type"]);
  });
  it("reads a clinical-typed row in a campus room as a lab on campus and an asynchronous online row without its placeholder day", () => {
    const lab = ["Craven CC", "Nurse Aide Level I", "Hybrid", "Term 1", "NA I (DAY)", "Clinical", "14", "Lab", "In-person", "Lab", "4", "16", "2", "1.379", "0", "1", "13", "Thursday", "Post-clinical skills lab (state exam prep), 8:30a-12:30p, whole cohort", "0", "1", "Long-Term Care", "Instructor-Led Clinical Group"];
    const online = ["Craven CC", "Nurse Aide Level I", "Hybrid", "Term 1", "NA I (CCP)", "Online", "1", "Online module - Week 1", "Online (asynchronous)", "Online / LMS", "1.5", "10", "1", "1", "0", "1", "1", "Friday", "Weekly online content; day is a placeholder", "0", "1", "", ""];
    const det = detectHeader([header, lab, online])!;
    const { sessions, issues } = rowsToSessions([header, lab, online], det);
    expect([sessions[0].kind, sessions[0].rotationType, sessions[0].clinicalMode, sessions[0].maxStudents, sessions[0].facultyNeeded, sessions[0].startTime]).toEqual(["LAB", null, null, 16, 2, "08:30"]);
    expect(sessions[0].notes).toMatch(/^In the program's clinical-hours bucket, held on campus\./);
    expect([sessions[1].kind, sessions[1].dayOfWeek, sessions[1].startTime, sessions[1].lengthHours]).toEqual(["CLASS", null, null, 1.5]);
    expect(issues.some((i) => /read as lab on campus/.test(i)) && issues.some((i) => /placeholder, left blank/.test(i))).toBe(true);
  });
  it("reads a ratio as seats or staff, leaves a several-figure cell blank with the text in the notes, and takes the start time from the notes", () => {
    const det = detectHeader([header, row1, row2])!;
    const { sessions, issues } = rowsToSessions([header, row1, row2], det);
    expect(sessions).toHaveLength(2);
    expect([sessions[0].kind, sessions[0].termNumber, sessions[0].maxStudents, sessions[0].facultyNeeded, sessions[0].startTime]).toEqual(["CLASS", 6, null, 1, "08:30"]);
    expect(sessions[0].notes).toMatch(/several figures, left blank/);
    expect(issues.some((i) => /lists several figures/.test(i))).toBe(true);
    expect([sessions[1].kind, sessions[1].maxStudents, sessions[1].facultyNeeded, sessions[1].startTime, sessions[1].rotationType]).toEqual(["CLINICAL", 10, 1, "17:30", "Long-Term Care"]);
  });
});
