import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { INSTITUTIONS, PAUSED_INSTITUTIONS, RCCC_PROGRAMS } from "../prisma/seed-institutions";
import { parseAcademicCalendar, anchorsFromEvents } from "../src/lib/academiccalendar";
import { CALENDAR_FILES } from "../prisma/seed-calendars";

// Rowan-Cabarrus Community College's Electrical Systems Technology: the eight credentials under program 35130 and
// the NCAEC electrician apprenticeship, as template packs built from the college's 2026–27 catalog and published
// sections (scripts/build-rccc-packs.mjs). Labs, no clinicals.

type Session = { kind: string; week: number; dayOfWeek: string | null; startTime: string | null; endTime: string | null; lengthHours: number; location: string | null; maxStudents: number; deliveryMode: string };
type Course = { code: string; weeklyClassHours: number; weeklyLabHours: number; weeklyClinicalHours: number; credits: number; courseType: string; sessions: Session[] };
type Pack = { name: string; programType: string; credential: string; maxCohort: number | null; calendarMode?: string; assumptions: { facContactHours: number; facWorkWeekHours: number }; terms: { name: string; semester: string | null; startWeek: number; endWeek: number; courses: Course[] }[] };
const load = (file: string) => JSON.parse(readFileSync(new URL(`../prisma/templates/${file}`, import.meta.url), "utf8")) as Pack;
const packs = Object.fromEntries(RCCC_PROGRAMS.map((p) => [p.pack, load(p.pack)]));
const credits = (p: Pack) => p.terms.flatMap((t) => t.courses).reduce((n, c) => n + c.credits, 0);
const course = (p: Pack, code: string) => p.terms.flatMap((t) => t.courses).find((c) => c.code === code)!;
const meetings = (c: Course, kind: string, week = 1) => c.sessions.filter((s) => s.kind === kind && s.week === week).map((s) => `${s.dayOfWeek} ${s.startTime}-${s.endTime} ${s.location} ×${s.maxStudents}`);

describe("Rowan-Cabarrus Community College", () => {
  it("is seeded with one Electrical Systems Technology family of nine pack programs", () => {
    expect(PAUSED_INSTITUTIONS.has("Rowan-Cabarrus Community College")).toBe(false);
    const inst = INSTITUTIONS.find((i) => i.name === "Rowan-Cabarrus Community College")!;
    expect([inst.city, inst.serviceArea]).toEqual(["Salisbury", "Rowan & Cabarrus Counties, NC"]);
    expect(inst.families).toHaveLength(1);
    expect(inst.families[0].soc).toBe("47-2111");
    expect(inst.families[0].programs).toBe(RCCC_PROGRAMS);
    expect(RCCC_PROGRAMS.every((p) => p.launch === "FALL")).toBe(true);
  });
  it("the eight credentials carry the catalog's credits, terms and class sizes", () => {
    expect(Object.values(packs).map((p) => [p.name, p.terms.length, credits(p), p.maxCohort])).toEqual([
      ["Electrical Systems Technology AAS (A35130)", 6, 64, 16],
      ["Electrical Systems Technology Diploma (D35130)", 4, 40, 16],
      ["CCPP Electrical Systems Technology Diploma (D35130PB)", 5, 40, 10],
      ["Basic Certificate (C35130BA)", 2, 17, 16],
      ["CCPP Certificate (C35130PB)", 2, 17, 10],
      ["MTC 1 Certificate (C35130MB)", 3, 17, 16],
      ["Industrial Motor Control Certificate (C35130MO)", 3, 17, 12],
      ["Wiring and the NEC Certificate (C35130NE)", 2, 12, 16],
      ["Electrician Apprenticeship (NCAEC, ApprenticeshipNC #29076)", 4, 0, 17],
    ]);
    const aas = packs["rccc-est-aas.json"];
    expect(aas.terms.map((t) => [t.name, t.semester, t.endWeek - t.startWeek + 1, t.courses.map((c) => c.code)])).toEqual([
      ["Year 1 Fall", "Fall", 16, ["ELC 112", "ELC 126", "ELC 113", "ELC 118"]],
      ["Year 1 Spring", "Spring", 16, ["ELC 117", "ELC 125", "EGR 125", "ENG 111", "MAT 121 or MAT 143 or PHY 110"]],
      ["Year 1 Summer", "Summer", 8, ["BPR 130", "Major elective"]],
      ["Year 2 Fall", "Fall", 16, ["CST 131", "ELC 119", "ELC 128", "WBL 110", "Major elective"]],
      ["Year 2 Spring", "Spring", 16, ["ELC 115", "ELC 215", "AHR 120", "Communication elective"]],
      ["Year 2 Summer", "Summer", 8, ["Humanities/Fine Arts elective", "Social/Behavioral Science elective"]],
    ]);
    // Every course's hours are the catalog's; no course has a clinical hour.
    const hours = (code: string) => { const c = course(aas, code); return `${c.weeklyClassHours}-${c.weeklyLabHours}-${c.credits}`; };
    expect(["ELC 112", "ELC 126", "ELC 113", "ELC 118", "ELC 117", "ELC 125", "ELC 115", "ELC 119", "ELC 128", "ELC 215"].map(hours)).toEqual(["3-6-5", "2-2-3", "2-6-4", "1-2-2", "2-6-4", "1-2-2", "2-6-4", "1-2-2", "2-3-3", "2-3-3"]);
    for (const p of Object.values(packs)) for (const c of p.terms.flatMap((t) => t.courses)) { expect(c.weeklyClinicalHours).toBe(0); expect(c.sessions.some((s) => s.kind === "CLINICAL")).toBe(false); }
    // Faculty load: 20 contact hours of a 40-hour week (the owner's figure, 2026-10-22) — 2 work hours a contact hour.
    for (const p of Object.values(packs)) expect([p.assumptions.facContactHours, p.assumptions.facWorkWeekHours]).toEqual([20, 40]);
    // A summer course carries its 16-week hours doubled over the 8-week term.
    expect(course(aas, "BPR 130").weeklyClassHours).toBe(6);
  });
  it("sessions are the college's day sections — class block then lab block in the same CBTC room at the section's seats — carrying the catalog's hours", () => {
    const aas = packs["rccc-est-aas.json"];
    expect(meetings(course(aas, "ELC 112"), "CLASS")).toEqual(["Mon 08:00-09:30 CBTC 259 ×16", "Wed 08:00-09:30 CBTC 259 ×16"]); // posted 8–9, carried at 1.5 h: the catalog's 3 class hours a week × 16
    expect(meetings(course(aas, "ELC 112"), "LAB")).toEqual(["Mon 09:30-12:30 CBTC 259 ×16", "Wed 09:30-12:30 CBTC 259 ×16"]); // after the class hour, 3 h: the catalog's 6 lab hours a week
    expect(meetings(course(aas, "ELC 128"), "LAB")).toEqual(["Tue 15:00-18:00 CBTC 253 ×12"]);
    expect(meetings(course(aas, "ELC 118"), "CLASS")).toEqual(["Wed 13:00-14:00 CBTC 206 ×20"]);
    expect(meetings(course(aas, "ELC 215"), "CLASS")).toEqual(["Wed 18:00-20:00 CBTC 253 ×18"]);
    // Online 14-week sections start in week 3 with no day or room.
    const egr = course(aas, "EGR 125");
    expect(Math.min(...egr.sessions.map((s) => s.week))).toBe(3);
    expect(egr.sessions.every((s) => s.dayOfWeek === null && s.location === "Virtual" && s.deliveryMode === "Online")).toBe(true);
    // A high-school cohort carries the hours at A.L. Brown HS with no day or time.
    const ccpp = course(packs["rccc-est-diploma-ccpp.json"], "ELC 112");
    expect(ccpp.sessions.every((s) => s.dayOfWeek === null && s.location === "A.L. Brown HS" && s.maxStudents === 10)).toBe(true);
    // General-education electives carry their hours with no day or room.
    expect(course(aas, "ENG 111").sessions.every((s) => s.dayOfWeek === null && s.location === "General classroom")).toBe(true);
  });
  it("the apprenticeship is four 28-week years a year apart, each one 3-hour class a week for 17 apprentices, night and room not yet published", () => {
    const p = packs["rccc-electrician-apprenticeship.json"];
    expect(p.calendarMode).toBe("continuous");
    expect(p.terms.map((t) => [t.name, t.startWeek, t.endWeek, t.courses.map((c) => c.code)])).toEqual([["Year 1", 1, 28, ["ELC-3014B"]], ["Year 2", 53, 80, ["ELC-3014C"]], ["Year 3", 105, 132, ["ELC-3014D"]], ["Year 4", 157, 184, ["ELC-3014E"]]]);
    for (const c of p.terms.flatMap((t) => t.courses)) {
      expect([c.weeklyClassHours, c.weeklyLabHours, c.credits]).toEqual([3, 0, 0]);
      expect(c.sessions).toHaveLength(28);
      expect(c.sessions.every((s) => s.kind === "CLASS" && s.lengthHours === 3 && s.dayOfWeek === null && s.startTime === null && s.location === null && s.maxStudents === 17)).toBe(true);
    }
  });
  it("has the college's 2026–27 calendar: three semester starts and ends, the 14-week, 8-week and 4-week sessions, every closure found", () => {
    expect(CALENDAR_FILES["Rowan-Cabarrus Community College"]).toBe("rowan-cabarrus.txt");
    const { events, warnings } = parseAcademicCalendar(readFileSync(new URL("../prisma/seed-data/calendars/rowan-cabarrus.txt", import.meta.url), "utf8"));
    expect(warnings).toEqual([]);
    expect(events.filter((e) => e.kind !== "other").map((e) => [e.kind, e.iso, e.endIso ?? null])).toEqual([
      ["term_start", "2026-08-17", null], ["session_start", "2026-08-31", null], ["holiday", "2026-09-07", null], ["holiday", "2026-10-19", "2026-10-20"], ["session_start", "2026-10-21", null], ["holiday", "2026-11-11", null], ["holiday", "2026-11-26", "2026-11-27"], ["term_end", "2026-12-18", null],
      ["term_start", "2027-01-08", null], ["holiday", "2027-01-18", null], ["session_start", "2027-01-22", null], ["holiday", "2027-03-09", "2027-03-16"], ["session_start", "2027-03-17", null], ["holiday", "2027-03-26", null], ["term_end", "2027-05-11", null],
      ["term_start", "2027-05-24", null], ["session_start", "2027-06-28", null], ["holiday", "2027-07-05", null], ["term_end", "2027-07-20", null],
    ]);
    // A Friday start (Jan 8) has no Monday-pattern anchor of its own; the coded date carries it (knownStarts).
    expect(anchorsFromEvents(events, { springStart: "01-08", summerStart: "05-28", fallStart: "08-15" })).toEqual({ springStart: "01-08", summerStart: "05-22", fallStart: "08-15" });
  });
});
