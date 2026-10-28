import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { INSTITUTIONS, PAUSED_INSTITUTIONS, SOUTHEASTERN_PROGRAMS } from "../prisma/seed-institutions";
import { parseAcademicCalendar, anchorsFromEvents } from "../src/lib/academiccalendar";
import { CALENDAR_FILES } from "../prisma/seed-calendars";
import { NURSING_ROTATIONS } from "../prisma/seed-kits";
import { PARTNER_SITES } from "../prisma/seed-partner-sites";
import { EXTRA_POLICIES } from "../prisma/seed-roster";

// Southeastern Community College's RN pathways — the ADN (fall entry) and the accelerated LPN-to-ADN Transition
// (summer entry, HyFlex) — as template packs (scripts/build-southeastern-packs.mjs). The college's programs, calendar
// and building; the NCCCS standard's hours and credits; and, from the program's own account to the owner on
// 2026-10-28: the term placement, the eight-week sessions, hospital-only rotations with rotate-out days, clinical
// groups of ten, NUR 111's lab split, the 180 + 60 preceptorship, a class of 60 and the 20–24-hour load.

type Session = { kind: string; week: number; dayOfWeek: string | null; startTime: string | null; lengthHours: number; location: string | null; maxStudents: number; facultyNeeded: number; deliveryMode: string; rotationType: string | null; clinicalMode: string | null; preceptorsNeeded: number; notes: string | null };
type Course = { code: string; weeklyClassHours: number; weeklyLabHours: number; weeklyClinicalHours: number; credits: number; courseType: string; description: string | null; sessions: Session[] };
type Pack = { name: string; programType: string; credential: string; maxCohort: number | null; maxCohortNote: string; weeklyHoursNote: string; assumptions: { facContactHours: number; facWorkWeekHours: number }; terms: { name: string; semester: string | null; startWeek: number; endWeek: number; courses: Course[] }[] };
const load = (file: string) => JSON.parse(readFileSync(new URL(`../prisma/templates/${file}`, import.meta.url), "utf8")) as Pack;
const packs = Object.fromEntries(SOUTHEASTERN_PROGRAMS.map((p) => [p.pack, load(p.pack)]));
const adn = packs["southeastern-adn.json"], lpn = packs["southeastern-lpn-adn.json"];
const courses = (p: Pack) => p.terms.flatMap((t) => t.courses);
const credits = (p: Pack) => courses(p).reduce((n, c) => n + c.credits, 0);
const course = (p: Pack, code: string) => courses(p).find((c) => c.code === code)!;
const hours = (c: Course, kind: string) => Math.round(c.sessions.filter((s) => s.kind === kind).reduce((n, s) => n + s.lengthHours, 0) * 100) / 100;
const clinical = (c: Course) => c.sessions.filter((s) => s.kind === "CLINICAL");
const rotations = (c: Course) => [...new Set(clinical(c).map((s) => s.rotationType))];
const weeks = (c: Course) => [Math.min(...clinical(c).map((s) => s.week)), Math.max(...clinical(c).map((s) => s.week))];
const KNOWN = new Set(NURSING_ROTATIONS.map(([r]) => r));

describe("Southeastern Community College", () => {
  it("is seeded with one RN family of two pack programs, the program's own health rates, a 45-minute core band and the SC labor shed", () => {
    expect(PAUSED_INSTITUTIONS.has("Southeastern Community College")).toBe(false);
    const inst = INSTITUTIONS.find((i) => i.name === "Southeastern Community College")!;
    expect(inst.city).toBe("Whiteville"); expect(inst.serviceArea).toMatch(/^Columbus County, NC, and the Horry County, SC labor shed/);
    expect(inst.rings).toEqual({ core: 45, one: 60, two: 90 });
    expect(inst.families).toHaveLength(1);
    expect([inst.families[0].name, inst.families[0].soc, inst.families[0].programs, inst.families[0].rates]).toEqual(["Nursing (prelicensure RN)", "29-1141", SOUTHEASTERN_PROGRAMS, { completionRate: 0.86, licensureRate: 0.84 }]);
    expect(inst.families[0].description).toMatch(/2027–2030 targets are due Dec 4/);
    expect(SOUTHEASTERN_PROGRAMS.map((p) => [p.pack, p.launch])).toEqual([["southeastern-adn.json", "FALL"], ["southeastern-lpn-adn.json", "SUMMER"]]);
    for (const p of SOUTHEASTERN_PROGRAMS) expect(p.note).toMatch(/told the owner on 2026-10-28/);
    expect(SOUTHEASTERN_PROGRAMS[1].note).toMatch(/NUR 221/);
  });
  it("the ADN runs the program's own sequence — NUR 112 and 211 in the first spring, 114 in the summer, 113 and 212 in the second fall — as eight-week sessions except NUR 111 and 213", () => {
    expect([adn.name, adn.programType, adn.maxCohort, credits(adn)]).toEqual(["Associate Degree Nursing (A45110)", "Traditional Full Time", 60, 67]);
    expect([lpn.name, lpn.programType, lpn.maxCohort, credits(lpn)]).toEqual(["LPN-to-ADN Transition (A45110, accelerated bridge)", "Transition (LPN)", 20, 32]);
    expect(adn.terms.map((t) => [t.name, t.semester, t.endWeek - t.startWeek + 1, t.courses.map((c) => c.code)])).toEqual([
      ["Fall 1", "Fall", 16, ["NUR 111", "BIO 168", "ENG 111", "ACA 122"]],
      ["Spring 1", "Spring", 16, ["NUR 112", "NUR 211", "BIO 169", "PSY 150"]],
      ["Summer", "Summer", 10, ["NUR 114", "ENG 112"]],
      ["Fall 2", "Fall", 16, ["NUR 113", "NUR 212", "PSY 241"]],
      ["Spring 2", "Spring", 16, ["NUR 213", "PHI 240"]],
    ]);
    expect(lpn.terms.map((t) => [t.name, t.semester, t.endWeek - t.startWeek + 1, t.courses.map((c) => c.code)])).toEqual([
      ["Summer", "Summer", 10, ["NUR 214"]], ["Fall", "Fall", 16, ["NUR 211", "NUR 212", "PSY 241"]], ["Spring", "Spring", 16, ["NUR 213", "PHI 240"]],
    ]);
    // Eight-week sessions: 112 weeks 1–8 and 211 weeks 9–16 of the spring; 113 weeks 1–8 (Aug 17 – Oct 8) and 212 weeks 9–16 of the fall;
    // 114 the summer's eight-week session (weeks 3–10 of the 10-week term); 111 and 213 the whole term.
    expect(["NUR 111", "NUR 112", "NUR 211", "NUR 114", "NUR 113", "NUR 212", "NUR 213"].map((c) => weeks(course(adn, c)))).toEqual([[1, 16], [1, 8], [9, 16], [3, 10], [1, 8], [9, 16], [1, 16]]);
    const hrs = (code: string) => { const c = course(adn, code); return `${c.weeklyClassHours}-${c.weeklyLabHours}-${c.weeklyClinicalHours}-${c.credits}`; };
    expect(["NUR 111", "NUR 112", "NUR 113", "NUR 211", "NUR 212", "NUR 213"].map(hrs)).toEqual(["4-6-6-8", "3-0-6-5", "3-0-6-5", "3-0-6-5", "3-0-6-5", "4-3-15-10"]);
    expect([course(adn, "NUR 114").weeklyClassHours, course(adn, "NUR 114").weeklyClinicalHours]).toEqual([4.8, 9.6]); // the 10-week term carries the 16-week hours
    for (const p of [adn, lpn]) { expect([p.assumptions.facContactHours, p.assumptions.facWorkWeekHours]).toEqual([20, 40]); expect(p.weeklyHoursNote).toMatch(/eight-week session/); }
    expect(adn.maxCohortNote).toMatch(/physical resources/); expect(adn.maxCohortNote).toMatch(/42 students in Fall 2026/); expect(lpn.maxCohortNote).toMatch(/NUR 221/);
    for (const c of courses(adn).filter((c) => c.courseType === "CORE")) expect(c.description).toMatch(/stated 2026-10-28/);
  });
  it("NUR 111's lab is split as the program runs it; every other course meets as one cohort with one instructor", () => {
    const n111 = course(adn, "NUR 111");
    expect([hours(n111, "CLASS"), hours(n111, "LAB"), hours(n111, "CLINICAL")]).toEqual([64, 96, 96]);
    const labs = n111.sessions.filter((s) => s.kind === "LAB");
    expect(labs).toHaveLength(32);
    expect(labs.filter((s) => s.dayOfWeek === "Tue").every((s) => s.lengthHours === 3 && s.maxStudents === 60 && s.facultyNeeded === 4 && s.location === "R Building – Nursing classroom")).toBe(true);
    expect(labs.filter((s) => s.dayOfWeek === "Thu").every((s) => s.lengthHours === 3 && s.maxStudents === 30 && s.facultyNeeded === 2 && s.location === "R Building – Skills lab")).toBe(true);
    expect(labs.filter((s) => s.dayOfWeek === "Tue")).toHaveLength(16);
    expect(n111.sessions.find((s) => s.kind === "CLASS")!.maxStudents).toBe(60);
    expect(clinical(n111).every((s) => s.dayOfWeek === "Wed" && s.maxStudents === 10 && s.lengthHours === 6 && s.clinicalMode === "Instructor-led" && s.preceptorsNeeded === 0)).toBe(true);
    // Everything else: no day or time yet, class and lab rows at the cohort size with one instructor, clinical groups of ten in 12-hour shifts.
    for (const p of [adn, lpn]) for (const c of courses(p)) for (const s of c.sessions) {
      if (c.code !== "NUR 111") { expect(s.dayOfWeek).toBeNull(); }
      expect(s.startTime).toBeNull();
      if (c.courseType === "GENED") expect(["General classroom", "General lab"]).toContain(s.location);
      else if (s.kind === "CLINICAL") expect(s.clinicalMode === "Simulation" ? s.location : "Clinical site").toBe(s.clinicalMode === "Simulation" ? "R Building – Simulation lab" : s.location);
      else { expect(s.location).toMatch(/^R Building – /); if (c.code !== "NUR 111") expect([s.maxStudents, s.facultyNeeded]).toEqual([p.maxCohort, 1]); }
    }
    for (const code of ["NUR 112", "NUR 211", "NUR 114", "NUR 113", "NUR 212"]) expect(clinical(course(adn, code)).every((s) => s.maxStudents === 10 && s.lengthHours === 12 && s.clinicalMode === "Instructor-led"), code).toBe(true);
    expect(course(lpn, "NUR 214").sessions.filter((s) => s.kind === "CLASS").every((s) => s.deliveryMode === "HyFlex")).toBe(true);
  });
  it("the preceptorship is fifteen 12-hour shifts 1:1 with a hospital RN plus 60 hours of simulation, one faculty member per fifteen students", () => {
    for (const p of [adn, lpn]) {
      const n213 = course(p, "NUR 213");
      expect([hours(n213, "CLASS"), hours(n213, "LAB"), hours(n213, "CLINICAL")]).toEqual([64, 48, 240]);
      const precepted = clinical(n213).filter((s) => s.clinicalMode === "Preceptor-led"), sim = clinical(n213).filter((s) => s.clinicalMode === "Simulation");
      expect(precepted).toHaveLength(15);
      expect(precepted.every((s) => s.lengthHours === 12 && s.maxStudents === 1 && s.preceptorsNeeded === 1 && s.facultyNeeded === 0.067 && s.rotationType === "Med-Surg or Critical Care" && s.location === "Clinical site" && s.week >= 9)).toBe(true);
      expect(sim.reduce((n, s) => n + s.lengthHours, 0)).toBe(60);
      expect(sim.every((s) => s.maxStudents === 10 && s.facultyNeeded === 1 && s.preceptorsNeeded === 0 && s.rotationType === null && s.location === "R Building – Simulation lab" && s.week <= 8)).toBe(true);
      expect(precepted[0].notes).toMatch(/two years' experience/);
    }
  });
  it("clinicals are hospital med-surg every time with the program's rotate-out days, every setting in the nursing rotation table", () => {
    expect(rotations(course(adn, "NUR 111"))).toEqual(["Med-Surg"]);
    expect(rotations(course(adn, "NUR 112"))).toEqual(["Med-Surg"]);
    expect(rotations(course(adn, "NUR 211"))).toEqual(["Med-Surg"]);
    expect(rotations(course(adn, "NUR 114"))).toEqual(["Med-Surg"]); // no psychiatric rotate-out any more
    expect(rotations(course(adn, "NUR 113"))).toEqual(["Med-Surg", "Obstetrics", "Pediatrics"]);
    expect(rotations(course(adn, "NUR 212"))).toEqual(["Med-Surg", "Critical Care", "Emergency"]);
    expect(rotations(course(lpn, "NUR 214"))).toEqual(["Med-Surg"]);
    const count = (code: string, rt: string) => clinical(course(adn, code)).filter((s) => s.rotationType === rt).length;
    expect([count("NUR 113", "Med-Surg"), count("NUR 113", "Obstetrics"), count("NUR 113", "Pediatrics"), count("NUR 212", "Critical Care"), count("NUR 212", "Emergency")]).toEqual([6, 1, 1, 1, 1]);
    for (const p of [adn, lpn]) for (const c of courses(p)) for (const s of clinical(c).filter((x) => x.clinicalMode !== "Simulation")) {
      expect(KNOWN.has(s.rotationType ?? ""), `${c.code} ${s.rotationType}`).toBe(true);
      expect(s.notes).toMatch(/as the program described it \(2026-10-28\)/);
    }
    expect(clinical(course(adn, "NUR 113")).find((s) => s.rotationType === "Obstetrics")!.notes).toMatch(/rotate-out day/);
  });
  it("carries the program's stated load — 20 to 24 contact hours, the coordinators' own rows", () => {
    expect(EXTRA_POLICIES["Southeastern Community College"].map((p) => [p.title, p.contactHoursPerWeek, p.maxContactHoursPerWeek])).toEqual([["Simulation Lab Coordinator", 18, 20], ["Program Coordinator", 18, 22]]);
    const roster = readFileSync(new URL("../prisma/seed-roster.ts", import.meta.url), "utf8");
    expect(roster).toMatch(/"Southeastern Community College": \{ "full-time": \{ contactHoursPerWeek: 20, workWeekHours: 40, hoursPerContactHour: 2, maxContactHoursPerWeek: 24 \} \}/);
  });
  it("has the college's 2026–27 calendar — three semesters with their sessions and closures — and its clinical sites, all prospects until the validated list arrives", () => {
    expect(CALENDAR_FILES["Southeastern Community College"]).toBe("southeastern.txt");
    const { events, warnings } = parseAcademicCalendar(readFileSync(new URL("../prisma/seed-data/calendars/southeastern.txt", import.meta.url), "utf8"));
    expect(warnings).toEqual([]);
    expect(events.filter((e) => e.kind !== "other").map((e) => [e.kind, e.iso, e.endIso ?? null])).toEqual([
      ["term_start", "2026-08-17", null], ["session_start", "2026-08-31", null], ["holiday", "2026-09-07", null], ["session_start", "2026-09-08", null], ["holiday", "2026-10-12", "2026-10-13"], ["session_start", "2026-10-14", null], ["holiday", "2026-11-11", null], ["holiday", "2026-11-25", "2026-11-27"], ["session_start", "2026-12-01", null], ["term_end", "2026-12-09", null],
      ["holiday", "2027-01-01", null], ["holiday", "2027-01-04", null], ["term_start", "2027-01-11", null], ["holiday", "2027-01-18", null], ["session_start", "2027-01-26", null], ["session_start", "2027-02-02", null], ["holiday", "2027-03-01", null], ["session_start", "2027-03-08", null], ["holiday", "2027-03-26", null], ["holiday", "2027-03-29", "2027-04-02"], ["term_end", "2027-05-05", null],
      ["term_start", "2027-05-17", null], ["holiday", "2027-05-31", null], ["session_start", "2027-06-01", null], ["session_start", "2027-06-08", null], ["session_start", "2027-06-22", null], ["holiday", "2027-07-05", null], ["term_end", "2027-07-27", null],
    ]);
    expect(anchorsFromEvents(events, { springStart: "01-11", summerStart: "05-17", fallStart: "08-17" })).toEqual({ springStart: "01-08", summerStart: "05-15", fallStart: "08-15" });
    const sites = PARTNER_SITES.filter((s) => s.institution === "Southeastern Community College");
    expect(sites.length).toBeGreaterThanOrEqual(31);
    expect(sites.every((s) => s.agreement === "prospect")).toBe(true); // the owner's call (2026-10-28): nothing secured until the college's validated list arrives
    expect(sites.filter((s) => s.state === "SC").map((s) => s.city).sort()).toEqual(["Little River", "Loris", "Loris"]);
    const seacoast = sites.find((s) => s.id === "SCC-H05")!;
    expect([seacoast.name, seacoast.city, seacoast.licensedBeds, seacoast.kits!.map((k) => k.code)]).toEqual(["McLeod Health Seacoast", "Little River", undefined, ["BEDS", "ICU", "ED"]]);
    expect(sites.find((s) => s.id === "SCC-S07")!.note).toMatch(/does not use this site/);
  });
});
