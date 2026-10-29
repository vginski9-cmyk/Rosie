import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { INSTITUTIONS, PAUSED_INSTITUTIONS } from "../prisma/seed-institutions";
import { parseAcademicCalendar, anchorsFromEvents } from "../src/lib/academiccalendar";
import { CALENDAR_FILES } from "../prisma/seed-calendars";
import { OTHER_CAMPUSES } from "../prisma/seed-campuses";
import { PARTNER_SITES } from "../prisma/seed-partner-sites";
import { geocodeOffline } from "../src/lib/geo";

// Craven Community College's Nurse Aide Level I from the combined program-structure workbook (received 2026-10-29): the
// college's reading ("Alec & Katie's Version") and the contractor's ("Kim") as seven 16-week delivery models side by side,
// rebuilt by scripts/import-cna-pack.mjs into prisma/templates/cna-craven.json.

type Session = { kind: string; week: number | null; dayOfWeek: string | null; startTime?: string | null; lengthHours: number; maxStudents: number; facultyNeeded: number; location: string | null; rotationType: string | null; clinicalMode: string | null; notes: string | null };
type Pack = { name: string; label: string; version?: string; programType: string; credential: string; termWeeks: number; maxCohort: number; assumptions: { facContactHours: number; facWorkWeekHours: number; facTermWeeks: number }; course: { code: string; title: string; weeklyClassHours: number; weeklyLabHours: number; weeklyClinicalHours: number }; sessions: Session[] }[];
const pack = JSON.parse(readFileSync(new URL("../prisma/templates/cna-craven.json", import.meta.url), "utf8")) as Pack;
const hours = (t: Pack[number], kind: string) => Math.round(t.sessions.filter((s) => s.kind === kind).reduce((n, s) => n + s.lengthHours, 0) * 100) / 100;
const count = (t: Pack[number], kind: string) => t.sessions.filter((s) => s.kind === kind).length;

describe("Craven Community College", () => {
  it("is seeded with one Nurse Aide family carrying the whole combined-workbook pack, two campuses and a 45-minute core band", () => {
    expect(PAUSED_INSTITUTIONS.has("Craven Community College")).toBe(false);
    const inst = INSTITUTIONS.find((i) => i.name === "Craven Community College")!;
    expect([inst.city, inst.rings]).toEqual(["New Bern", { core: 45, one: 60, two: 90 }]);
    expect(inst.families).toHaveLength(1);
    expect([inst.families[0].name, inst.families[0].cna, inst.families[0].cnaAll, inst.families[0].programs]).toEqual(["Nurse Aide (CNA)", true, "craven", []]);
    expect(inst.families[0].description).toMatch(/two readings kept side by side/);
    expect(OTHER_CAMPUSES["Craven Community College"].map((c) => [c.name, c.address, c.city, c.zip])).toEqual([["Havelock Campus", "305 Cunningham Blvd", "Havelock", "28532"]]);
    expect(geocodeOffline({ city: "Havelock", state: "NC" })).not.toBeNull();
  });
  it("carries both readings' seven 16-week models, session for session, named by version", () => {
    expect(pack.map((t) => [t.label, t.version, t.programType, t.maxCohort])).toEqual([
      ["16-week day (CCP)", "Alec & Katie's Version", "High school (CCP)", 10],
      ["16-week day (16 seat non CCP)", "Alec & Katie's Version", "Daytime", 16],
      ["16-week day (22 seat non CCP)", "Alec & Katie's Version", "Daytime", 22],
      ["16-week (NIGHT)", "Alec & Katie's Version", "Evening", 10],
      ["16-week (DAY)", "Kim", "Daytime", 22],
      ["16-week (NIGHT)", "Kim", "Evening", 16],
      ["16-week (CCP)", "Kim", "High school (CCP)", 10],
    ]);
    expect(pack.map((t) => t.name)).toEqual([
      "Nurse Aide Level I — 16-week day (CCP) · Alec & Katie's version", "Nurse Aide Level I — 16-week day (16 seat non CCP) · Alec & Katie's version", "Nurse Aide Level I — 16-week day (22 seat non CCP) · Alec & Katie's version", "Nurse Aide Level I — 16-week (NIGHT) · Alec & Katie's version",
      "Nurse Aide Level I — 16-week (DAY) · Kim's version", "Nurse Aide Level I — 16-week (NIGHT) · Kim's version", "Nurse Aide Level I — 16-week (CCP) · Kim's version",
    ]);
    for (const t of pack) { expect([t.termWeeks, t.credential, t.course.title]).toEqual([16, "Certificate", "Nurse Aide Level I"]); expect(t.assumptions).toMatchObject({ facContactHours: 29, facWorkWeekHours: 40, facTermWeeks: 16 }); }
    // The college's reading: 17 of 44 class sessions and 17 of 25 labs (13–20 missing), 12 clinical shifts.
    for (const t of pack.slice(0, 4)) expect([count(t, "CLASS"), count(t, "LAB"), count(t, "CLINICAL")]).toEqual([17, 17, 12]);
    expect(pack.slice(0, 3).map((t) => [hours(t, "CLASS"), hours(t, "LAB"), hours(t, "CLINICAL")])).toEqual([[30.6, 28.9, 48], [30.6, 28.9, 48], [30.6, 28.9, 48]]);
    expect([hours(pack[3], "CLASS"), hours(pack[3], "LAB"), hours(pack[3], "CLINICAL")]).toEqual([30.6, 59.3, 43.2]); // the night lab runs 1.7 h then 3.6 h; 3.6-h shifts
    // The contractor's reading: 25 + 25 sessions of 1.75 h and 20 shifts of 3.6 h = 159.5 h, the college's stated total.
    for (const t of pack.slice(4)) { expect([count(t, "CLASS"), count(t, "LAB"), count(t, "CLINICAL")]).toEqual([25, 25, 20]); expect(Math.round((hours(t, "CLASS") + hours(t, "LAB") + hours(t, "CLINICAL")) * 10) / 10).toBeCloseTo(159.5, 0); expect(hours(t, "CLINICAL")).toBe(72); }
    // Two faculty on the larger day classes, one otherwise; clinical groups of ten, instructor-led, long-term care; times read from the notes.
    expect(pack.map((t) => t.sessions.find((s) => s.kind === "CLASS")!.facultyNeeded)).toEqual([1, 2, 2, 1, 2, 1, 1]);
    for (const t of pack) for (const s of t.sessions.filter((s) => s.kind === "CLINICAL")) expect([s.maxStudents, s.facultyNeeded, s.rotationType, s.clinicalMode]).toEqual([10, 1, "Long-Term Care", "Instructor-Led Clinical Group"]);
    expect(pack[4].sessions.find((s) => s.kind === "CLASS")!.startTime).toBe("08:30");
    expect(pack[5].sessions.find((s) => s.kind === "CLINICAL")!.startTime).toBe("17:30");
    expect(pack[6].sessions.find((s) => s.kind === "CLASS")!.location).toBe("CCP/High School");
    expect([pack[4].sessions.filter((s) => s.kind === "CLINICAL").map((s) => s.week!), pack[6].sessions.filter((s) => s.kind === "CLASS").map((s) => s.week!)].map((w) => [Math.min(...w), Math.max(...w)])).toEqual([[9, 16], [1, 7]]);
    expect(pack[5].sessions.find((s) => s.kind === "LAB")!.maxStudents).toBe(10); // the contractor's night lab cap against a class of 16 — to confirm
  });
  it("has the college's 2026–27 calendar and the prospect sites within 45 minutes of New Bern", () => {
    expect(CALENDAR_FILES["Craven Community College"]).toBe("craven.txt");
    const { events, warnings } = parseAcademicCalendar(readFileSync(new URL("../prisma/seed-data/calendars/craven.txt", import.meta.url), "utf8"));
    expect(warnings).toEqual([]);
    expect(events.filter((e) => e.kind === "term_start").map((e) => e.iso)).toEqual(["2026-08-19", "2027-01-11", "2027-05-20"]);
    expect(events.filter((e) => e.kind === "term_end").map((e) => e.iso)).toEqual(["2026-12-16", "2027-05-11", "2027-08-02"]);
    expect(anchorsFromEvents(events, { springStart: "01-08", summerStart: "05-28", fallStart: "08-15" })).toEqual({ springStart: "01-08", summerStart: "05-20", fallStart: "08-19" });
    const sites = PARTNER_SITES.filter((s) => s.institution === "Craven Community College");
    expect(sites.map((s) => s.kind).filter((k) => k === "hospital")).toEqual(["hospital"]);
    expect(sites.find((s) => s.id === "CRV-H01")!.name).toBe("CarolinaEast Medical Center");
    expect(sites.filter((s) => s.city === "Havelock").map((s) => s.name)).toEqual(["Cherry Point Bay Nursing and Rehabilitation Center"]);
    expect(sites.every((s) => s.agreement === "prospect" && s.note?.includes("a prospect until it confirms"))).toBe(true);
  });
});
