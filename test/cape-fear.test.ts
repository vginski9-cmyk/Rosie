import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CAPE_FEAR_PROGRAMS, INSTITUTIONS, PAUSED_INSTITUTIONS } from "../prisma/seed-institutions";
import { parseAcademicCalendar, anchorsFromEvents } from "../src/lib/academiccalendar";
import { CALENDAR_FILES } from "../prisma/seed-calendars";
import { OTHER_CAMPUSES } from "../prisma/seed-campuses";
import { geocodeOffline } from "../src/lib/geo";

// Cape Fear Community College's Electrical Systems Technology: the certificate, its CTE pathway, the diploma, the AAS and
// the college's registered Electrical Apprenticeship as template packs (scripts/build-cape-fear-packs.mjs, 2026-10-22).
// The college's credentials, credit totals, evening sections, calendar and places; the NCCCS standard's course hours;
// sequences laid out to the totals. Labs, no clinicals; nothing unpublished is set.

type Session = { facultyContactPolicy: number | null; kind: string; week: number; dayOfWeek: string | null; startTime: string | null; endTime: string | null; lengthHours: number; location: string | null; maxStudents: number; notes: string | null };
type Course = { code: string; weeklyClassHours: number; weeklyLabHours: number; weeklyClinicalHours: number; credits: number; courseType: string; sessions: Session[] };
type Pack = { name: string; programType: string; credential: string; maxCohort: number | null; calendarMode?: string; note: string; assumptions: { facContactHours: number; facWorkWeekHours: number }; terms: { name: string; semester: string | null; startWeek: number; endWeek: number; courses: Course[] }[] };
const load = (file: string) => JSON.parse(readFileSync(new URL(`../prisma/templates/${file}`, import.meta.url), "utf8")) as Pack;
const packs = Object.fromEntries(CAPE_FEAR_PROGRAMS.map((p) => [p.pack, load(p.pack)]));
const courses = (p: Pack) => p.terms.flatMap((t) => t.courses);
const credits = (p: Pack) => courses(p).reduce((n, c) => n + c.credits, 0);
const course = (p: Pack, code: string) => courses(p).find((c) => c.code === code)!;
const hours = (c: Course, kind: string) => Math.round(c.sessions.filter((s) => s.kind === kind).reduce((n, s) => n + s.lengthHours, 0) * 100) / 100;
const meetings = (c: Course, kind: string, week = 1) => c.sessions.filter((s) => s.kind === kind && s.week === week).map((s) => `${s.dayOfWeek} ${s.startTime}-${s.endTime} ${s.location}`);

describe("Cape Fear Community College", () => {
  it("is seeded with its four nursing tracks at the owner's caps (the transition joining the fall-entry class) and an Electrical Systems Technology family of five pack programs", () => {
    expect(PAUSED_INSTITUTIONS.has("Cape Fear Community College")).toBe(false);
    const inst = INSTITUTIONS.find((i) => i.name === "Cape Fear Community College")!;
    expect([inst.city, inst.serviceArea]).toEqual(["Wilmington", "New Hanover & Pender Counties, NC"]);
    expect(inst.families.map((f) => f.name)).toEqual(["Nursing (prelicensure RN)", "Electrical Systems Technology"]);
    type Coded = { name: string; seats: number; launch: string; credential: string; note?: string; joins?: { program: string; atTermIndex: number; hostTermIndex: number }; terms: (h: unknown) => { index: number; name: string; startWeek: number; endWeek: number; courses: { code: string; credits: number }[] }[] };
    const nursing = inst.families[0].programs as unknown as Coded[];
    expect(nursing.map((p) => [p.name, p.seats, p.launch, p.credential])).toEqual([["ADN — Fall Entry", 80, "FALL", "AAS"], ["ADN — Spring Entry", 75, "SPRING", "AAS"], ["LPN-to-ADN", 40, "SUMMER", "AAS"], ["Nursing Transition", 10, "SPRING", "AAS"]]);
    expect(nursing[3].joins).toEqual({ program: "ADN — Fall Entry", atTermIndex: 1, hostTermIndex: 2 });
    expect(nursing.slice(0, 3).every((p) => !p.joins)).toBe(true);
    const terms = (p: Coded) => p.terms(null).map((t) => [t.name, t.endWeek - t.startWeek + 1, t.courses.map((c) => c.code).join(" ")]);
    expect(terms(nursing[0])).toEqual([["First Fall", 16, "NUR 111 BIO 168 PSY 150 ENG 111"], ["First Spring", 16, "NUR 112 NUR 114 BIO 169 PSY 241"], ["Summer", 10, "NUR 113 BIO 275"], ["Second Fall", 16, "NUR 211 NUR 212 ENG 112"], ["Second Spring", 16, "NUR 213 HUM 115"]]);
    expect(terms(nursing[1]).map((t) => [t[0], t[1]])).toEqual([["First Spring", 16], ["First Summer", 10], ["First Fall", 16], ["Second Spring", 16], ["Second Summer", 10]]);
    expect(terms(nursing[2])).toEqual([["Summer — NUR 214", 10, "NUR 214"], ["Fall", 16, "NUR 221"], ["Spring", 16, "NUR 223"]]);
    // The transition is the ADN's second through fifth terms, so every course of every term is held in the host's sections.
    expect(terms(nursing[3])).toEqual(terms(nursing[0]).slice(1));
    expect(nursing[3].terms(null).map((t) => t.index)).toEqual([1, 2, 3, 4]);
    expect(nursing[1].note).toMatch(/inference/); expect(nursing[2].note).toMatch(/NUR 223's hour split was not read/);
    const est = inst.families[1];
    expect(est.soc).toBe("47-2111");
    expect(est.programs).toBe(CAPE_FEAR_PROGRAMS);
    expect(CAPE_FEAR_PROGRAMS.every((p) => p.launch === "FALL")).toBe(true);
  });
  it("the credentials carry the college's credit totals, the standard's hours, and the owner's class size of 16", () => {
    expect(Object.values(packs).map((p) => [p.name, p.terms.length, credits(p), p.maxCohort])).toEqual([
      ["Electrical Systems Technology Certificate (C35130)", 2, 15, 16],
      ["Electrical Systems Technology CTE Pathway (C35130CP)", 2, 15, 16],
      ["Electrical Systems Technology Diploma (D35130)", 3, 40, 16],
      ["Electrical Systems Technology AAS (A35130)", 5, 71, 16],
      ["Electrical Apprenticeship (ApprenticeshipNC, CFCC Job Training)", 4, 0, 16],
    ]);
    const aas = packs["cape-fear-est-aas.json"];
    expect(aas.terms.map((t) => [t.name, t.semester, t.endWeek - t.startWeek + 1, t.courses.map((c) => c.code)])).toEqual([
      ["Year 1 Fall", "Fall", 16, ["ELC 112", "ELC 113", "ELC 118", "ACA 111", "ENG 111"]],
      ["Year 1 Spring", "Spring", 16, ["ELC 117", "ELC 115", "ELC 131", "ELC 128", "MAT 110"]],
      ["Year 1 Summer", "Summer", 10, ["ELC 138", "ELC 220"]],
      ["Year 2 Fall", "Fall", 16, ["ELC 213", "ELC 133", "ELC 218", "ELC 233", "COM 231"]],
      ["Year 2 Spring", "Spring", 16, ["ELC 221", "ELC 215", "ELC 229", "Humanities/Fine Arts elective", "Social/Behavioral Science elective"]],
    ]);
    const hrs = (code: string) => { const c = course(aas, code); return `${c.weeklyClassHours}-${c.weeklyLabHours}-${c.credits}`; };
    expect(["ELC 112", "ELC 113", "ELC 118", "ELC 117", "ELC 115", "ELC 131", "ELC 128", "ELC 213", "ELC 133", "ELC 229"].map(hrs)).toEqual(["3-6-5", "2-6-4", "1-2-2", "2-6-4", "2-6-4", "3-3-4", "2-3-3", "3-2-4", "3-3-4", "1-6-3"]);
    // The 10-week summer carries the 16-week hours: ELC 138 (2-3) at 3.2 / 4.8 a week, 32 + 48 over the term.
    const elc138 = course(aas, "ELC 138");
    expect([elc138.weeklyClassHours, elc138.weeklyLabHours, hours(elc138, "CLASS"), hours(elc138, "LAB")]).toEqual([3.2, 4.8, 32, 48]);
    for (const p of Object.values(packs)) for (const c of courses(p)) { expect(c.weeklyClinicalHours).toBe(0); expect(c.sessions.some((s) => s.kind === "CLINICAL")).toBe(false); }
    // The diploma and the certificate are strict subsets of the AAS; the CTE pathway is the certificate's course list.
    const codes = (p: Pack) => courses(p).map((c) => c.code);
    const aasCodes = new Set(codes(aas));
    expect(codes(packs["cape-fear-est-diploma.json"]).every((c) => aasCodes.has(c))).toBe(true);
    expect(codes(packs["cape-fear-est-cert.json"])).toEqual(["ELC 112", "ELC 113", "ELC 118", "ELC 117"]);
    expect(codes(packs["cape-fear-est-cert-ctep.json"])).toEqual(codes(packs["cape-fear-est-cert.json"]));
    // Every program says its sequence is the standard's, awaiting the catalog.
    for (const p of Object.values(packs)) if (credits(p) > 0) expect(p.note).toMatch(/not yet confirmed against the catalog/);
  });
  it("ELC 112 and 113 sit on the college's announced evening sections at the North Campus, carrying the standard's hours; every other course has no section on record", () => {
    const aas = packs["cape-fear-est-aas.json"];
    expect(meetings(course(aas, "ELC 112"), "CLASS")).toEqual(["Tue 17:30-19:00 North Campus", "Thu 17:30-19:00 North Campus"]); // posted 5:30–8:10 PM; the class hour carried at 1.5 h
    expect(meetings(course(aas, "ELC 112"), "LAB")).toEqual(["Tue 19:00-22:00 North Campus", "Thu 19:00-22:00 North Campus"]);
    expect([hours(course(aas, "ELC 112"), "CLASS"), hours(course(aas, "ELC 112"), "LAB")]).toEqual([48, 96]);
    expect(meetings(course(aas, "ELC 113"), "CLASS")).toEqual(["Mon 17:30-18:30 North Campus", "Wed 17:30-18:30 North Campus"]);
    expect(course(aas, "ELC 112").sessions[0].notes).toMatch(/Posted block 17:30–18:30/);
    const elc117 = course(aas, "ELC 117");
    expect(elc117.sessions.every((s) => s.dayOfWeek === null && s.startTime === null && s.location === "North Campus" && /No section for this course is on record/.test(s.notes ?? ""))).toBe(true);
    expect(course(aas, "ENG 111").sessions.every((s) => s.dayOfWeek === null && s.location === "General classroom")).toBe(true);
    const ctep = course(packs["cape-fear-est-cert-ctep.json"], "ELC 112");
    expect(ctep.sessions.every((s) => s.dayOfWeek === null && s.location === "High school (CCP)")).toBe(true);
    // The owner's figures (2026-10-22): 16 students a section on every EST course (general-education sessions keep 30),
    // the handbook's load — 25 contact hours of a 40-hour week, 1.6 work hours a contact hour — on every session and program.
    for (const p of Object.values(packs)) {
      expect([p.assumptions.facContactHours, p.assumptions.facWorkWeekHours]).toEqual([25, 40]);
      for (const c of courses(p)) {
        expect(c.sessions.every((s) => s.facultyContactPolicy === 1.6), `${p.name} ${c.code} policy`).toBe(true);
        expect(c.sessions.every((s) => s.maxStudents === (c.courseType === "GENED" ? 30 : 16)), `${p.name} ${c.code} seats`).toBe(true);
      }
    }
  });
  it("the apprenticeship is four 30-week years a year apart, 156 classroom hours each, nights not published", () => {
    const p = packs["cape-fear-electrical-apprenticeship.json"];
    expect(p.calendarMode).toBe("continuous");
    expect(p.terms.map((t) => [t.name, t.startWeek, t.endWeek, t.courses.map((c) => c.code)])).toEqual([["Year 1", 1, 30, ["Level I"]], ["Year 2", 53, 82, ["Level II"]], ["Year 3", 105, 134, ["Level III"]], ["Year 4", 157, 186, ["Level IV"]]]);
    for (const c of courses(p)) {
      expect([c.weeklyClassHours, c.weeklyLabHours, c.credits]).toEqual([5.2, 0, 0]);
      expect(c.sessions).toHaveLength(60);
      expect(Math.round(hours(c, "CLASS"))).toBe(156);
      expect(c.sessions.every((s) => s.kind === "CLASS" && s.dayOfWeek === null && s.startTime === null)).toBe(true);
    }
    expect(courses(p).reduce((n, c) => n + hours(c, "CLASS"), 0)).toBeCloseTo(624, 0);
  });
  it("has the college's calendar as published — Summer 2026, Fall 2026 and Spring 2027 with their sessions and closures — and its places", () => {
    expect(CALENDAR_FILES["Cape Fear Community College"]).toBe("cape-fear.txt");
    const { events, warnings } = parseAcademicCalendar(readFileSync(new URL("../prisma/seed-data/calendars/cape-fear.txt", import.meta.url), "utf8"));
    expect(warnings).toEqual([]);
    expect(events.filter((e) => e.kind !== "other").map((e) => [e.kind, e.iso, e.endIso ?? null])).toEqual([
      ["term_start", "2026-05-18", null], ["session_start", "2026-06-02", null], ["session_start", "2026-06-23", null], ["term_end", "2026-07-27", null],
      ["term_start", "2026-08-17", null], ["holiday", "2026-09-07", null], ["session_start", "2026-09-14", null], ["session_start", "2026-10-13", null], ["session_start", "2026-11-16", null], ["holiday", "2026-11-26", "2026-11-27"], ["term_end", "2026-12-11", null], ["holiday", "2026-12-21", "2027-01-01"],
      ["term_start", "2027-01-05", null], ["holiday", "2027-01-18", null], ["session_start", "2027-02-01", null], ["session_start", "2027-03-10", null], ["holiday", "2027-03-26", null], ["term_end", "2027-05-05", null],
    ]);
    expect(anchorsFromEvents(events, { springStart: "01-10", summerStart: "05-20", fallStart: "08-15" })).toEqual({ springStart: "01-05", summerStart: "05-15", fallStart: "08-15" });
    const places = OTHER_CAMPUSES["Cape Fear Community College"];
    expect(places.map((p) => [p.name, p.city, p.zip])).toEqual([["North Campus", "Castle Hayne", "28429"], ["Burgaw Center", "Burgaw", "28425"], ["Alston W. Burke Center (Surf City)", "Hampstead", "28443"]]);
    for (const p of places) expect(geocodeOffline({ city: p.city, state: p.state })).not.toBeNull();
  });
});
