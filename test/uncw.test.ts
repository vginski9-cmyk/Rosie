import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { INSTITUTIONS, PAUSED_INSTITUTIONS, UNCW_PROGRAMS } from "../prisma/seed-institutions";
import { parseAcademicCalendar, anchorsFromEvents } from "../src/lib/academiccalendar";
import { CALENDAR_FILES } from "../prisma/seed-calendars";
import { NURSING_ROTATIONS } from "../prisma/seed-kits";
import { PARTNER_SITES } from "../prisma/seed-partner-sites";

// UNC Wilmington's three prelicensure BSN tracks — the four-semester prelicensure BSN's fall and spring entries and the
// Accelerated BSN (summer entry) — as template packs (scripts/build-uncw-packs.mjs, 2026-10-28) from the school's
// published plan of study (confirmed by the program on 2026-10-28): 60 nursing credits, 675 clinical/lab hours at 45 hours a
// lab or clinical credit and 15 a lecture credit; class sizes at the program's planned 80 / 80 / 24; NSG 302 as med-surg with
// its first five weeks in the lab; no section days or rooms published; each clinical course carrying the usual settings, flagged.

type Session = { kind: string; week: number; dayOfWeek: string | null; startTime: string | null; lengthHours: number; location: string | null; maxStudents: number; rotationType: string | null; clinicalMode: string | null; preceptorsNeeded: number; notes: string | null };
type Course = { code: string; weeklyClassHours: number; weeklyLabHours: number; weeklyClinicalHours: number; credits: number; sessions: Session[] };
type Pack = { name: string; programType: string; credential: string; maxCohort: number | null; maxCohortNote: string; assumptions: { facTermWeeks: number }; terms: { name: string; semester: string | null; startWeek: number; endWeek: number; courses: Course[] }[] };
const load = (file: string) => JSON.parse(readFileSync(new URL(`../prisma/templates/${file}`, import.meta.url), "utf8")) as Pack;
const packs = Object.fromEntries(UNCW_PROGRAMS.map((p) => [p.pack, load(p.pack)]));
const fall = packs["uncw-bsn-fall.json"], spring = packs["uncw-bsn-spring.json"], absn = packs["uncw-absn.json"];
const courses = (p: Pack) => p.terms.flatMap((t) => t.courses);
const course = (p: Pack, code: string) => courses(p).find((c) => c.code === code)!;
const hours = (c: Course, kind: string) => Math.round(c.sessions.filter((s) => s.kind === kind).reduce((n, s) => n + s.lengthHours, 0) * 100) / 100;
const termHours = (p: Pack, i: number, kinds: string[]) => Math.round(p.terms[i].courses.flatMap((c) => c.sessions).filter((s) => kinds.includes(s.kind)).reduce((n, s) => n + s.lengthHours, 0));
const KNOWN = new Set(NURSING_ROTATIONS.map(([r]) => r));

describe("UNC Wilmington", () => {
  it("is seeded with one prelicensure BSN family of three pack tracks and a 45-minute core band", () => {
    expect(PAUSED_INSTITUTIONS.has("University of North Carolina Wilmington")).toBe(false);
    const inst = INSTITUTIONS.find((i) => i.name === "University of North Carolina Wilmington")!;
    expect([inst.kind, inst.city, inst.rings]).toEqual(["University", "Wilmington", { core: 45, one: 60, two: 90 }]);
    expect(inst.families).toHaveLength(1);
    expect([inst.families[0].name, inst.families[0].soc, inst.families[0].programs]).toEqual(["Nursing (prelicensure BSN)", "29-1141", UNCW_PROGRAMS]);
    expect(UNCW_PROGRAMS.map((p) => [p.pack, p.launch])).toEqual([["uncw-bsn-fall.json", "FALL"], ["uncw-bsn-spring.json", "SPRING"], ["uncw-absn.json", "SUMMER"]]);
  });
  it("every track carries the school's four-semester plan: 60 nursing credits and 675 clinical/lab hours (135, 180, 180, 180)", () => {
    expect(Object.values(packs).map((p) => [p.name, p.programType, p.credential, p.maxCohort, courses(p).reduce((n, c) => n + c.credits, 0)])).toEqual([
      ["BSN Prelicensure — Fall Entry", "Traditional Full Time", "BSN", 80, 60],
      ["BSN Prelicensure — Spring Entry", "Traditional Full Time", "BSN", 80, 60],
      ["Accelerated BSN (second degree) — Summer Entry", "Accelerated (second degree)", "BSN", 24, 60],
    ]);
    for (const p of Object.values(packs)) {
      expect(p.terms.map((t) => t.courses.reduce((n, c) => n + c.credits, 0))).toEqual([15, 16, 15, 14]);
      expect([0, 1, 2, 3].map((i) => termHours(p, i, ["LAB", "CLINICAL"]))).toEqual([135, 180, 180, 180]);
      expect(p.terms.map((t) => t.courses.map((c) => c.code))).toEqual([["NSG 300", "NSG 302", "NSG 304", "NSG 306"], ["NSG 311", "NSG 313", "NSG 314", "NSG 317", "NSG 319"], ["NSG 422", "NSG 424", "NSG elective", "NSG 426"], ["NSG 430", "NSG 432", "NSG 434", "NSG 454"]]);
      expect(p.assumptions.facTermWeeks).toBe(15);
    }
    expect(fall.terms.map((t) => [t.name, t.semester, t.endWeek - t.startWeek + 1])).toEqual([["Fall 1", "Fall", 15], ["Spring 1", "Spring", 15], ["Fall 2", "Fall", 15], ["Spring 2", "Spring", 15]]);
    expect(spring.terms.map((t) => [t.name, t.semester])).toEqual([["Spring 1", "Spring"], ["Fall 1", "Fall"], ["Spring 2", "Spring"], ["Fall 2", "Fall"]]);
    expect(absn.terms.map((t) => [t.name, t.semester, t.endWeek - t.startWeek + 1])).toEqual([["Summer 1", "Summer", 10], ["Fall", "Fall", 15], ["Spring", "Spring", 15], ["Summer 2", "Summer", 10]]);
    // A lecture credit is 15 hours, a lab or clinical credit 45: NSG 302 (3/2 clinical) = 45 class + 90 clinical; NSG 426 (3/3) = 45 + 135.
    expect([hours(course(fall, "NSG 302"), "CLASS"), hours(course(fall, "NSG 302"), "CLINICAL")]).toEqual([45, 90]);
    expect([hours(course(fall, "NSG 426"), "CLASS"), hours(course(fall, "NSG 426"), "CLINICAL")]).toEqual([45, 135]);
    expect([hours(course(fall, "NSG 300"), "LAB"), hours(course(absn, "NSG 300"), "LAB")]).toEqual([45, 45]);
    // Weekly figures follow the semester's weeks: NSG 302 at 3 class hours a week over 15, 4.5 over the ABSN's 10-week summer.
    expect([course(fall, "NSG 302").weeklyClassHours, course(absn, "NSG 302").weeklyClassHours, course(absn, "NSG 302").weeklyClinicalHours]).toEqual([3, 4.5, 9]);
    expect(absn.maxCohortNote).toMatch(/24/); expect(fall.maxCohortNote).toMatch(/70 now .* 80 from Fall 2027/);
  });
  it("sessions carry their hours with no day or time, in McNeill Hall or at a clinical site, with the usual settings per course and the capstone precepted", () => {
    for (const p of Object.values(packs)) for (const c of courses(p)) for (const s of c.sessions) {
      expect(s.dayOfWeek).toBeNull(); expect(s.startTime).toBeNull();
      if (s.kind === "CLINICAL" && s.clinicalMode === "Simulation") { expect(s.location).toBe("McNeill Hall – Simulation Learning Center"); expect(s.rotationType).toBeNull(); expect(c.code).toBe("NSG 302"); }
      else if (s.kind === "CLINICAL") { expect(s.location).toBe("Clinical site"); expect(KNOWN.has(s.rotationType ?? ""), `${c.code} ${s.rotationType}`).toBe(true); expect(s.notes).toMatch(/confirmed the sequence on 2026-10-28/); }
      else expect(s.location).toMatch(/^McNeill Hall – /);
    }
    const rot = (code: string) => [...new Set(course(fall, code).sessions.filter((s) => s.kind === "CLINICAL" && s.clinicalMode !== "Simulation").map((s) => s.rotationType))];
    expect([rot("NSG 302"), rot("NSG 313"), rot("NSG 314"), rot("NSG 422"), rot("NSG 426"), rot("NSG 430"), rot("NSG 434")]).toEqual([["Med-Surg"], ["Obstetrics"], ["Pediatrics"], ["Behavioral Health"], ["Med-Surg", "Critical Care"], ["Community Health"], ["Med-Surg or Critical Care"]]);
    // NSG 302: the first five weeks in the lab (the program, 2026-10-28) — 4 of 12 shifts as simulation in weeks 1–5, 8 at the hospital in weeks 6–15; the ABSN's ten-week summer keeps the proportion.
    const s302 = course(fall, "NSG 302").sessions.filter((s) => s.kind === "CLINICAL");
    expect(s302.filter((s) => s.clinicalMode === "Simulation").map((s) => s.week)).toEqual([1, 2, 3, 4]);
    expect(s302.filter((s) => s.clinicalMode !== "Simulation").every((s) => s.week >= 6 && s.rotationType === "Med-Surg" && s.notes!.includes("geriatrics are objectives"))).toBe(true);
    expect(course(absn, "NSG 302").sessions.filter((s) => s.kind === "CLINICAL" && s.clinicalMode === "Simulation").map((s) => s.week)).toEqual([1, 1, 2, 3]);
    expect(course(fall, "NSG 311").sessions.some((s) => s.kind === "CLINICAL")).toBe(false); // lab only
    const cap = course(fall, "NSG 434").sessions.filter((s) => s.kind === "CLINICAL");
    expect(cap).toHaveLength(12); expect(cap.every((s) => s.maxStudents === 1 && s.clinicalMode === "Preceptor-led" && s.preceptorsNeeded === 1 && s.lengthHours === 11.25)).toBe(true);
    const n302 = course(fall, "NSG 302").sessions.filter((s) => s.kind === "CLINICAL");
    expect(n302).toHaveLength(12); expect(n302.every((s) => s.maxStudents === 8 && ["Instructor-led", "Simulation"].includes(s.clinicalMode ?? "") && s.lengthHours === 7.5)).toBe(true);
    expect(course(fall, "NSG 302").sessions.find((s) => s.kind === "CLASS")!.maxStudents).toBe(80); // didactic courses stay one section; growth adds clinical sections
    expect(course(absn, "NSG 302").sessions.find((s) => s.kind === "CLASS")!.maxStudents).toBe(24);
  });
  it("has the registrar's 2026–27 calendar and the Wilmington-area sites within 45 minutes, all prospects", () => {
    expect(CALENDAR_FILES["University of North Carolina Wilmington"]).toBe("uncw.txt");
    const { events, warnings } = parseAcademicCalendar(readFileSync(new URL("../prisma/seed-data/calendars/uncw.txt", import.meta.url), "utf8"));
    expect(warnings).toEqual([]);
    expect(events.filter((e) => e.kind !== "other").map((e) => [e.kind, e.iso, e.endIso ?? null])).toEqual([
      ["term_start", "2026-08-19", null], ["holiday", "2026-09-07", null], ["holiday", "2026-10-08", "2026-10-10"], ["holiday", "2026-11-25", null], ["holiday", "2026-11-26", "2026-11-28"], ["term_end", "2026-12-02", null], ["holiday", "2026-12-03", null],
      ["term_start", "2027-01-11", null], ["holiday", "2027-01-18", null], ["holiday", "2027-03-01", "2027-03-07"], ["holiday", "2027-03-25", null], ["holiday", "2027-03-26", "2027-03-27"], ["term_end", "2027-04-28", null], ["holiday", "2027-04-29", null], // reading days code as no-class days
      ["term_start", "2027-05-17", null], ["holiday", "2027-05-31", null], ["session_start", "2027-06-22", null], ["term_end", "2027-07-21", null],
    ]);
    const a = anchorsFromEvents(events, { springStart: "01-11", summerStart: "05-17", fallStart: "08-17" });
    expect([a.summerStart, a.fallStart]).toEqual(["05-15", "08-19"]); // summer: Monday on or after May 15 = May 17; fall opens on Wednesday Aug 19, so no Monday rule fits and the coded date carries it
    const sites = PARTNER_SITES.filter((s) => s.institution === "University of North Carolina Wilmington");
    expect(sites.length).toBeGreaterThanOrEqual(24);
    expect(sites.every((s) => s.agreement === "prospect")).toBe(true);
    expect(sites.filter((s) => s.kind === "hospital").map((s) => s.city).sort()).toEqual(["Bolivia", "Burgaw", "Southport", "Wilmington", "Wilmington"]);
    expect(sites.find((s) => s.id === "UNCW-H01")!.kits!.map((k) => k.code)).toEqual(["BEDS", "ICU", "OB", "PEDS", "BH"]);
    expect([...new Set(sites.map((s) => s.county))].sort()).toEqual(["Brunswick", "New Hanover", "Pender"]);
  });
});
