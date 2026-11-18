import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { INSTITUTIONS, PAUSED_INSTITUTIONS, FORSYTH_PROGRAMS } from "../prisma/seed-institutions";
import { parseAcademicCalendar, anchorsFromEvents } from "../src/lib/academiccalendar";
import { CALENDAR_FILES } from "../prisma/seed-calendars";
import { OTHER_CAMPUSES } from "../prisma/seed-campuses";
import { geocodeOffline } from "../src/lib/geo";

// Forsyth Tech's electrical offerings: the Electrical Systems Technology diploma and certificate, the Career & College Promise
// pathway, the Careers Electric summer academy, the FCECA electrician apprenticeship and the Installation/Troubleshooting
// evening course as template packs (scripts/build-forsyth-packs.mjs, 2026-11-18). The college's credentials, totals, term lines,
// published evenings, calendar and places; the NCCCS standard's course hours. Labs, no clinicals; the workspace default load
// and a stand-in class size of 16 because the college publishes neither; nothing else unpublished is set.

type Session = { facultyContactPolicy: number | null; kind: string; week: number; dayOfWeek: string | null; startTime: string | null; endTime: string | null; lengthHours: number; location: string | null; maxStudents: number; notes: string | null };
type Course = { code: string; weeklyClassHours: number; weeklyLabHours: number; weeklyClinicalHours: number; credits: number; courseType: string; sessions: Session[] };
type Pack = { name: string; programType: string; credential: string; maxCohort: number | null; calendarMode?: string; note: string; assumptions: { facContactHours: number; facWorkWeekHours: number }; terms: { name: string; semester: string | null; startWeek: number; endWeek: number; courses: Course[] }[] };
const load = (file: string) => JSON.parse(readFileSync(new URL(`../prisma/templates/${file}`, import.meta.url), "utf8")) as Pack;
const packs = Object.fromEntries(FORSYTH_PROGRAMS.map((p) => [p.pack, load(p.pack)]));
const courses = (p: Pack) => p.terms.flatMap((t) => t.courses);
const codes = (p: Pack) => courses(p).map((c) => c.code);
const credits = (p: Pack) => courses(p).reduce((n, c) => n + c.credits, 0);
const course = (p: Pack, code: string) => courses(p).find((c) => c.code === code)!;
const hours = (c: Course, kind: string) => Math.round(c.sessions.filter((s) => s.kind === kind).reduce((n, s) => n + s.lengthHours, 0) * 100) / 100;
const nights = (c: Course) => [...new Set(c.sessions.map((s) => `${s.dayOfWeek} ${s.startTime}-${s.endTime} ${s.location}`))];

describe("Forsyth Technical Community College", () => {
  it("is seeded (no longer paused) with one Electrical Systems Technology family of six pack programs", () => {
    expect(PAUSED_INSTITUTIONS.has("Forsyth Technical Community College")).toBe(false);
    const inst = INSTITUTIONS.find((i) => i.name === "Forsyth Technical Community College")!;
    expect([inst.short, inst.city, inst.serviceArea]).toEqual(["Forsyth Tech", "Winston-Salem", "Forsyth & Stokes Counties, NC"]);
    expect(inst.families.map((f) => f.name)).toEqual(["Electrical Systems Technology"]);
    expect(inst.families[0].soc).toBe("47-2111");
    expect(inst.families[0].programs).toBe(FORSYTH_PROGRAMS);
    expect(FORSYTH_PROGRAMS.map((p) => [p.launch, p.months])).toEqual([["FALL", 3], ["FALL", 3], ["FALL", 3], ["SUMMER", 3], ["FALL", 0], ["SPRING", 0]]);
    expect(inst.families[0].description).toMatch(/no AAS is listed/);
    expect(inst.families[0].description).toMatch(/Robert L\. Strickland Center/);
  });
  it("the credentials carry the college's course lists and totals (BPR 130 at 3-0-3 as its fall line fixes it), the standard's hours, and the stand-in class size of 16", () => {
    expect(Object.values(packs).map((p) => [p.name, p.programType, p.terms.length, credits(p), p.maxCohort])).toEqual([
      ["Electrical Systems Technology Diploma (D35130)", "Traditional Full Time", 3, 39, 16],
      ["Electrical Systems Technology Certificate (C35130)", "Certificate", 2, 15, 16],
      ["Electrical Systems Technology — Career & College Promise pathway (C35130P1)", "High school (CCP)", 2, 15, 16],
      ["Careers Electric Summer Academy (summer pre-apprenticeship)", "High school pre-apprenticeship", 1, 0, 16],
      ["Electrician Apprenticeship (Forsyth County Electrical Contractors Association, at Forsyth Tech)", "Registered apprenticeship", 8, 0, 16],
      ["Electrical: Installation/Troubleshooting (continuing education)", "Continuing education", 1, 0, 16],
    ]);
    const dip = packs["forsyth-est-diploma.json"];
    expect(dip.terms.map((t) => [t.name, t.semester, t.endWeek - t.startWeek + 1, t.courses.map((c) => c.code)])).toEqual([
      ["Fall", "Fall", 16, ["BPR 130", "ELC 112", "ELC 113", "ISC 115", "MAT 110"]],
      ["Spring", "Spring", 16, ["ELC 114", "ELC 117", "ELC 118", "ISC 112", "ENG 111"]],
      ["Summer", "Summer", 8, ["ELC 115", "ELC 233"]],
    ]);
    const hrs = (code: string) => { const c = course(dip, code); return `${c.weeklyClassHours}-${c.weeklyLabHours}-${c.credits}`; };
    expect(["BPR 130", "ELC 112", "ELC 113", "ISC 115", "MAT 110", "ELC 114", "ELC 117", "ELC 118", "ISC 112", "ENG 111"].map(hrs)).toEqual(["3-0-3", "3-6-5", "2-6-4", "2-0-2", "2-2-3", "2-6-4", "2-6-4", "1-2-2", "2-0-2", "3-0-3"]);
    // The college's own term lines: fall 12 class · 14 lab · 17 credits, spring 10 · 14 · 15, summer 7.
    const line = (i: number) => dip.terms[i].courses.reduce((a, c) => [a[0] + hours(c, "CLASS") / 16, a[1] + hours(c, "LAB") / 16, a[2] + c.credits], [0, 0, 0]);
    expect([line(0), line(1), line(2)[2]]).toEqual([[12, 14, 17], [10, 14, 15], 7]);
    // The 8-week summer carries the 16-week hours: ELC 115 (2-6) at 4 / 12 a week, 32 + 96 over the term; ELC 233 (2-2) at 4 / 4.
    const elc115 = course(dip, "ELC 115"); const elc233 = course(dip, "ELC 233");
    expect([elc115.weeklyClassHours, elc115.weeklyLabHours, hours(elc115, "CLASS"), hours(elc115, "LAB")]).toEqual([4, 12, 32, 96]);
    expect([elc233.weeklyClassHours, elc233.weeklyLabHours, elc233.credits, hours(elc233, "CLASS"), hours(elc233, "LAB")]).toEqual([4, 4, 3, 32, 32]);
    for (const p of Object.values(packs)) for (const c of courses(p)) { expect(c.weeklyClinicalHours).toBe(0); expect(c.sessions.some((s) => s.kind === "CLINICAL")).toBe(false); }
    expect(codes(packs["forsyth-est-cert.json"])).toEqual(["ELC 112", "ELC 113", "ELC 114", "ELC 118"]);
    expect(codes(packs["forsyth-est-ccp.json"])).toEqual(["ELC 112", "ELC 113", "ELC 114", "ELC 118"]);
    expect(dip.note).toMatch(/2026–27 catalog marks the diploma REVISED/);
    expect(packs["forsyth-est-ccp.json"].note).toMatch(/ELC 117/);
  });
  it("no curriculum section is published: every credit course carries its hours with no day or time at the Main Campus; gen-ed courses keep 30 seats", () => {
    const dip = packs["forsyth-est-diploma.json"];
    const elc112 = course(dip, "ELC 112");
    expect(elc112.sessions.every((s) => s.dayOfWeek === null && s.startTime === null && /No section for this course is on record/.test(s.notes ?? ""))).toBe(true);
    expect([...new Set(elc112.sessions.map((s) => `${s.kind} ${s.location}`))]).toEqual(["CLASS Main Campus – Classroom", "LAB Main Campus – Electrical lab"]);
    expect([hours(elc112, "CLASS"), hours(elc112, "LAB")]).toEqual([48, 96]);
    expect(course(dip, "ENG 111").sessions.every((s) => s.dayOfWeek === null && s.location === "General classroom" && s.maxStudents === 30)).toBe(true);
    for (const p of Object.values(packs)) {
      expect([p.assumptions.facContactHours, p.assumptions.facWorkWeekHours]).toEqual([16, 40]);
      for (const c of courses(p)) {
        expect(c.sessions.every((s) => s.facultyContactPolicy === 2.5), `${p.name} ${c.code} policy`).toBe(true);
        expect(c.sessions.every((s) => s.maxStudents === (c.courseType === "GENED" ? 30 : 16)), `${p.name} ${c.code} seats`).toBe(true);
      }
    }
  });
  it("the summer academy carries the standard's 144 hours over seven weeks with nothing else set; the evening course sits on its published 33 Mon/Wed evenings at West Campus", () => {
    const academy = packs["forsyth-careers-electric-academy.json"];
    const a = courses(academy)[0];
    expect([academy.terms[0].endWeek, a.credits, a.sessions.length, hours(a, "CLASS")]).toEqual([7, 0, 7, 144]);
    expect(a.sessions.every((s) => s.kind === "CLASS" && s.dayOfWeek === null && s.startTime === null && s.location === null)).toBe(true);
    expect(academy.note).toMatch(/\$2,000 completion stipend/);
    expect(academy.note).toMatch(/144 hours — the standard's minimum/);
    const ce = packs["forsyth-electrical-install-troubleshoot.json"];
    const c = courses(ce)[0];
    expect([ce.calendarMode, ce.terms[0].endWeek, c.credits, c.sessions.length, hours(c, "CLASS")]).toEqual(["continuous", 17, 0, 33, 99]);
    expect(c.sessions.filter((s) => s.week === 1).map((s) => s.dayOfWeek)).toEqual(["Wed"]);
    expect(c.sessions.filter((s) => s.week === 2).map((s) => s.dayOfWeek)).toEqual(["Mon", "Wed"]);
    expect(nights(c)).toEqual(["Wed 18:00-21:00 West Campus 17", "Mon 18:00-21:00 West Campus 17"]);
    expect(ce.note).toMatch(/\$210/);
  });
  it("the apprenticeship is four levels a year apart — a 16-week fall (80 h) and a 35-evening spring (87.5 h) each — on the published evenings at the Strickland Center, Level 3 with none", () => {
    const p = packs["forsyth-electrician-apprenticeship.json"];
    expect(p.calendarMode).toBe("continuous");
    expect(p.terms.map((t) => [t.name, t.startWeek, t.endWeek, t.courses[0].sessions.length])).toEqual([
      ["Level 1 Fall", 1, 16, 32], ["Level 1 Spring", 22, 39, 35], ["Level 2 Fall", 53, 68, 32], ["Level 2 Spring", 74, 91, 35],
      ["Level 3 Fall", 105, 120, 32], ["Level 3 Spring", 126, 143, 35], ["Level 4 Fall", 157, 172, 32], ["Level 4 Spring", 178, 195, 35],
    ]);
    for (const c of courses(p)) {
      expect([c.weeklyLabHours, c.credits]).toEqual([0, 0]);
      expect(c.sessions.every((s) => s.kind === "CLASS" && s.lengthHours === 2.5)).toBe(true);
    }
    expect(p.terms.map((t) => hours(t.courses[0], "CLASS"))).toEqual([80, 87.5, 80, 87.5, 80, 87.5, 80, 87.5]);
    expect(courses(p).reduce((n, c) => n + hours(c, "CLASS"), 0)).toBe(670);
    expect(nights(course(p, "Level 1 Spring"))).toEqual(["Tue 19:00-21:30 Robert L. Strickland Center 1250", "Thu 19:00-21:30 Robert L. Strickland Center 1250"]);
    expect(nights(course(p, "Level 2 Fall"))).toEqual(["Mon 18:30-21:00 Robert L. Strickland Center", "Wed 18:30-21:00 Robert L. Strickland Center"]);
    expect(nights(course(p, "Level 3 Fall"))).toEqual(["null null-null Robert L. Strickland Center"]);
    expect(nights(course(p, "Level 4 Fall"))).toEqual(["Tue 18:00-20:30 Robert L. Strickland Center", "Thu 18:00-20:30 Robert L. Strickland Center"]);
    // The spring's 35th evening is the first night of the 18th week.
    expect(course(p, "Level 1 Spring").sessions.filter((s) => s.week === 18).map((s) => s.dayOfWeek)).toEqual(["Tue"]);
    expect(p.note).toMatch(/2,000 hours of on-the-job training a year/);
    expect(p.note).toMatch(/\$240 a semester/);
    expect(p.note).toMatch(/no Level 3 section was found/);
  });
  it("has the college's calendar as published — Fall 2026, Spring 2027 and Summer 2027 with the closures — and its places", () => {
    expect(CALENDAR_FILES["Forsyth Technical Community College"]).toBe("forsyth.txt");
    const { events, warnings } = parseAcademicCalendar(readFileSync(new URL("../prisma/seed-data/calendars/forsyth.txt", import.meta.url), "utf8"));
    expect(warnings).toEqual([]);
    expect(events.filter((e) => e.kind !== "other").map((e) => [e.kind, e.iso, e.endIso ?? null])).toEqual([
      ["term_start", "2026-08-17", null], ["holiday", "2026-09-07", null], ["holiday", "2026-10-13", "2026-10-20"], ["holiday", "2026-11-26", "2026-11-27"], ["term_end", "2026-12-18", null], ["holiday", "2026-12-22", "2026-12-31"],
      ["term_start", "2027-01-11", null], ["holiday", "2027-01-18", null], ["holiday", "2027-03-09", "2027-03-14"], ["session_start", "2027-03-15", null], ["term_end", "2027-05-07", null],
      ["term_start", "2027-05-17", null], ["holiday", "2027-05-31", null], ["holiday", "2027-06-18", null], ["holiday", "2027-07-09", null],
    ]);
    expect(anchorsFromEvents(events, { springStart: "01-10", summerStart: "05-20", fallStart: "08-15" })).toEqual({ springStart: "01-08", summerStart: "05-15", fallStart: "08-15" });
    const places = OTHER_CAMPUSES["Forsyth Technical Community College"];
    expect(places.map((p) => [p.name, p.city, p.zip])).toEqual([["West Campus", "Winston-Salem", "27103"], ["Mazie S. Woodruff Center", "Winston-Salem", "27105"], ["Grady P. Swisher Center", "Kernersville", "27284"], ["Stokes County Center", "Walnut Cove", "27052"], ["Northwest Forsyth Center", "King", "27021"]]);
    for (const p of places) expect(geocodeOffline({ city: p.city, state: p.state }), p.city).not.toBeNull();
    for (const town of ["Winston-Salem", "Kernersville", "Clemmons", "King", "Walnut Cove", "Lewisville", "Rural Hall", "Danbury"]) expect(geocodeOffline({ city: town, state: "NC" }), town).not.toBeNull();
  });
});
