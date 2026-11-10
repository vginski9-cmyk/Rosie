import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { INSTITUTIONS, PAUSED_INSTITUTIONS, PITT_PROGRAMS } from "../prisma/seed-institutions";
import { parseAcademicCalendar, anchorsFromEvents } from "../src/lib/academiccalendar";
import { CALENDAR_FILES } from "../prisma/seed-calendars";
import { OTHER_CAMPUSES } from "../prisma/seed-campuses";
import { geocodeOffline } from "../src/lib/geo";

// Pitt Community College's Electrical Systems Technology: the AAS, the diploma, five certificates, the high-school Technical
// Academy, the summer Careers Electric Academy and the Pitt-sponsored electrician apprenticeship as template packs
// (scripts/build-pitt-packs.mjs, 2026-11-10). The college's credentials, course lists, credit totals, Technical Academy block,
// calendar and places; the NCCCS standard's course hours; sequences laid out to the totals. Labs, no clinicals; the workspace
// default load and a stand-in class size of 16 because the college publishes neither; nothing else unpublished is set.

type Session = { facultyContactPolicy: number | null; kind: string; week: number; dayOfWeek: string | null; startTime: string | null; endTime: string | null; lengthHours: number; location: string | null; maxStudents: number; notes: string | null };
type Course = { code: string; weeklyClassHours: number; weeklyLabHours: number; weeklyClinicalHours: number; credits: number; courseType: string; sessions: Session[] };
type Pack = { name: string; programType: string; credential: string; maxCohort: number | null; calendarMode?: string; note: string; assumptions: { facContactHours: number; facWorkWeekHours: number }; terms: { name: string; semester: string | null; startWeek: number; endWeek: number; courses: Course[] }[] };
const load = (file: string) => JSON.parse(readFileSync(new URL(`../prisma/templates/${file}`, import.meta.url), "utf8")) as Pack;
const packs = Object.fromEntries(PITT_PROGRAMS.map((p) => [p.pack, load(p.pack)]));
const courses = (p: Pack) => p.terms.flatMap((t) => t.courses);
const codes = (p: Pack) => courses(p).map((c) => c.code);
const credits = (p: Pack) => courses(p).reduce((n, c) => n + c.credits, 0);
const course = (p: Pack, code: string) => courses(p).find((c) => c.code === code)!;
const hours = (c: Course, kind: string) => Math.round(c.sessions.filter((s) => s.kind === kind).reduce((n, s) => n + s.lengthHours, 0) * 100) / 100;
const meetings = (c: Course, kind: string, week = 1) => c.sessions.filter((s) => s.kind === kind && s.week === week).map((s) => `${s.dayOfWeek} ${s.startTime}-${s.endTime} ${s.location}`);

describe("Pitt Community College", () => {
  it("is seeded (no longer paused) with one Electrical Systems Technology family of ten pack programs", () => {
    expect(PAUSED_INSTITUTIONS.has("Pitt Community College")).toBe(false);
    const inst = INSTITUTIONS.find((i) => i.name === "Pitt Community College")!;
    expect([inst.short, inst.city, inst.serviceArea]).toEqual(["Pitt CC", "Winterville", "Pitt County, NC"]);
    expect(inst.families.map((f) => f.name)).toEqual(["Electrical Systems Technology"]);
    expect(inst.families[0].soc).toBe("47-2111");
    expect(inst.families[0].programs).toBe(PITT_PROGRAMS);
    expect(PITT_PROGRAMS).toHaveLength(10);
    expect(PITT_PROGRAMS.map((p) => p.launch)).toEqual(["FALL", "FALL", "FALL", "FALL", "FALL", "FALL", "FALL", "FALL", "SUMMER", "FALL"]);
    expect(inst.families[0].description).toMatch(/Vernon E\. White Building/);
  });
  it("the credentials carry the college's course lists and totals, the standard's hours, and the stand-in class size of 16", () => {
    expect(Object.values(packs).map((p) => [p.name, p.programType, p.terms.length, credits(p), p.maxCohort])).toEqual([
      ["Electrical Systems Technology AAS (A35130)", "Traditional Full Time", 5, 68, 16],
      ["Electrical Systems Technology Diploma (D3513001)", "Traditional Full Time", 3, 43, 16],
      ["Basic Electrical Certificate (C3513001)", "Certificate", 2, 15, 16],
      ["Introduction to Electrical Certificate (C3513008)", "Certificate", 2, 14, 16],
      ["Programmable Logic Controller Certificate (C3513002)", "Certificate", 3, 16, 16],
      ["Industrial Controls Certificate (C3513003)", "Certificate", 2, 14, 16],
      ["Photovoltaic Systems Certificate (C3513004)", "Certificate", 2, 14, 16],
      ["Electrical Systems Technology — High School Technical Academy (CCP)", "High school (CCP)", 4, 19, 16],
      ["Careers Electric Academy (summer pre-apprenticeship)", "High school pre-apprenticeship", 1, 8, 16],
      ["Electrician Apprenticeship (Pitt CC sponsor, ApprenticeshipNC #97754)", "Registered apprenticeship", 4, 0, 16],
    ]);
    const aas = packs["pitt-est-aas.json"];
    expect(aas.terms.map((t) => [t.name, t.semester, t.endWeek - t.startWeek + 1, t.courses.map((c) => c.code)])).toEqual([
      ["Year 1 Fall", "Fall", 16, ["ELC 112", "ELC 113", "ELC 118", "ISC 112", "ACA 111", "ENG 111"]],
      ["Year 1 Spring", "Spring", 16, ["ELC 114", "ELC 117", "ELC 125", "BPR 130", "EGR 125", "MAT 110"]],
      ["Year 1 Summer", "Summer", 10, ["ELC 119", "ELC 128", "COM 231"]],
      ["Year 2 Fall", "Fall", 16, ["ELC 115", "ELC 228", "ELN 133", "Humanities/Fine Arts elective"]],
      ["Year 2 Spring", "Spring", 16, ["ELC 229", "ELC 220", "Major elective (2 credits)", "Social/Behavioral Science elective"]],
    ]);
    const hrs = (code: string) => { const c = course(aas, code); return `${c.weeklyClassHours}-${c.weeklyLabHours}-${c.credits}`; };
    expect(["ELC 112", "ELC 113", "ELC 114", "ELC 115", "ELC 117", "ELC 118", "ELC 125", "ELC 228", "ELN 133", "ELC 220", "ELC 229", "ISC 112", "BPR 130", "EGR 125"].map(hrs)).toEqual(["3-6-5", "2-6-4", "2-6-4", "2-6-4", "2-6-4", "1-2-2", "1-2-2", "2-6-4", "3-3-4", "2-3-3", "1-6-3", "2-0-2", "2-0-2", "1-2-2"]);
    // The 10-week summer carries the 16-week hours: ELC 119 (1-2) at 1.6 / 3.2 a week, 16 + 32 over the term.
    const elc119 = course(aas, "ELC 119");
    expect([elc119.weeklyClassHours, elc119.weeklyLabHours, hours(elc119, "CLASS"), hours(elc119, "LAB")]).toEqual([1.6, 3.2, 16, 32]);
    for (const p of Object.values(packs)) for (const c of courses(p)) { expect(c.weeklyClinicalHours).toBe(0); expect(c.sessions.some((s) => s.kind === "CLINICAL")).toBe(false); }
    // The diploma is the AAS's first year plus three summer courses — the college's published list of fifteen; every certificate is the college's four courses.
    const aasCodes = new Set(codes(aas));
    expect(codes(packs["pitt-est-diploma.json"]).every((c) => aasCodes.has(c))).toBe(true);
    expect(codes(packs["pitt-est-diploma.json"]).sort()).toEqual(["ACA 111", "BPR 130", "EGR 125", "ELC 112", "ELC 113", "ELC 114", "ELC 115", "ELC 117", "ELC 118", "ELC 119", "ELC 125", "ELC 229", "ENG 111", "ISC 112", "MAT 110"]);
    expect(codes(packs["pitt-est-cert-basic.json"])).toEqual(["ELC 112", "ELC 113", "ELC 118", "ELC 114"]);
    expect(codes(packs["pitt-est-cert-intro.json"])).toEqual(["ELC 112", "ELC 113", "ELC 118", "Fourth course (3 credits)"]);
    expect(codes(packs["pitt-est-cert-plc.json"])).toEqual(["ELC 112", "ELC 128", "ELC 228", "ELN 133"]);
    expect(codes(packs["pitt-est-cert-controls.json"])).toEqual(["ELC 112", "ELC 125", "ELC 117", "ELC 128"]);
    expect(codes(packs["pitt-est-cert-pv.json"])).toEqual(["ELC 112", "ELC 118", "ELC 114", "ELC 220"]);
    expect(codes(packs["pitt-careers-electric-academy.json"])).toEqual(["ELC 113", "ELC 118", "ISC 121"]);
    // Every credit program says its sequence awaits the catalog; the basic certificate records the 15-vs-14 difference.
    for (const [f, p] of Object.entries(packs)) if (credits(p) > 0 && !/academy/.test(f)) expect(p.note, f).toMatch(/not yet confirmed against the catalog/);
    expect(packs["pitt-est-cert-basic.json"].note).toMatch(/15 credits by the state standard where the 2022–23 catalog page shows 14/);
  });
  it("no curriculum section is published: every course carries its hours with no day or time in the Vernon E. White Building; the Technical Academy sits on the published Mon–Fri 9–11 block", () => {
    const aas = packs["pitt-est-aas.json"];
    const elc112 = course(aas, "ELC 112");
    expect(elc112.sessions.every((s) => s.dayOfWeek === null && s.startTime === null && /No section for this course is on record/.test(s.notes ?? ""))).toBe(true);
    expect([...new Set(elc112.sessions.map((s) => `${s.kind} ${s.location}`))]).toEqual(["CLASS Vernon E. White Building – Classroom", "LAB Vernon E. White Building – Wiring lab"]);
    expect([hours(elc112, "CLASS"), hours(elc112, "LAB")]).toEqual([48, 96]);
    expect(course(aas, "ENG 111").sessions.every((s) => s.dayOfWeek === null && s.location === "General classroom" && s.maxStudents === 30)).toBe(true);
    const academy = packs["pitt-est-hs-academy.json"];
    expect(academy.terms.map((t) => [t.name, t.courses.map((c) => c.code)])).toEqual([["Fall I", ["ELC 113", "ELC 118"]], ["Spring I", ["ELC 114"]], ["Fall II", ["ELC 112"]], ["Spring II", ["ELC 115"]]]);
    const elc113 = course(academy, "ELC 113");
    expect(meetings(elc113, "CLASS")).toEqual(["Mon 09:00-09:24 High school Technical Academy", "Tue 09:00-09:24 High school Technical Academy", "Wed 09:00-09:24 High school Technical Academy", "Thu 09:00-09:24 High school Technical Academy", "Fri 09:00-09:24 High school Technical Academy"]);
    expect(meetings(elc113, "LAB")[0]).toBe("Mon 09:24-10:36 High school Technical Academy");
    expect([hours(elc113, "CLASS"), hours(elc113, "LAB")]).toEqual([32, 96]);
    expect(elc113.sessions[0].notes).toMatch(/Mon–Fri 9:00–11:00 AM/);
    const careers = packs["pitt-careers-electric-academy.json"];
    expect(careers.terms[0].endWeek).toBe(8);
    const c113 = course(careers, "ELC 113");
    expect([c113.weeklyClassHours, c113.weeklyLabHours, hours(c113, "CLASS"), hours(c113, "LAB")]).toEqual([4, 12, 32, 96]);
    expect(c113.sessions.every((s) => s.dayOfWeek === null && s.location === "Vernon E. White Building – Wiring lab" || s.location === "Vernon E. White Building – Classroom")).toBe(true);
    // The workspace default load (16 of 40, 2.5) and the stand-in 16 seats on every EST session (general-education sessions keep 30).
    for (const p of Object.values(packs)) {
      expect([p.assumptions.facContactHours, p.assumptions.facWorkWeekHours]).toEqual([16, 40]);
      for (const c of courses(p)) {
        expect(c.sessions.every((s) => s.facultyContactPolicy === 2.5), `${p.name} ${c.code} policy`).toBe(true);
        expect(c.sessions.every((s) => s.maxStudents === (c.courseType === "GENED" ? 30 : 16)), `${p.name} ${c.code} seats`).toBe(true);
      }
    }
  });
  it("the apprenticeship is four 36-week years a year apart, 144 related-instruction hours each (the standard's minimum), delivery not published", () => {
    const p = packs["pitt-electrician-apprenticeship.json"];
    expect(p.calendarMode).toBe("continuous");
    expect(p.terms.map((t) => [t.name, t.startWeek, t.endWeek, t.courses.map((c) => c.code)])).toEqual([["Year 1", 1, 36, ["Year 1"]], ["Year 2", 53, 88, ["Year 2"]], ["Year 3", 105, 140, ["Year 3"]], ["Year 4", 157, 192, ["Year 4"]]]);
    for (const c of courses(p)) {
      expect([c.weeklyClassHours, c.weeklyLabHours, c.credits]).toEqual([4, 0, 0]);
      expect(c.sessions).toHaveLength(36);
      expect(hours(c, "CLASS")).toBe(144);
      expect(c.sessions.every((s) => s.kind === "CLASS" && s.dayOfWeek === null && s.startTime === null && s.location === null)).toBe(true);
    }
    expect(courses(p).reduce((n, c) => n + hours(c, "CLASS"), 0)).toBe(576);
    expect(p.note).toMatch(/8,000-hour term/);
    expect(p.note).toMatch(/Thomas Electrical Solutions and the City of Greenville/);
  });
  it("has the college's calendar as published — Fall 2026, Spring 2027 and the Summer 2027 start with the closures — and its places", () => {
    expect(CALENDAR_FILES["Pitt Community College"]).toBe("pitt.txt");
    const { events, warnings } = parseAcademicCalendar(readFileSync(new URL("../prisma/seed-data/calendars/pitt.txt", import.meta.url), "utf8"));
    expect(warnings).toEqual([]);
    expect(events.filter((e) => e.kind !== "other").map((e) => [e.kind, e.iso, e.endIso ?? null])).toEqual([
      ["term_start", "2026-08-14", null], ["holiday", "2026-09-05", "2026-09-07"], ["holiday", "2026-10-16", "2026-10-20"], ["term_end", "2026-12-15", null],
      ["term_start", "2027-01-08", null], ["holiday", "2027-01-16", "2027-01-18"], ["holiday", "2027-03-19", "2027-03-28"],
      ["term_start", "2027-05-24", null], ["holiday", "2027-05-29", "2027-05-31"],
    ]);
    expect(anchorsFromEvents(events, { springStart: "01-10", summerStart: "05-20", fallStart: "08-15" })).toEqual({ springStart: "01-08", summerStart: "05-22", fallStart: "08-14" });
    const places = OTHER_CAMPUSES["Pitt Community College"];
    expect(places.map((p) => [p.name, p.city, p.zip])).toEqual([["Greenville Center", "Greenville", "27834"]]);
    for (const p of places) expect(geocodeOffline({ city: p.city, state: p.state })).not.toBeNull();
    for (const town of ["Winterville", "Greenville", "Ayden", "Farmville", "Grifton", "Bethel"]) expect(geocodeOffline({ city: town, state: "NC" }), town).not.toBeNull();
  });
});
