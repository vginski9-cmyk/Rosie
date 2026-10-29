import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { INSTITUTIONS, PAUSED_INSTITUTIONS } from "../prisma/seed-institutions";
import { parseAcademicCalendar, anchorsFromEvents } from "../src/lib/academiccalendar";
import { CALENDAR_FILES } from "../prisma/seed-calendars";
import { OTHER_CAMPUSES } from "../prisma/seed-campuses";
import { PARTNER_SITES } from "../prisma/seed-partner-sites";
import { geocodeOffline } from "../src/lib/geo";

// Craven Community College's Nurse Aide Level I from the contractor's validated workbook (Craven_NA1_templates_v2_3.xlsx,
// 2026-10-29): five delivery models, session for session, rebuilt by scripts/import-cna-pack.mjs into
// prisma/templates/cna-craven.json — the college's clinical-hours bucket (site shifts + final exam + post-clinical skills lab)
// read with its on-campus rows as class and lab, the CCP track's asynchronous online rows with no weekday.

type Session = { kind: string; number: number; title: string | null; week: number | null; dayOfWeek: string | null; startTime?: string | null; lengthHours: number; maxStudents: number; facultyNeeded: number; facultyContactPolicy: number | null; deliveryMode: string | null; location: string | null; rotationType: string | null; clinicalMode: string | null; notes: string | null };
type Pack = { name: string; label: string; version?: string; programType: string; credential: string; termWeeks: number; maxCohort: number; assumptions: { facContactHours: number; facWorkWeekHours: number }; course: { code: string; title: string; weeklyClassHours: number; weeklyLabHours: number; weeklyClinicalHours: number }; sessions: Session[] }[];
const pack = JSON.parse(readFileSync(new URL("../prisma/templates/cna-craven.json", import.meta.url), "utf8")) as Pack;
const of = (t: Pack[number], kind: string) => t.sessions.filter((s) => s.kind === kind);
const hours = (t: Pack[number], kind: string) => Math.round(of(t, kind).reduce((n, s) => n + s.lengthHours, 0) * 100) / 100;
const [day, night, ccp, sumDay, sumNight] = pack;

describe("Craven Community College", () => {
  it("is seeded with one Nurse Aide family carrying the validated pack, two campuses and a 45-minute core band", () => {
    expect(PAUSED_INSTITUTIONS.has("Craven Community College")).toBe(false);
    const inst = INSTITUTIONS.find((i) => i.name === "Craven Community College")!;
    expect([inst.city, inst.rings]).toEqual(["New Bern", { core: 45, one: 60, two: 90 }]);
    expect([inst.families[0].name, inst.families[0].cna, inst.families[0].cnaAll, inst.families[0].programs]).toEqual(["Nurse Aide (CNA)", true, "craven", []]);
    expect(inst.families[0].description).toMatch(/validated workbook \(v2\.3/); expect(inst.families[0].description).not.toMatch(/Alec/);
    expect(OTHER_CAMPUSES["Craven Community College"].map((c) => [c.name, c.address, c.city, c.zip])).toEqual([["Havelock Campus", "305 Cunningham Blvd", "Havelock", "28532"]]);
    expect(geocodeOffline({ city: "Havelock", state: "NC" })).not.toBeNull();
    const roster = readFileSync(new URL("../prisma/seed-roster.ts", import.meta.url), "utf8");
    expect(roster).toMatch(/"Craven Community College": \{ "full-time": \{ contactHoursPerWeek: 40, workWeekHours: 40, hoursPerContactHour: 1 \}, "adjunct": \{ contactHoursPerWeek: 29, workWeekHours: 40, hoursPerContactHour: null \} \}/);
  });
  it("carries the five validated models, session for session, with no version tag", () => {
    expect(pack.map((t) => [t.name, t.programType, t.maxCohort, t.termWeeks, t.assumptions.facContactHours])).toEqual([
      ["Nurse Aide Level I — 16-week (DAY)", "Daytime", 16, 16, 29],
      ["Nurse Aide Level I — 16-week (NIGHT)", "Evening", 16, 16, 29],
      ["Nurse Aide Level I — 16-week (CCP)", "High school (CCP)", 10, 16, 40],
      ["Nurse Aide Level I — 13-week Summer (DAY)", "Summer daytime", 16, 13, 29],
      ["Nurse Aide Level I — 13-week Summer (NIGHT)", "Summer evening", 16, 13, 29],
    ]);
    for (const t of pack) { expect([t.version, t.credential, t.course.title]).toEqual(["Kim", "Certificate", "Nurse Aide Level I"]); expect(t.assumptions.facWorkWeekHours).toBe(40); }
    // Adult 16-week tracks: 25 class + 25 lab of 1.75 h, twelve 4-h site shifts (48 h), then the 1-h final exam (class, on campus) and 23 h of post-clinical skills lab = 159.5 h.
    for (const t of [day, night]) {
      expect([of(t, "CLASS").length, of(t, "LAB").length, of(t, "CLINICAL").length]).toEqual([26, 31, 12]);
      expect([hours(t, "CLASS"), hours(t, "LAB"), hours(t, "CLINICAL")]).toEqual([44.75, 66.75, 48]);
      expect(of(t, "CLINICAL").every((s) => s.lengthHours === 4 && s.maxStudents === 10 && s.facultyNeeded === 1 && s.location === "Clinical" && s.rotationType === "Long-Term Care" && s.clinicalMode === "Instructor-Led Clinical Group")).toBe(true);
      const exam = of(t, "CLASS").find((s) => s.title === "Final Exam" && s.lengthHours === 1)!;
      expect([exam.location, exam.facultyNeeded, exam.rotationType, exam.clinicalMode]).toEqual(["Classroom", 1, null, null]); expect(exam.notes).toMatch(/^In the college's clinical-hours bucket, held on campus/);
      const post = of(t, "LAB").filter((s) => /clinical-hours bucket/.test(s.notes ?? ""));
      expect([post.length, Math.round(post.reduce((n, s) => n + s.lengthHours, 0) * 100) / 100, post.every((s) => s.maxStudents === 16 && s.facultyNeeded === 2 && s.location === "Lab" && s.rotationType === null)]).toEqual([6, 23, true]);
      expect(Math.max(...t.sessions.map((s) => s.week ?? 0))).toBe(15); // ends week 15 of a 16-week name (weeks exclude holidays)
    }
    // Two instructors on the module days Katie named (day 3–5, 7–9, 12–14, 16, 18, 20–25), one otherwise.
    expect(of(day, "CLASS").filter((s) => s.lengthHours === 1.75).map((s) => s.facultyNeeded).join("")).toBe("1122212221122212121222222");
    expect([of(day, "CLASS")[0].startTime, of(day, "LAB")[0].startTime, of(day, "CLINICAL")[0].startTime, of(night, "CLASS")[0].startTime, of(night, "CLINICAL")[0].startTime]).toEqual(["08:30", "10:15", "08:30", "17:30", "17:30"]);
    expect(of(day, "CLINICAL").map((s) => s.week)).toEqual([9, 9, 10, 10, 10, 11, 11, 11, 12, 12, 12, 13]);
    // CCP: 40 site hours, 19.5 hours of weekly asynchronous online work with no weekday, one instructor at the 1.0 policy, 171 h in all.
    expect([of(ccp, "CLASS").length, of(ccp, "LAB").length, of(ccp, "CLINICAL").length]).toEqual([39, 31, 10]);
    expect([hours(ccp, "CLASS"), hours(ccp, "LAB"), hours(ccp, "CLINICAL")]).toEqual([64.25, 66.75, 40]);
    const online = of(ccp, "CLASS").filter((s) => /^Online module/.test(s.title ?? ""));
    expect([online.length, online.every((s) => s.dayOfWeek === null && s.startTime === null && s.lengthHours === 1.5 && s.facultyNeeded === 1 && s.facultyContactPolicy === 1 && /asynchronous/i.test(s.deliveryMode ?? "")), [...new Set(online.map((s) => s.week))].length]).toEqual([13, true, 13]);
    expect(online[0].notes).toMatch(/placeholder — asynchronous/);
    expect(of(ccp, "CLINICAL").every((s) => s.lengthHours === 4 && s.maxStudents === 10 && s.location === "Clinical")).toBe(true);
    expect([of(ccp, "CLASS").find((s) => s.lengthHours === 1.75)!.startTime, of(ccp, "CLINICAL")[0].startTime, of(ccp, "CLASS").find((s) => s.lengthHours === 1.75)!.location]).toEqual(["07:30", "07:30", "CCP/High School"]);
    // Summer: 22 class and lab days (4-hour days), nine 5-hour clinical days and a 3-hour one, the exam and skills labs; ends week 13.
    for (const t of [sumDay, sumNight]) {
      expect([of(t, "CLASS").length, of(t, "LAB").length, of(t, "CLINICAL").length]).toEqual([23, 27, 10]);
      expect([hours(t, "CLASS"), hours(t, "LAB"), hours(t, "CLINICAL")]).toEqual([44.75, 66.75, 48]);
      expect(of(t, "CLINICAL").map((s) => s.lengthHours).sort((a, b) => a - b)).toEqual([3, 5, 5, 5, 5, 5, 5, 5, 5, 5]);
      expect(Math.max(...t.sessions.map((s) => s.week ?? 0))).toBe(13);
    }
    expect([of(sumDay, "CLASS")[0].startTime, of(sumNight, "CLINICAL")[0].startTime]).toEqual(["08:30", "17:00"]);
  });
  it("has the college's 2026–27 calendar and the prospect sites within 45 minutes of New Bern", () => {
    expect(CALENDAR_FILES["Craven Community College"]).toBe("craven.txt");
    const { events, warnings } = parseAcademicCalendar(readFileSync(new URL("../prisma/seed-data/calendars/craven.txt", import.meta.url), "utf8"));
    expect(warnings).toEqual([]);
    expect(events.filter((e) => e.kind === "term_start").map((e) => e.iso)).toEqual(["2026-08-19", "2027-01-11", "2027-05-20"]);
    expect(anchorsFromEvents(events, { springStart: "01-08", summerStart: "05-28", fallStart: "08-15" })).toEqual({ springStart: "01-08", summerStart: "05-20", fallStart: "08-19" });
    const sites = PARTNER_SITES.filter((s) => s.institution === "Craven Community College");
    expect(sites.filter((s) => s.kind === "hospital").map((s) => s.name)).toEqual(["CarolinaEast Medical Center"]);
    expect(sites.filter((s) => s.city === "Havelock").map((s) => s.name)).toEqual(["Cherry Point Bay Nursing and Rehabilitation Center"]);
    expect(sites.every((s) => s.agreement === "prospect" && s.note?.includes("a prospect until it confirms"))).toBe(true);
  });
});
