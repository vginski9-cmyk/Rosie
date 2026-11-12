import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import XLSX from "xlsx";
import { ALBEMARLE_PROGRAMS, COA_PLACEHOLDER_FAMILIES, INSTITUTIONS, PAUSED_INSTITUTIONS } from "../prisma/seed-institutions";
import { parseAcademicCalendar, anchorsFromEvents } from "../src/lib/academiccalendar";
import { CALENDAR_FILES } from "../prisma/seed-calendars";
import { OTHER_CAMPUSES } from "../prisma/seed-campuses";
import { geocodeOffline } from "../src/lib/geo";
import { readPlanningTemplate, isEmptyBlock } from "../scripts/planning-template.mjs";

// College of The Albemarle's Medical Office Administration AAS (hybrid) from the college's own Program Planning Template
// (scripts/planning-template.mjs → scripts/build-albemarle-packs.mjs → prisma/templates/albemarle-moa-aas.json, 2026-11-12):
// the college's session rows, hours, class sizes and policies; credits the standard's; the data corrections said on the rows.

type Session = { facultyContactPolicy: number | null; kind: string; number: number; week: number; dayOfWeek: string | null; startTime: string | null; endTime: string | null; lengthHours: number; location: string | null; deliveryMode: string | null; maxStudents: number; supportStaffNeeded: number; supportContactPolicy: number | null; notes: string | null };
type Course = { code: string; title: string; weeklyClassHours: number; weeklyLabHours: number; weeklyClinicalHours: number; credits: number; description: string; sessions: Session[] };
type Pack = { name: string; programType: string; credential: string; maxCohort: number | null; calendarMode?: string; note: string; assumptions: { facContactHours: number; facWorkWeekHours: number }; terms: { name: string; semester: string | null; startWeek: number; endWeek: number; courses: Course[] }[] };
const pack = JSON.parse(readFileSync(new URL("../prisma/templates/albemarle-moa-aas.json", import.meta.url), "utf8")) as Pack;
const courses = pack.terms.flatMap((t) => t.courses);
const course = (code: string) => courses.find((c) => c.code === code)!;
const n = (c: Course, kind: string) => c.sessions.filter((s) => s.kind === kind).length;
const hours = (c: Course, kind: string) => Math.round(c.sessions.filter((s) => s.kind === kind).reduce((a, s) => a + s.lengthHours, 0) * 100) / 100;

describe("College of The Albemarle", () => {
  it("is seeded with its Medical Office Administration family only; the placeholders stay out", () => {
    expect(PAUSED_INSTITUTIONS.has("College of The Albemarle")).toBe(false);
    const inst = INSTITUTIONS.find((i) => i.name === "College of The Albemarle")!;
    expect([inst.short, inst.city]).toEqual(["COA", "Elizabeth City"]);
    expect(inst.families.map((f) => f.name)).toEqual(["Medical Office Administration"]);
    expect(inst.families[0].soc).toBe("43-6013");
    expect(inst.families[0].programs).toBe(ALBEMARLE_PROGRAMS);
    expect(ALBEMARLE_PROGRAMS.map((p) => [p.pack, p.launch])).toEqual([["albemarle-moa-aas.json", "FALL"]]);
    expect(COA_PLACEHOLDER_FAMILIES.map((f) => f.name)).toEqual(["Nurse Aide (CNA)", "Medical Assisting"]);
    expect(inst.families[0].description).toMatch(/Owens Health Sciences Center/);
    expect(inst.families[0].description).toMatch(/18 contact hours of a 40-hour week/);
  });
  it("the pack is the college's twelve core courses over four 16-week terms, row for row, with the standard's credits", () => {
    expect([pack.name, pack.programType, pack.credential, pack.maxCohort, pack.calendarMode, pack.assumptions.facContactHours, pack.assumptions.facWorkWeekHours]).toEqual(["Medical Office Administration AAS (A25310, hybrid)", "Hybrid", "AAS", 20, "semester", 18, 40]);
    expect(pack.terms.map((t) => [t.name, t.semester, t.endWeek - t.startWeek + 1, t.courses.map((c) => c.code)])).toEqual([
      ["Year 1 Fall", "Fall", 16, ["MED 110", "MED 121", "MED 130", "MED 131"]],
      ["Year 1 Spring", "Spring", 16, ["MED 122", "MED 118", "OST 164", "OST 247"]],
      ["Year 2 Fall", "Fall", 16, ["OST 148", "OST 136", "OST 248"]],
      ["Year 2 Spring", "Spring", 16, ["OST 249"]],
    ]);
    expect(courses.reduce((a, c) => a + c.credits, 0)).toBe(29);
    expect(courses.map((c) => [c.code, n(c, "CLASS"), hours(c, "CLASS"), n(c, "LAB"), hours(c, "LAB")])).toEqual([
      ["MED 110", 8, 16, 0, 0], ["MED 121", 16, 48, 0, 0], ["MED 130", 8, 16, 8, 32], ["MED 131", 8, 16, 8, 32],
      ["MED 122", 10, 48, 0, 0], ["MED 118", 10, 32, 0, 0], ["OST 164", 16, 48, 0, 0], ["OST 247", 16, 32, 16, 32],
      ["OST 148", 16, 48, 14, 47.6], ["OST 136", 12, 32.04, 12, 32.04], ["OST 248", 16, 32, 16, 32], ["OST 249", 16, 32, 16, 48],
    ]);
    expect(Math.round(courses.reduce((a, c) => a + hours(c, "CLASS") + hours(c, "LAB"), 0) * 100) / 100).toBe(655.68);
    for (const c of courses) { expect(c.weeklyClinicalHours).toBe(0); expect(c.sessions.some((s) => s.kind === "CLINICAL")).toBe(false); }
    // Class sizes as the sheet gives them: 25, 20 on the coding courses, 30 on MED 118.
    expect([...new Set(course("OST 248").sessions.map((s) => s.maxStudents))]).toEqual([20]);
    expect([...new Set(course("MED 118").sessions.map((s) => s.maxStudents))]).toEqual([30]);
    expect([...new Set(course("MED 121").sessions.map((s) => s.maxStudents))]).toEqual([25]);
    // Policies: 2.22 everywhere the sheet says so, 1 where an adjunct teaches (OST 148's labs, OST 136's class).
    expect(course("OST 148").sessions.filter((s) => s.kind === "LAB").every((s) => s.facultyContactPolicy === 1)).toBe(true);
    expect(course("OST 148").sessions.filter((s) => s.kind === "CLASS").every((s) => s.facultyContactPolicy === 2.22)).toBe(true);
    expect(course("OST 136").sessions.filter((s) => s.kind === "CLASS").every((s) => s.facultyContactPolicy === 1)).toBe(true);
    expect(course("OST 249").sessions.every((s) => s.facultyContactPolicy === 2.22)).toBe(true);
    expect(course("MED 121").description).toMatch(/12-week format/);
    expect(course("OST 247").description).toMatch(/NCCCS course library lists OST 247 at 1-2/);
    expect(pack.note).toMatch(/WBL 111/);
  });
  it("online rows have no day or time; the Tuesday labs sit in Owens 211; the sheet's week slips and transposed cells are corrected and said", () => {
    const online = courses.flatMap((c) => c.sessions).filter((s) => s.deliveryMode === "Online");
    expect(online.length).toBe(242 - 16 - 1); // 16 in-person labs, one hybrid review session (MED 130 class 8, "TBA")
    expect(online.every((s) => s.dayOfWeek === null && s.startTime === null && s.location === "Internet")).toBe(true);
    const labs130 = course("MED 130").sessions.filter((s) => s.kind === "LAB");
    expect(labs130.map((s) => `${s.week} ${s.dayOfWeek} ${s.startTime}-${s.endTime} ${s.location}`)).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((w) => `${w} Tue 09:00-13:00 Owens 211`));
    expect(labs130[0].notes).toMatch(/Posted 9a-12:50p/);
    const labs131 = course("MED 131").sessions.filter((s) => s.kind === "LAB");
    expect(labs131.map((s) => s.week)).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
    expect(labs131.every((s) => s.location === "Owens 211" && /Owen 211/.test(s.notes ?? ""))).toBe(true);
    expect(course("MED 130").sessions.find((s) => s.kind === "CLASS" && s.number === 8)?.deliveryMode).toBe("Hybrid");
    // MED 121's last six sessions read week 10 in the sheet; MED 130's class rows all read week 1.
    expect(course("MED 121").sessions.map((s) => s.week)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(course("MED 121").sessions[12].notes).toMatch(/week column reads 10 for this row; placed in week 13/);
    expect(course("MED 130").sessions.filter((s) => s.kind === "CLASS").map((s) => s.week)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // MED 122 numbered its third session "3" twice; numbers run 1–10 in week order.
    expect(course("MED 122").sessions.map((s) => [s.number, s.week])).toEqual(Array.from({ length: 10 }, (_, i) => [i + 1, i + 1]));
    // OST 248's lab rows carried 1 support staff at policy 0 — the class rows' 0 / 1 transposed.
    expect(course("OST 248").sessions.filter((s) => s.kind === "LAB").every((s) => s.supportStaffNeeded === 0 && s.supportContactPolicy === 1 && /transposed/.test(s.notes ?? ""))).toBe(true);
    expect(course("OST 248").description).toMatch(/course-code cell is blank/);
  });
  it("reads the template's course-block layout: a block with blank code and name cells still opens at its week rows; a deleted block is skipped", () => {
    const dir = mkdtempSync(join(tmpdir(), "coa-"));
    const rows: (string | number)[][] = [
      ["What week does term begin?", 1], ["What week does term end?", 16], [],
      ["Course Code", "MED 110"], ["Course Name", "Orientation"], [],
      ["Orientation Weekly class hours", 1, "", "", "", "Orientation Total class hours per term", 16],
      ["Orientation Weekly lab hours", 0, "", "", "", "", 0], ["Orientation Weekly clinical hours", 0, "", "", "", "", 0], [],
      ["For Orientation, how many class sessions are there?", 8, "(1st 8 wks)"],
      ["", "", "", "", "16/8= 2", "", "", "FT =18/20 = 2.22; Adjunct = 1", "", "support =1:1", "", "Online = SMTWThFS"],
      ["Class Session Number", "Class session title", "Session Delivery Mode"],
      [1, "Week one", "Online", "Internet", 2, 25, 1, 2.22, 0, 1, 1, "Online", "1st 8 wks, online"],
      [2, "Week two", "Online", "Internet", 2, 25, 1, 2.22, 0, 1, 2, "Online", "1st 8 wks, online"],
      ["", "", "", "Sum of total class hours per student", 4], [],
      ["What week does term begin?", 1], ["What week does term end?", 16], [],
      ["Course Code", "", "DELETED- per Rebecca (not a core course)"], ["Course Name"], [],
      [" Weekly class hours"], [" Weekly lab hours"], [" Weekly clinical hours"], [],
      ["Class Session Number", "Class session title"],
      ["", "", "", "", "", "", "", "", "", "", "", "", "", "", 1, "Orientation", "Online", "Internet", 2, 30, 1, 2.22, 0, 1, 1, "Online", "16 wks, online"],
      ["", "", "", "Sum of total class hours per student", ""], [],
      ["What week does term begin?", 1], ["What week does term end?", 16], [],
      ["Diagnostic Coding Weekly class hours", 2, "", "", "", "Diagnostic Coding Total class hours per term", 32],
      ["Diagnostic Coding Weekly lab hours", 2, "", "", "", "", 32], ["Diagnostic Coding Weekly clinical hours", 0, "", "", "", "", 0], [],
      ["For Diagnostic Coding, how many class sessions are there?", 16],
      ["Class Session Number", "Class session title"],
      [1, "Ch. 5", "Online", "Internet", 2, 20, 1, 2.22, 0, 1, 1, "Online", "16 wks, online", "", 1, "Smartbook", "Online", "Internet", 2, 20, 1, 2.22, 1, 0, 1, "Online", "16 wks, online"],
    ];
    const wb = XLSX.utils.book_new();
    const info = XLSX.utils.aoa_to_sheet([["Institution Name", "College of the Albemarle"], [], ["Program Name", "Medical Office Administration"], [], ["Program Type", "AAS; Hybrid"], [], ["NOTES"], ["Three semester program"]]);
    XLSX.utils.book_append_sheet(wb, info, "Institution Name, Program Type");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Term 1- Fa1");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Institution Name", "Program Name", "Session Type"]]), "Term 1 Data_RAW");
    const file = join(dir, "t.xlsx"); XLSX.writeFile(wb, file);
    const t = readPlanningTemplate(file);
    expect([t.institution, t.program, t.programType, t.notes]).toEqual(["College of the Albemarle", "Medical Office Administration", "AAS; Hybrid", ["Three semester program"]]);
    expect(t.terms.map((x) => [x.sheet, x.index, x.beginWeek, x.endWeek])).toEqual([["Term 1- Fa1", 1, 1, 16]]);
    const blocks = t.terms[0].courses;
    expect(blocks.map((c) => [c.code, c.title, c.weekly.CLASS, c.counts.CLASS, c.sessions.CLASS.length, c.sessions.LAB.length, isEmptyBlock(c)])).toEqual([
      ["MED 110", "Orientation", 1, 8, 2, 0, false],
      ["", "", null, null, 0, 1, true],
      ["", "Diagnostic Coding", 2, 16, 1, 1, false],
    ]);
    expect(blocks[0].policyLine).toMatch(/FT =18\/20 = 2.22/);
    expect(blocks[0].sessions.CLASS[1]).toEqual({ number: 2, title: "Week two", mode: "Online", location: "Internet", length: 2, max: 25, faculty: 1, facultyPolicy: 2.22, support: 0, supportPolicy: 1, week: 2, day: "Online", notes: "1st 8 wks, online" });
    expect(blocks[2].sessions.LAB[0].support).toBe(1);
    expect(blocks[1].flags).toEqual(["DELETED- per Rebecca (not a core course)"]);
    writeFileSync(file, "");
  });
  it("has the college's calendar, policies and places", () => {
    expect(CALENDAR_FILES["College of The Albemarle"]).toBe("albemarle.txt");
    const { events, warnings } = parseAcademicCalendar(readFileSync(new URL("../prisma/seed-data/calendars/albemarle.txt", import.meta.url), "utf8"));
    expect(warnings).toEqual([]);
    expect(events.filter((e) => e.kind === "term_start").map((e) => e.iso).slice(0, 4)).toEqual(["2026-08-17", "2027-01-11", "2027-05-17", "2027-08-16"]);
    expect(events.filter((e) => e.kind === "term_end").map((e) => e.iso).slice(0, 3)).toEqual(["2026-12-14", "2027-05-10", "2027-07-26"]);
    expect(events.filter((e) => e.kind === "holiday" && e.iso >= "2027-03-01" && e.iso < "2027-06-01").map((e) => [e.iso, e.endIso ?? null])).toEqual([["2027-03-29", null], ["2027-03-30", "2027-04-02"], ["2027-05-11", null], ["2027-05-31", null]]);
    expect(anchorsFromEvents(events, { springStart: "01-10", summerStart: "05-20", fallStart: "08-15" })).toEqual({ springStart: "01-08", summerStart: "05-15", fallStart: "08-14" });
    const roster = readFileSync(new URL("../prisma/seed-roster.ts", import.meta.url), "utf8");
    expect(roster).toMatch(/"College of The Albemarle": \{ "full-time": \{ contactHoursPerWeek: 18, workWeekHours: 40, hoursPerContactHour: null \}, "adjunct": \{ contactHoursPerWeek: 40, workWeekHours: 40, hoursPerContactHour: 1 \} \}/);
    const places = OTHER_CAMPUSES["College of The Albemarle"];
    expect(places.map((p) => [p.name, p.city, p.zip])).toEqual([["COA – Edenton-Chowan", "Edenton", "27932"], ["COA – Currituck", "Barco", "27917"], ["COA – Dare", "Manteo", "27954"]]);
    for (const p of places) expect(geocodeOffline({ city: p.city, state: p.state }), p.city).not.toBeNull();
    for (const town of ["Elizabeth City", "Camden", "Currituck", "Hertford", "Gatesville", "Kill Devil Hills"]) expect(geocodeOffline({ city: town, state: "NC" }), town).not.toBeNull();
  });
});
