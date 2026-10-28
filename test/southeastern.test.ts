import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { INSTITUTIONS, PAUSED_INSTITUTIONS, SOUTHEASTERN_PROGRAMS } from "../prisma/seed-institutions";
import { parseAcademicCalendar, anchorsFromEvents } from "../src/lib/academiccalendar";
import { CALENDAR_FILES } from "../prisma/seed-calendars";
import { NURSING_ROTATIONS } from "../prisma/seed-kits";
import { PARTNER_SITES } from "../prisma/seed-partner-sites";

// Southeastern Community College's RN pathways — the ADN (fall entry) and the accelerated LPN-to-ADN Transition
// (summer entry, HyFlex) — as template packs (scripts/build-southeastern-packs.mjs, 2026-10-28): the college's
// programs, calendar, building and the NC Board of Nursing's cap; the NCCCS standard's hours and sequence; each
// clinical session carrying the standard's usual setting, flagged, so the scheduler can match the sites within
// the owner's 45-minute radius.

type Session = { kind: string; week: number; dayOfWeek: string | null; startTime: string | null; lengthHours: number; location: string | null; maxStudents: number; deliveryMode: string; rotationType: string | null; clinicalMode: string | null; preceptorsNeeded: number; notes: string | null };
type Course = { code: string; weeklyClassHours: number; weeklyLabHours: number; weeklyClinicalHours: number; credits: number; courseType: string; description: string | null; sessions: Session[] };
type Pack = { name: string; programType: string; credential: string; maxCohort: number | null; maxCohortNote: string; note?: string; assumptions: { facContactHours: number; facWorkWeekHours: number }; terms: { name: string; semester: string | null; startWeek: number; endWeek: number; courses: Course[] }[] };
const load = (file: string) => JSON.parse(readFileSync(new URL(`../prisma/templates/${file}`, import.meta.url), "utf8")) as Pack;
const packs = Object.fromEntries(SOUTHEASTERN_PROGRAMS.map((p) => [p.pack, load(p.pack)]));
const adn = packs["southeastern-adn.json"], lpn = packs["southeastern-lpn-adn.json"];
const courses = (p: Pack) => p.terms.flatMap((t) => t.courses);
const credits = (p: Pack) => courses(p).reduce((n, c) => n + c.credits, 0);
const course = (p: Pack, code: string) => courses(p).find((c) => c.code === code)!;
const hours = (c: Course, kind: string) => Math.round(c.sessions.filter((s) => s.kind === kind).reduce((n, s) => n + s.lengthHours, 0) * 100) / 100;
const rotations = (c: Course) => [...new Set(c.sessions.filter((s) => s.kind === "CLINICAL").map((s) => s.rotationType))];
const KNOWN = new Set(NURSING_ROTATIONS.map(([r]) => r));

describe("Southeastern Community College", () => {
  it("is seeded with one RN family of two pack programs, a 45-minute core band, and no coded placeholder", () => {
    expect(PAUSED_INSTITUTIONS.has("Southeastern Community College")).toBe(false);
    const inst = INSTITUTIONS.find((i) => i.name === "Southeastern Community College")!;
    expect([inst.city, inst.serviceArea]).toEqual(["Whiteville", "Columbus County, NC"]);
    expect(inst.rings).toEqual({ core: 45, one: 60, two: 90 });
    expect(inst.families).toHaveLength(1);
    expect([inst.families[0].name, inst.families[0].soc, inst.families[0].programs]).toEqual(["Nursing (prelicensure RN)", "29-1141", SOUTHEASTERN_PROGRAMS]);
    expect(SOUTHEASTERN_PROGRAMS.map((p) => [p.pack, p.launch])).toEqual([["southeastern-adn.json", "FALL"], ["southeastern-lpn-adn.json", "SUMMER"]]);
    for (const p of SOUTHEASTERN_PROGRAMS) expect(p.note).toMatch(/derived at the owner's request/);
  });
  it("the ADN is the standard's five-term sequence with the college's general-education courses; the bridge is three semesters", () => {
    expect([adn.name, adn.programType, adn.maxCohort, credits(adn)]).toEqual(["Associate Degree Nursing (A45110)", "Traditional Full Time", 70, 67]);
    expect([lpn.name, lpn.programType, lpn.maxCohort, credits(lpn)]).toEqual(["LPN-to-ADN Transition (A45110, accelerated bridge)", "Transition (LPN)", 20, 32]);
    expect(adn.terms.map((t) => [t.name, t.semester, t.endWeek - t.startWeek + 1, t.courses.map((c) => c.code)])).toEqual([
      ["Fall 1", "Fall", 16, ["NUR 111", "BIO 168", "ENG 111", "ACA 122"]],
      ["Spring 1", "Spring", 16, ["NUR 112", "NUR 114", "BIO 169", "PSY 150"]],
      ["Summer", "Summer", 10, ["NUR 113", "ENG 112"]],
      ["Fall 2", "Fall", 16, ["NUR 211", "NUR 212", "PSY 241"]],
      ["Spring 2", "Spring", 16, ["NUR 213", "PHI 240"]],
    ]);
    expect(lpn.terms.map((t) => [t.name, t.semester, t.endWeek - t.startWeek + 1, t.courses.map((c) => c.code)])).toEqual([
      ["Summer", "Summer", 10, ["NUR 214"]], ["Fall", "Fall", 16, ["NUR 211", "NUR 212", "PSY 241"]], ["Spring", "Spring", 16, ["NUR 213", "PHI 240"]],
    ]);
    const hrs = (code: string) => { const c = course(adn, code); return `${c.weeklyClassHours}-${c.weeklyLabHours}-${c.weeklyClinicalHours}-${c.credits}`; };
    expect(["NUR 111", "NUR 112", "NUR 114", "NUR 211", "NUR 212", "NUR 213"].map(hrs)).toEqual(["4-6-6-8", "3-0-6-5", "3-0-6-5", "3-0-6-5", "3-0-6-5", "4-3-15-10"]);
    // The 10-week summer carries the 16-week hours: NUR 113 (3-0-6) at 4.8 / 9.6 a week.
    expect([course(adn, "NUR 113").weeklyClassHours, course(adn, "NUR 113").weeklyClinicalHours]).toEqual([4.8, 9.6]);
    for (const p of [adn, lpn]) { expect([p.assumptions.facContactHours, p.assumptions.facWorkWeekHours]).toEqual([16, 40]); expect(p.maxCohortNote).toMatch(/140/); }
    for (const c of courses(adn).filter((c) => c.courseType === "CORE")) expect(c.description).toMatch(/not yet confirmed against the college's catalog/);
  });
  it("every session carries the standard's hours with no day or time, in the R Building or at a clinical site", () => {
    const n111 = course(adn, "NUR 111");
    expect([hours(n111, "CLASS"), hours(n111, "LAB"), hours(n111, "CLINICAL")]).toEqual([64, 96, 96]);
    const n213 = course(adn, "NUR 213");
    expect([hours(n213, "CLASS"), hours(n213, "LAB"), hours(n213, "CLINICAL")]).toEqual([64, 48, 240]);
    for (const p of [adn, lpn]) for (const c of courses(p)) for (const s of c.sessions) {
      expect(s.dayOfWeek).toBeNull(); expect(s.startTime).toBeNull();
      if (c.courseType === "GENED") expect(["General classroom", "General lab"]).toContain(s.location);
      else if (s.kind === "CLINICAL") expect(s.location).toBe("Clinical site");
      else expect(s.location).toMatch(/^R Building – /);
    }
    expect(course(adn, "NUR 111").sessions.find((s) => s.kind === "CLASS")!.deliveryMode).toBe("In-person");
    expect(course(lpn, "NUR 214").sessions.filter((s) => s.kind === "CLASS").every((s) => s.deliveryMode === "HyFlex")).toBe(true);
    expect(course(lpn, "NUR 211").sessions.filter((s) => s.kind === "CLASS").every((s) => s.deliveryMode === "HyFlex")).toBe(true);
    // Class sizes on class and lab rows; instructor-led clinical groups of eight; the capstone precepted 1:1.
    expect(n111.sessions.find((s) => s.kind === "CLASS")!.maxStudents).toBe(70);
    expect(n111.sessions.filter((s) => s.kind === "CLINICAL").every((s) => s.maxStudents === 8 && s.clinicalMode === "Instructor-led" && s.preceptorsNeeded === 0)).toBe(true);
    expect(n213.sessions.filter((s) => s.kind === "CLINICAL").every((s) => s.maxStudents === 1 && s.clinicalMode === "Preceptor-led" && s.preceptorsNeeded === 1)).toBe(true);
    expect(n213.sessions.filter((s) => s.kind === "CLINICAL")).toHaveLength(24); // a 12-hour shift a week and a second in alternate weeks, carried at 10 h for the 15 × 16 total
  });
  it("each clinical course carries the standard's usual settings in consecutive blocks, every one in the nursing rotation table and flagged", () => {
    expect(rotations(course(adn, "NUR 111"))).toEqual(["Long-Term Care", "Med-Surg"]);
    expect(rotations(course(adn, "NUR 112"))).toEqual(["Med-Surg"]);
    expect(rotations(course(adn, "NUR 114"))).toEqual(["Behavioral Health"]);
    expect(rotations(course(adn, "NUR 113"))).toEqual(["Obstetrics", "Pediatrics"]);
    expect(rotations(course(adn, "NUR 211"))).toEqual(["Med-Surg"]);
    expect(rotations(course(adn, "NUR 212"))).toEqual(["Critical Care", "Community Health"]);
    expect(rotations(course(adn, "NUR 213"))).toEqual(["Med-Surg or Critical Care"]);
    expect(rotations(course(lpn, "NUR 214"))).toEqual(["Med-Surg"]);
    // NUR 111's blocks: long-term care weeks 1–8, med-surg 9–16.
    const w = (code: string, rt: string) => course(adn, code).sessions.filter((s) => s.kind === "CLINICAL" && s.rotationType === rt).map((s) => s.week);
    expect([Math.min(...w("NUR 111", "Long-Term Care")), Math.max(...w("NUR 111", "Long-Term Care")), Math.min(...w("NUR 111", "Med-Surg"))]).toEqual([1, 8, 9]);
    for (const p of [adn, lpn]) for (const c of courses(p)) for (const s of c.sessions.filter((x) => x.kind === "CLINICAL")) {
      expect(KNOWN.has(s.rotationType ?? ""), `${c.code} ${s.rotationType}`).toBe(true);
      expect(s.notes).toMatch(/not the college's own rotation plan/);
    }
  });
  it("has the college's 2026–27 calendar — three semesters with their sessions and closures — and its clinical sites within 45 minutes", () => {
    expect(CALENDAR_FILES["Southeastern Community College"]).toBe("southeastern.txt");
    const { events, warnings } = parseAcademicCalendar(readFileSync(new URL("../prisma/seed-data/calendars/southeastern.txt", import.meta.url), "utf8"));
    expect(warnings).toEqual([]);
    expect(events.filter((e) => e.kind !== "other").map((e) => [e.kind, e.iso, e.endIso ?? null])).toEqual([
      ["term_start", "2026-08-17", null], ["session_start", "2026-08-31", null], ["holiday", "2026-09-07", null], ["session_start", "2026-09-08", null], ["holiday", "2026-10-12", "2026-10-13"], ["session_start", "2026-10-14", null], ["holiday", "2026-11-11", null], ["holiday", "2026-11-25", "2026-11-27"], ["session_start", "2026-12-01", null], ["term_end", "2026-12-09", null],
      ["holiday", "2027-01-01", null], ["holiday", "2027-01-04", null], ["term_start", "2027-01-11", null], ["holiday", "2027-01-18", null], ["session_start", "2027-01-26", null], ["session_start", "2027-02-02", null], ["holiday", "2027-03-01", null], ["session_start", "2027-03-08", null], ["holiday", "2027-03-26", null], ["holiday", "2027-03-29", "2027-04-02"], ["term_end", "2027-05-05", null],
      ["term_start", "2027-05-17", null], ["holiday", "2027-05-31", null], ["session_start", "2027-06-01", null], ["session_start", "2027-06-08", null], ["session_start", "2027-06-22", null], ["holiday", "2027-07-05", null], ["term_end", "2027-07-27", null],
    ]);
    // Every semester opens on a Monday (Aug 17, 2026; Jan 11 and May 17, 2027): the Monday on or after each anchor is the coded date.
    expect(anchorsFromEvents(events, { springStart: "01-11", summerStart: "05-17", fallStart: "08-17" })).toEqual({ springStart: "01-08", summerStart: "05-15", fallStart: "08-15" });
    const sites = PARTNER_SITES.filter((s) => s.institution === "Southeastern Community College");
    expect(sites.length).toBeGreaterThanOrEqual(30);
    expect(sites.every((s) => s.agreement === "prospect")).toBe(true); // the owner's call: nothing marked secured until the college confirms
    expect(sites.filter((s) => s.state === "SC").map((s) => s.city)).toEqual(["Loris", "Loris"]);
  });
});
