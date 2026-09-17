import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { LENOIR_COHORTS, parseDays, parseTime, parseLocation, parseModel, modelFor, cohortWeeks, isEvening, slotOf, projectLenoirCohorts } from "../prisma/seed-lenoir";

describe("scheduling Lenoir's cohorts ahead", () => {
  it("names a slot by room, class days and time of day", () => {
    expect(slotOf({ days: "Mon, Wed", time: "8:00am-2:30pm", location: "Main Campus, Bullock Bldg, Rm 175" })).toBe("Bullock 175 · Mon & Wed · daytime");
    expect(slotOf({ days: "Mon, Sat", time: "6:00pm-10:00pm", location: "Jones County Center" })).toBe("Jones County Center classroom · Mon & Wed · evening");
    expect(slotOf({ days: "Tue, Wed, Thur", time: "12:05pm-2:50pm", location: "Kinston High School, Lancer Academy" })).toBe("Lancer Academy classroom · Tue & Thu · daytime");
  });
  it("carries back-to-back slots on from their last run and yearly slots a year on, only after today", () => {
    const rows = projectLenoirCohorts(LENOIR_COHORTS, { from: "2026-09-17", through: "2027-12-31", holidays: { "2027-01-18": "MLK Day" } });
    for (const r of rows) { expect(r.start > "2026-09-17").toBe(true); expect(r.start <= "2027-12-31").toBe(true); expect(r.end > r.start).toBe(true); }
    // Bullock 175 mornings ran five times back to back, a week or two apart, last ending Aug 19, 2026:
    // the run that would have started right after is under way by now, the next begins Jan 2027, on a Monday.
    const b175 = rows.filter((r) => r.slot === "Bullock 175 · Mon & Wed · daytime");
    expect(b175.map((r) => r.start)).toEqual(["2027-01-25", "2027-06-21", "2027-11-15"]);
    expect(b175[0].basis).toBe("5 runs back to back, about 1 week apart");
    expect(b175[0]).toMatchObject({ days: "Mon, Wed", time: "8:00am-2:30pm", location: "Main Campus, Bullock Bldg, Rm 175", cohort: "Planned Jan 2027 · Bullock 175 · Mon & Wed · daytime" });
    // Lancer Academy runs each fall: the next is a year after Aug 24, 2026, on a Tuesday.
    const lancer = rows.filter((r) => r.slot.startsWith("Lancer Academy"));
    expect(lancer.map((r) => [r.start, r.basis])).toEqual([["2027-08-24", "2 runs about a year apart"]]);
    // No projected run overlaps a real one in its slot, and none starts on a holiday.
    for (const r of rows) {
      const real = LENOIR_COHORTS.filter((x) => slotOf(x) === r.slot);
      expect(real.some((x) => r.start <= x.end && r.end >= x.start), `${r.cohort} overlaps a real run`).toBe(false);
      expect(r.start).not.toBe("2027-01-18");
      expect(parseDays(r.days)[0]).toBe(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(r.start + "T00:00:00Z").getUTCDay()]);
    }
    // About as many runs a year as the college has been running (24–25).
    expect(rows.filter((r) => r.start.startsWith("2027")).length).toBeGreaterThanOrEqual(22);
    expect(rows.filter((r) => r.start.startsWith("2027")).length).toBeLessThanOrEqual(28);
  });
});

type Pack = { name: string; programType: string; termWeeks: number; maxCohort: number; course: { code: string; title: string }; sessions: { kind: string; week: number | null; dayOfWeek: string | null; lengthHours: number; maxStudents: number; rotationType: string | null; clinicalMode: string | null }[] }[];
const pack = JSON.parse(readFileSync(new URL("../prisma/templates/cna-lenoir.json", import.meta.url), "utf8")) as Pack;

describe("Lenoir's Nurse Aide Level I workbook pack", () => {
  it("carries the workbook's six delivery models, session for session", () => {
    expect(pack.map((t) => t.name.replace("Nurse Aide Level I — ", ""))).toEqual([
      "Monday & Wednesday 20-week Offering", "Tuesday & Thursday 20-week Offering",
      "Monday & Wednesday 18-week Offering", "Tuesday & Thursday 18-week Offering",
      "Tuesday & Thursday 16-week Offering", "Monday & Wednesday 16-week Offering",
    ]);
    for (const t of pack) {
      expect(t.course.code).toBe("NAS 3240 (continuing ed)");
      expect(t.course.title).toBe("Nurse Aide Level I");
      expect(t.maxCohort).toBe(10);
      const days = t.name.includes("Monday") ? ["Mon", "Wed"] : ["Tue", "Thu"];
      for (const s of t.sessions) expect(days, `${t.name}: ${s.kind} ${s.dayOfWeek}`).toContain(s.dayOfWeek);
      const clinical = t.sessions.filter((s) => s.kind === "CLINICAL");
      expect(clinical.every((s) => s.maxStudents === 10 && s.clinicalMode === "Instructor-Led Clinical Group")).toBe(true);
      expect(new Set(clinical.map((s) => s.rotationType))).toEqual(new Set(["Medical-Surgical", "Long-Term Care"]));
      expect(t.sessions.filter((s) => s.kind !== "CLINICAL").every((s) => s.maxStudents === 14)).toBe(true);
    }
    const by = (label: string) => pack.find((t) => t.name.includes(label))!;
    // 20-week evening: 24 class + 24 lab sessions in weeks 1–13, ten 4-hour clinicals in weeks 11–20.
    expect(by("Wednesday 20-week").programType).toBe("Evening");
    expect(by("Wednesday 20-week").sessions.filter((s) => s.kind === "CLINICAL").map((s) => [s.week, s.lengthHours])).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((w) => [w, 4]));
    expect(by("Wednesday 20-week").sessions.filter((s) => s.kind === "CLASS")).toHaveLength(24);
    // 18-week daytime: seven 6-hour clinicals in weeks 11–17; the term keeps the offering's 18 weeks.
    expect(by("Thursday 18-week").programType).toBe("Daytime");
    expect(by("Thursday 18-week").termWeeks).toBe(18);
    expect(by("Thursday 18-week").sessions.filter((s) => s.kind === "CLINICAL").map((s) => [s.week, s.lengthHours])).toEqual([11, 12, 13, 14, 15, 16, 17].map((w) => [w, 6]));
    // 16-week daytime: seven 6-hour clinicals in weeks 10–16.
    expect(by("Thursday 16-week").termWeeks).toBe(16);
    expect(by("Thursday 16-week").sessions.filter((s) => s.kind === "CLINICAL").map((s) => s.week)).toEqual([10, 11, 12, 13, 14, 15, 16]);
  });
  it("puts each cohort on the model its days, length and time of day match", () => {
    const models = pack.map((t) => parseModel(t.name, t.programType)!);
    expect(models[0]).toEqual({ name: pack[0].name, days: ["Mon", "Wed"], weeks: 20, evening: true });
    expect(models[3]).toMatchObject({ days: ["Tue", "Thu"], weeks: 18, evening: false });
    const pick = (cohort: string) => modelFor(LENOIR_COHORTS.find((r) => r.cohort.startsWith(cohort + " "))!, models).name.replace("Nurse Aide Level I — ", "");
    expect(pick("Cohort 1")).toBe("Monday & Wednesday 20-week Offering");   // Mon/Wed 5:30–9:30p, 20.4 weeks
    expect(pick("Cohort 8")).toBe("Monday & Wednesday 18-week Offering");   // Mon/Wed 8a–2:30p, 18.4 weeks
    expect(pick("Cohort 9")).toBe("Monday & Wednesday 20-week Offering");   // Mon/Wed evening, 18.4 weeks → the evening model
    expect(pick("Cohort 10")).toBe("Tuesday & Thursday 18-week Offering");  // Tue/Thu 8a–2:30p, 17.4 weeks
    expect(pick("Cohort 11")).toBe("Tuesday & Thursday 16-week Offering");  // Tue/Wed/Thu at Lancer Academy, 16.6 weeks
    expect(pick("Cohort 2")).toBe("Monday & Wednesday 20-week Offering");   // Mon/Sat evening → Monday & Wednesday
    expect(pick("Cohort 25")).toBe("Tuesday & Thursday 16-week Offering");  // Tue/Thu evening, 15.4 weeks
    expect(cohortWeeks({ start: "2025-10-27", end: "2026-03-18" })).toBeCloseTo(20.43, 2);
    expect(isEvening("5:30pm-9:30pm")).toBe(true);
    expect(isEvening("12:05pm-2:50pm")).toBe(false);
    // Every cohort lands on a model that shares a class day with it.
    for (const r of LENOIR_COHORTS) expect(modelFor(r, models).days.some((d) => parseDays(r.days).includes(d)), r.cohort).toBe(true);
  });
});

describe("Lenoir's Nurse Aide I cohort sheet", () => {
  it("holds all 38 cohorts, each ending after it starts, on the days it meets", () => {
    expect(LENOIR_COHORTS).toHaveLength(38);
    const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    for (const r of LENOIR_COHORTS) expect(r.end > r.start, `${r.cohort} ends before it starts`).toBe(true);
    // The two corrected rows were moved to a date the cohort actually meets on.
    const fixed = LENOIR_COHORTS.filter((r) => r.given);
    expect(fixed.map((r) => r.cohort)).toEqual(["Cohort 6 - 78901", "Cohort 26 - 76811"]);
    for (const r of fixed) expect(parseDays(r.days)).toContain(DOW[new Date(r.start + "T00:00:00Z").getUTCDay()]);
  });
  it("reads the sheet's days, times and places", () => {
    expect(parseDays("Tue, Thur, Fri")).toEqual(["Tue", "Thu", "Fri"]);
    expect(parseDays("Mon, Sat")).toEqual(["Mon", "Sat"]);
    expect(parseTime("5:30pm-9:30pm")).toEqual({ start: "17:30", end: "21:30", hours: 4 });
    expect(parseTime("08:00am-2:30pm")).toEqual({ start: "08:00", end: "14:30", hours: 6.5 });
    expect(parseTime("12:05pm-2:50pm")).toEqual({ start: "12:05", end: "14:50", hours: 2.75 });
    expect(parseLocation("Main Campus, Bullock Bldg, Rm 173")).toMatchObject({ campus: "Main Campus", building: "Bullock Building", room: "Bullock 173", roomNumber: "173" });
    expect(parseLocation("Main Campus, Bullokck, Rm 177").room).toBe("Bullock 177");
    expect(parseLocation("Lagrange Center")).toMatchObject({ campus: "La Grange Center", city: "La Grange" });
    expect(parseLocation("Kinston High School, Lancer Academy").building).toBe("Kinston High School — Lancer Academy");
    // every row parses
    for (const r of LENOIR_COHORTS) { expect(parseDays(r.days).length).toBeGreaterThan(0); expect(parseTime(r.time).hours).toBeGreaterThan(0); }
  });
});
