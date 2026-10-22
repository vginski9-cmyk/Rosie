import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { INSTITUTIONS, PAUSED_INSTITUTIONS, BRUNSWICK_PROGRAMS } from "../prisma/seed-institutions";
import { parseAcademicCalendar, anchorsFromEvents } from "../src/lib/academiccalendar";
import { CALENDAR_FILES } from "../prisma/seed-calendars";

// Brunswick Community College's three prelicensure RN pathways as template packs built from the college's
// own publications (scripts/build-brunswick-packs.mjs): the information sheets' sequence, hours and credits
// and the published Fall 2026 – Summer 2027 sections' days, times, rooms and seats. Goal: the owner's 190 a year.

type Session = { kind: string; week: number; dayOfWeek: string | null; startTime: string | null; endTime: string | null; lengthHours: number; location: string | null; maxStudents: number; facultyNeeded: number; preceptorsNeeded: number; clinicalMode: string | null; notes: string | null };
type Course = { code: string; title: string; weeklyClassHours: number; weeklyLabHours: number; weeklyClinicalHours: number; credits: number; requisites: string; courseType: string; description: string | null; sessions: Session[] };
type Pack = { name: string; programType: string; credential: string; maxCohort: number; terms: { index: number; name: string; semester: string; startWeek: number; endWeek: number; courses: Course[] }[] };
const load = (file: string) => JSON.parse(readFileSync(new URL(`../prisma/templates/${file}`, import.meta.url), "utf8")) as Pack;
const packs = Object.fromEntries(BRUNSWICK_PROGRAMS.map((p) => [p.pack, load(p.pack)]));
// Hours shown on the 16-week catalog basis (a 9-week summer term carries them × 16/9 a week): weekly × weeks ÷ 16.
const basis = (h: number, weeks: number) => Math.round((h * weeks) / 16);
const table = (p: Pack) => p.terms.map((t) => { const w = t.endWeek - t.startWeek + 1; return [t.name, t.courses.map((c) => `${c.code} ${basis(c.weeklyClassHours, w)}-${basis(c.weeklyLabHours, w)}-${basis(c.weeklyClinicalHours, w)}-${c.credits}`)]; });
const credits = (p: Pack) => p.terms.flatMap((t) => t.courses).reduce((n, c) => n + c.credits, 0);
const course = (p: Pack, code: string) => p.terms.flatMap((t) => t.courses).find((c) => c.code === code)!;
const meetings = (c: Course, kind: string, week = 1) => c.sessions.filter((s) => s.kind === kind && s.week === week).map((s) => `${s.dayOfWeek} ${s.startTime}-${s.endTime} ${s.location}`);

describe("Brunswick Community College", () => {
  it("is seeded, with the three pathways as packs under one RN family and a flat goal of 190", () => {
    expect(PAUSED_INSTITUTIONS.has("Brunswick Community College")).toBe(false);
    const inst = INSTITUTIONS.find((i) => i.name === "Brunswick Community College")!;
    expect(inst.city).toBe("Bolivia");
    expect(inst.families).toHaveLength(1);
    const fam = inst.families[0];
    expect(fam.soc).toBe("29-1141");
    expect(Object.values(fam.goals)).toEqual([190, 190, 190, 190, 190]);
    expect(fam.programs).toBe(BRUNSWICK_PROGRAMS);
    expect(BRUNSWICK_PROGRAMS.map((p) => [p.pack, p.launch])).toEqual([["brunswick-adn.json", "SUMMER"], ["brunswick-lpn-adn.json", "SUMMER"], ["brunswick-paramedic-adn.json", "SPRING"]]);
    for (const p of BRUNSWICK_PROGRAMS) expect(p.note).toMatch(/program-structure workbook replaces them/);
    expect(Object.values(packs).map((p) => [p.name, p.programType, p.credential, p.maxCohort])).toEqual([
      ["Associate Degree Nursing (A45110)", "Traditional Full Time", "AAS", 50],
      ["LPN-to-ADN Transition (A45110T)", "Transition (LPN)", "AAS", 20],
      ["Paramedic-to-ADN Bridge (A45110M)", "Bridge (Paramedic)", "AAS", 10],
    ]);
  });
  it("ADN: NUR 117 in the summer, then six semesters as the information sheet lays them out — 72 credits, 45 of them NUR", () => {
    const p = packs["brunswick-adn.json"];
    expect(table(p)).toEqual([
      ["Summer 1", ["NUR 117 1-3-0-2"]],
      ["Fall 1", ["NUR 111 4-6-6-8", "BIO 168 3-3-0-4", "ENG 111 3-0-0-3"]],
      ["Spring 1", ["NUR 112 3-0-6-5", "NUR 114 3-0-6-5", "BIO 169 3-3-0-4", "PSY 150 3-0-0-3"]],
      ["Summer 2", ["NUR 113 3-0-6-5", "PSY 241 3-0-0-3"]],
      ["Fall 2", ["NUR 211 3-0-6-5", "NUR 212 3-0-6-5", "BIO 275 3-3-0-4", "HUM/Fine Arts elective 3-0-0-3"]],
      ["Spring 2", ["NUR 213 4-3-15-10", "ENG 112 or ENG 114 3-0-0-3"]],
    ]);
    expect(credits(p)).toBe(72);
    expect(p.terms.flatMap((t) => t.courses).filter((c) => c.code.startsWith("NUR")).reduce((n, c) => n + c.credits, 0)).toBe(45); // the sheet says 34; its own course credits add to 45
    // Summers follow the college's calendar (nine weeks); semesters are 16; the terms run back to back.
    expect(p.terms.map((t) => [t.semester, t.startWeek, t.endWeek])).toEqual([["Summer", 1, 9], ["Fall", 10, 25], ["Spring", 26, 41], ["Summer", 42, 50], ["Fall", 51, 66], ["Spring", 67, 82]]);
  });
  it("LPN-to-ADN: joins the ADN cohort at its second-year summer — three semesters, 35 credits in class", () => {
    const p = packs["brunswick-lpn-adn.json"];
    expect(table(p)).toEqual([
      ["Summer", ["NUR 113 3-0-6-5", "ENG 112 or ENG 114 3-0-0-3"]],
      ["Fall", ["NUR 211 3-0-6-5", "NUR 212 3-0-6-5", "BIO 275 3-3-0-4"]],
      ["Spring", ["NUR 213 4-3-15-10", "HUM/Fine Arts elective 3-0-0-3"]],
    ]);
    expect(credits(p)).toBe(35);
  });
  it("Paramedic-to-ADN: NUR 215 in the spring, then the ADN cohort's summer, fall and spring — four semesters, 44 credits in class", () => {
    const p = packs["brunswick-paramedic-adn.json"];
    expect(table(p)).toEqual([
      ["Spring 1", ["NUR 215 3-3-6-6", "BIO 275 3-3-0-4"]],
      ["Summer 1", ["NUR 113 3-0-6-5", "ENG 112 or ENG 114 3-0-0-3"]],
      ["Fall 1", ["NUR 211 3-0-6-5", "NUR 212 3-0-6-5", "PSY 241 3-0-0-3"]],
      ["Spring 2", ["NUR 213 4-3-15-10", "HUM/Fine Arts elective 3-0-0-3"]],
    ]);
    expect(credits(p)).toBe(44);
  });
  it("sessions are the college's published sections: days, times, rooms, the 8-week windows and the seats per cohort", () => {
    const adn = packs["brunswick-adn.json"];
    expect(meetings(course(adn, "NUR 111"), "CLASS")).toEqual(["Mon 09:00-11:00 J - Health Sciences 106", "Wed 09:00-11:00 J - Health Sciences 106"]); // posted 9:00–10:50, carried at 2 h: the sheet's 4 class hours a week × 16
    expect(meetings(course(adn, "NUR 111"), "LAB")).toEqual(["Tue 08:00-14:00 J - Health Sciences 155"]);
    expect(meetings(course(adn, "NUR 111"), "CLINICAL")).toEqual(["Thu 06:30-12:30 Clinical site"]);
    // NUR 112 runs the first eight weeks of the spring, NUR 114 the second eight; NUR 211 / 212 the same in the fall.
    const weeksOf = (c: Course) => [Math.min(...c.sessions.map((s) => s.week)), Math.max(...c.sessions.map((s) => s.week))];
    expect(weeksOf(course(adn, "NUR 112"))).toEqual([1, 8]); expect(weeksOf(course(adn, "NUR 114"))).toEqual([9, 16]);
    expect(weeksOf(course(adn, "NUR 211"))).toEqual([1, 8]); expect(weeksOf(course(adn, "NUR 212"))).toEqual([9, 16]);
    expect(meetings(course(adn, "NUR 112"), "CLINICAL")).toEqual(["Mon 06:30-12:30 J - Health Sciences 175", "Wed 06:30-12:30 J - Health Sciences 175"]);
    expect(meetings(course(adn, "NUR 211"), "CLINICAL")).toEqual(["Mon 06:30-12:30 Clinical site", "Wed 06:30-12:30 Clinical site"]);
    // NUR 213: class W, lab T, a precepted shift every week and a second one every other week, together the sheet's 15 h/wk × 16.
    const n213 = course(adn, "NUR 213");
    expect(meetings(n213, "CLASS")).toEqual(["Wed 08:00-12:00 J - Health Sciences 106"]);
    expect(meetings(n213, "LAB")).toEqual(["Tue 09:00-12:00 J - Health Sciences 145"]);
    expect(meetings(n213, "CLINICAL", 1)).toEqual(["Mon 07:00-17:00 Clinical site", "Thu 07:00-17:00 Clinical site"]); // 24 shifts carry the sheet's 15 h/wk × 16 = 240 h: ten hours each
    expect(meetings(n213, "CLINICAL", 2)).toEqual(["Mon 07:00-17:00 Clinical site"]);
    const shift = n213.sessions.find((s) => s.kind === "CLINICAL")!;
    expect([shift.clinicalMode, shift.maxStudents, shift.preceptorsNeeded, shift.facultyNeeded]).toEqual(["Preceptor-led", 1, 1, 0.1]);
    // Every other clinical is an instructor-led group of eight; class seats are the cohort's.
    for (const [file, seats] of [["brunswick-adn.json", 50], ["brunswick-lpn-adn.json", 20], ["brunswick-paramedic-adn.json", 10]] as const) {
      for (const c of packs[file].terms.flatMap((t) => t.courses)) for (const s of c.sessions) {
        if (s.kind === "CLINICAL" && c.code !== "NUR 213") expect([s.clinicalMode?.startsWith("Instructor-led"), s.maxStudents, s.facultyNeeded], `${file} ${c.code}`).toEqual([true, 8, 1]);
        if (s.kind === "CLASS" && c.code.startsWith("NUR")) expect(s.maxStudents, `${file} ${c.code}`).toBe(seats);
        expect(s.lengthHours).toBeGreaterThan(0);
      }
    }
    // The paramedic bridge course as scheduled.
    const n215 = course(packs["brunswick-paramedic-adn.json"], "NUR 215");
    expect([meetings(n215, "CLASS"), meetings(n215, "LAB"), meetings(n215, "CLINICAL")]).toEqual([["Mon 09:00-12:00 J - Health Sciences 106"], ["Mon 13:00-16:00 J - Health Sciences 145"], ["Tue 06:30-12:30 J - Health Sciences 173"]]);
    // Shared courses say so; general-enrollment courses are marked and placeless.
    for (const p of Object.values(packs)) for (const c of p.terms.flatMap((t) => t.courses)) {
      if (/^NUR (113|211|212|213)$/.test(c.code)) expect(c.description, c.code).toMatch(/section per cohort/);
      expect(c.courseType).toBe(c.code.startsWith("NUR") ? "CORE" : "GENED");
      if (!c.code.startsWith("NUR")) for (const s of c.sessions) expect([s.dayOfWeek, s.startTime, s.notes?.startsWith("General-enrollment")]).toEqual([null, null, true]);
    }
  });
  it("has the college's 2026–27 calendar (the PDF, 9/8/2025): three semester starts and ends, the 12-week and 2nd 8-week sessions, every closure", () => {
    expect(CALENDAR_FILES["Brunswick Community College"]).toBe("brunswick.txt");
    const { events, warnings } = parseAcademicCalendar(readFileSync(new URL("../prisma/seed-data/calendars/brunswick.txt", import.meta.url), "utf8"));
    expect(warnings).toEqual([]);
    const coded = events.filter((e) => e.kind !== "other").map((e) => [e.kind, e.iso, e.endIso ?? null]);
    expect(coded).toEqual([
      ["term_start", "2026-08-17", null], ["holiday", "2026-09-07", null], ["session_start", "2026-09-15", null], ["session_start", "2026-10-13", null],
      ["holiday", "2026-10-26", "2026-10-27"], ["holiday", "2026-11-11", null], ["holiday", "2026-11-25", "2026-11-27"], ["term_end", "2026-12-15", null], ["holiday", "2026-12-24", "2026-12-31"],
      ["holiday", "2027-01-01", null], ["term_start", "2027-01-06", null], ["holiday", "2027-01-18", null], ["session_start", "2027-02-04", null], ["session_start", "2027-03-04", null],
      ["holiday", "2027-03-22", "2027-03-25"], ["holiday", "2027-03-26", null], ["term_end", "2027-05-05", null],
      ["term_start", "2027-05-24", null], ["holiday", "2027-05-31", null], ["holiday", "2027-07-05", null], ["term_end", "2027-07-20", null],
    ]);
    expect(anchorsFromEvents(events, { springStart: "01-08", summerStart: "05-28", fallStart: "08-15" })).toEqual({ springStart: "01-06", summerStart: "05-22", fallStart: "08-15" });
  });
});
