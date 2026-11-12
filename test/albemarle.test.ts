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

type Session = { facultyContactPolicy: number | null; facultyNeeded: number; kind: string; number: number; week: number; dayOfWeek: string | null; startTime: string | null; endTime: string | null; lengthHours: number; location: string | null; deliveryMode: string | null; maxStudents: number; supportStaffNeeded: number; supportContactPolicy: number | null; preceptorsNeeded: number; rotationType: string | null; clinicalMode: string | null; notes: string | null };
type Course = { code: string; title: string; weeklyClassHours: number; weeklyLabHours: number; weeklyClinicalHours: number; credits: number; description: string; sessions: Session[] };
type Pack = { name: string; programType: string; credential: string; maxCohort: number | null; calendarMode?: string; note: string; assumptions: { facContactHours: number; facWorkWeekHours: number }; terms: { name: string; semester: string | null; startWeek: number; endWeek: number; courses: Course[] }[] };
type Course2 = Course & { courseType: string; requisites: string };
const load = (file: string) => JSON.parse(readFileSync(new URL(`../prisma/templates/${file}`, import.meta.url), "utf8")) as Pack;
const packs = ALBEMARLE_PROGRAMS.map((p) => load(p.pack));
const [aas, diploma, cert, ccp] = packs;
const courses = (p: Pack) => p.terms.flatMap((t) => t.courses) as Course2[];
const credits = (p: Pack) => courses(p).reduce((a, c) => a + c.credits, 0);
const course = (p: Pack, code: string) => courses(p).find((c) => c.code === code)!;
const CORE = ["MED 110", "MED 121", "MED 130", "MED 131", "MED 122", "MED 118", "OST 164", "OST 247", "OST 148", "OST 136", "OST 248", "OST 249"];
const coreOf = (p: Pack) => CORE.map((code) => course(p, code));
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
    expect(ALBEMARLE_PROGRAMS.map((p) => [p.pack, p.launch])).toEqual([["albemarle-moa-aas.json", "FALL"], ["albemarle-moa-diploma.json", "FALL"], ["albemarle-moa-cert-patient-rep.json", "FALL"], ["albemarle-moa-ccp.json", "FALL"]]);
    expect(COA_PLACEHOLDER_FAMILIES.map((f) => f.name)).toEqual(["Nurse Aide (CNA)", "Medical Assisting"]);
    expect(inst.families[0].description).toMatch(/Owens Health Sciences Center/);
    expect(inst.families[0].description).toMatch(/18 contact hours of a 40-hour week/);
    expect(inst.families[0].description).toMatch(/four credentials/);
  });
  it("the four credentials are the 2026–27 catalog's sequences, the core courses on the workbook's rows, credits the catalog's", () => {
    expect(packs.map((p) => [p.name, p.programType, p.credential, p.terms.length, credits(p), p.maxCohort, p.calendarMode])).toEqual([
      ["Medical Office Administration AAS (A25310MO, hybrid)", "Hybrid", "AAS", 4, 64, 20, "semester"],
      ["Medical Office Administration Diploma (D25310MO)", "Hybrid", "Diploma", 3, 38, 20, "semester"],
      ["Patient Representative Certificate (C25310PR)", "Online", "Certificate", 2, 18, 25, "semester"],
      ["Medical Office Administration CCP pathway (C25310H)", "High school (CCP)", "Certificate", 2, 16, 25, "semester"],
    ]);
    for (const p of packs) expect([p.assumptions.facContactHours, p.assumptions.facWorkWeekHours]).toEqual([18, 40]);
    expect(aas.terms.map((t) => [t.name, t.semester, t.endWeek - t.startWeek + 1, t.courses.map((c) => c.code)])).toEqual([
      ["Year 1 Fall", "Fall", 16, ["MED 110", "MED 121", "MED 130", "MED 131", "ENG 111", "BIO 163"]],
      ["Year 1 Spring", "Spring", 16, ["ENG 112", "MED 122", "CIS 111", "MED 118", "OST 164", "OST 247"]],
      ["Year 2 Fall", "Fall", 16, ["MAT 143", "OST 148", "CTS 115", "BUS 151", "OST 136", "OST 248"]],
      ["Year 2 Spring", "Spring", 16, ["OST 249", "Humanities/Fine Arts elective", "BUS 137", "WBL 111", "WBL 110", "PSY 150"]],
    ]);
    expect(diploma.terms.map((t) => [t.name, t.semester, t.endWeek - t.startWeek + 1, t.courses.map((c) => c.code)])).toEqual([
      ["Fall", "Fall", 16, ["MED 110", "MED 121", "MED 130", "MED 131", "ENG 111", "CIS 111", "OST 148"]],
      ["Spring", "Spring", 16, ["BIO 163", "MED 122", "MED 118", "CTS 115", "OST 164"]],
      ["Summer", "Summer", 10, ["PSY 150", "BUS 151"]],
    ]);
    expect(cert.terms.map((t) => t.courses.map((c) => c.code))).toEqual([["CIS 111", "MED 121", "MED 130", "BUS 151"], ["MED 122", "MED 118", "OST 164"]]);
    expect(ccp.terms.map((t) => t.courses.map((c) => c.code))).toEqual([["MED 121", "CIS 111", "BUS 151"], ["MED 122", "MED 118", "OST 164"]]);
    // The twelve core courses, row for row from the workbook, in the AAS.
    expect(coreOf(aas).map((c) => [c.code, n(c, "CLASS"), hours(c, "CLASS"), n(c, "LAB"), hours(c, "LAB"), c.credits])).toEqual([
      ["MED 110", 8, 16, 0, 0, 1], ["MED 121", 16, 48, 0, 0, 3], ["MED 130", 8, 16, 8, 32, 2], ["MED 131", 8, 16, 8, 32, 2],
      ["MED 122", 10, 48, 0, 0, 3], ["MED 118", 10, 32, 0, 0, 2], ["OST 164", 16, 48, 0, 0, 3], ["OST 247", 16, 32, 16, 32, 3],
      ["OST 148", 16, 48, 14, 47.6, 3], ["OST 136", 12, 32.04, 12, 32.04, 3], ["OST 248", 16, 32, 16, 32, 3], ["OST 249", 16, 32, 16, 48, 3],
    ]);
    expect(Math.round(coreOf(aas).reduce((a, c) => a + hours(c, "CLASS") + hours(c, "LAB"), 0) * 100) / 100).toBe(655.68);
    expect(course(aas, "OST 164").description).toMatch(/print 5 credits for OST 164/);
    expect(course(aas, "MED 118").description).toMatch(/prints MED 118 three ways/);
    expect(course(aas, "OST 148").description).toMatch(/3-0-3; the workbook's rows/);
    expect(course(aas, "OST 249").requisites).toBe("OST 247 and OST 248");
    // The catalog's other courses: printed hours as one row a week, no section on record; the summer carries the same hours over 10 weeks.
    const bio = course(aas, "BIO 163");
    expect([bio.courseType, bio.credits, bio.weeklyClassHours, bio.weeklyLabHours, n(bio, "CLASS"), hours(bio, "CLASS"), n(bio, "LAB"), hours(bio, "LAB")]).toEqual(["GENED", 5, 4, 2, 16, 64, 16, 32]);
    expect(bio.sessions.every((s) => s.dayOfWeek === null && s.location === (s.kind === "LAB" ? "General lab" : "General classroom") && s.maxStudents === 30)).toBe(true);
    const psy = course(diploma, "PSY 150");
    expect([psy.weeklyClassHours, n(psy, "CLASS"), hours(psy, "CLASS")]).toEqual([4.8, 10, 48]);
    expect(course(aas, "BUS 137").requisites).toBe("BUS 110 or MED 131 or CTS 115");
    // WBL 111: the work-based term — 16 weeks × 10 hours with an approved employer, one student per supervisor (the owner's call over CTS 130).
    const wbl = course(aas, "WBL 111");
    expect([wbl.credits, wbl.weeklyClinicalHours, n(wbl, "CLINICAL"), hours(wbl, "CLINICAL")]).toEqual([1, 10, 16, 160]);
    expect(wbl.sessions.every((s) => s.kind === "CLINICAL" && s.maxStudents === 1 && s.preceptorsNeeded === 1 && s.facultyNeeded === 0.05 && s.rotationType === "Doctor's Office" && s.clinicalMode === "Precepted Experience" && s.location === "Approved employer (work-based learning)" && s.dayOfWeek === null)).toBe(true);
    expect(wbl.description).toMatch(/CTS 130 Spreadsheet/);
    for (const p of [diploma, cert, ccp]) for (const c of courses(p)) expect(c.sessions.some((s) => s.kind === "CLINICAL"), `${p.name} ${c.code}`).toBe(false);
    // Class sizes as the sheet gives them: 25, 20 on the coding courses, 30 on MED 118; policies 2.22 or 1 where an adjunct teaches.
    expect([...new Set(course(aas, "OST 248").sessions.map((s) => s.maxStudents))]).toEqual([20]);
    expect([...new Set(course(aas, "MED 118").sessions.map((s) => s.maxStudents))]).toEqual([30]);
    expect(course(aas, "OST 148").sessions.filter((s) => s.kind === "LAB").every((s) => s.facultyContactPolicy === 1)).toBe(true);
    expect(course(aas, "OST 136").sessions.filter((s) => s.kind === "CLASS").every((s) => s.facultyContactPolicy === 1)).toBe(true);
    expect(course(aas, "OST 249").sessions.every((s) => s.facultyContactPolicy === 2.22)).toBe(true);
    expect(course(aas, "MED 121").description).toMatch(/12-week format/);
    expect(aas.note).toMatch(/WBL 111/); expect(diploma.note).toMatch(/three semester/); expect(cert.note).toMatch(/fully online/); expect(ccp.note).toMatch(/C25310H/);
  });
  it("online rows have no day or time; the Tuesday labs sit in Owens 211 in every credential that lists the course; the sheet's week slips and transposed cells are corrected and said", () => {
    const online = coreOf(aas).flatMap((c) => c.sessions).filter((s) => s.deliveryMode === "Online");
    expect(online.length).toBe(242 - 16 - 1); // 16 in-person labs, one hybrid review session (MED 130 class 8, "TBA")
    expect(online.every((s) => s.dayOfWeek === null && s.startTime === null && s.location === "Internet")).toBe(true);
    for (const p of [aas, diploma, cert]) {
      const labs130 = course(p, "MED 130").sessions.filter((s) => s.kind === "LAB");
      expect(labs130.map((s) => `${s.week} ${s.dayOfWeek} ${s.startTime}-${s.endTime} ${s.location}`), p.name).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((w) => `${w} Tue 09:00-13:00 Owens 211`));
    }
    expect(course(aas, "MED 130").sessions.filter((s) => s.kind === "LAB")[0].notes).toMatch(/Posted 9a-12:50p/);
    const labs131 = course(aas, "MED 131").sessions.filter((s) => s.kind === "LAB");
    expect(labs131.map((s) => s.week)).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
    expect(labs131.every((s) => s.location === "Owens 211" && /Owen 211/.test(s.notes ?? ""))).toBe(true);
    expect(course(aas, "MED 130").sessions.find((s) => s.kind === "CLASS" && s.number === 8)?.deliveryMode).toBe("Hybrid");
    expect(course(aas, "MED 121").sessions.map((s) => s.week)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(course(aas, "MED 121").sessions[12].notes).toMatch(/week column reads 10 for this row; placed in week 13/);
    expect(course(aas, "MED 130").sessions.filter((s) => s.kind === "CLASS").map((s) => s.week)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(course(aas, "MED 122").sessions.map((s) => [s.number, s.week])).toEqual(Array.from({ length: 10 }, (_, i) => [i + 1, i + 1]));
    expect(course(aas, "OST 248").sessions.filter((s) => s.kind === "LAB").every((s) => s.supportStaffNeeded === 0 && s.supportContactPolicy === 1 && /transposed/.test(s.notes ?? ""))).toBe(true);
    expect(course(aas, "OST 248").description).toMatch(/course-code cell is blank/);
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
