import { describe, it, expect } from "vitest";
import { clinicalProfile, courseProfiles, settingMatrix, shiftOf, clinicalStatement, sessionsOf, NOT_SET, type AnalyticsCourse } from "../src/lib/clinicalanalytics";

const s = (o: Partial<AnalyticsCourse["sessions"][number]> & { id: string }) => ({ kind: "CLINICAL", lengthHours: 8, maxStudents: 1, preceptorsNeeded: 1, facultyNeeded: 0.1, ...o });

const courses: AnalyticsCourse[] = [
  { id: "c1", code: "RAD-151", name: "Clinical Ed I", termName: "First Fall", termIndex: 1, weeks: 16, sessions: [
    s({ id: "a", rotationType: "General Radiography", clinicalMode: "Preceptor-led", startTime: "07:00", dayOfWeek: "Mon", week: 1 }),
    s({ id: "b", rotationType: "General Radiography", clinicalMode: "Preceptor-led", startTime: "15:00", dayOfWeek: "Tue", week: 2 }),
    s({ id: "c", rotationType: "Fluoroscopy / GI", clinicalMode: "Instructor-led", startTime: "23:00", dayOfWeek: "Mon", week: 3, lengthHours: 12 }),
    s({ id: "d", kind: "CLASS", lengthHours: 3, maxStudents: 30, preceptorsNeeded: 0, deliveryMode: "In-person", week: 1 }),
  ] },
  { id: "c2", code: "RAD-110", name: "Intro", termName: "First Fall", termIndex: 1, weeks: 16, sessions: [
    s({ id: "e", kind: "CLASS", lengthHours: 2, maxStudents: 30, preceptorsNeeded: 0, deliveryMode: "Online — asynchronous", week: 1 }),
  ] },
  { id: "c3", code: "RAD-161", name: "Clinical Ed II", termName: "First Spring", termIndex: 2, weeks: 16, sessions: [
    s({ id: "f", rotationType: "General Radiography", clinicalMode: "Preceptor-led", startTime: null, dayOfWeek: null, week: 1, maxStudents: 2 }),
  ] },
];

describe("shiftOf", () => {
  it("buckets start times the same way the supply side does", () => {
    expect(shiftOf("07:00")).toBe("Day"); expect(shiftOf("14:59")).toBe("Day");
    expect(shiftOf("15:00")).toBe("Evening"); expect(shiftOf("22:30")).toBe("Evening");
    expect(shiftOf("23:00")).toBe("Night"); expect(shiftOf("03:00")).toBe("Night");
    expect(shiftOf(null)).toBeNull(); expect(shiftOf("")).toBeNull();
  });
});

describe("clinicalProfile", () => {
  const p = clinicalProfile(sessionsOf(courses), 40);
  it("totals clinical hours per student and their share of all hours", () => {
    expect(p.clinicalHours).toBe(8 + 8 + 12 + 8);
    expect(p.totalHours).toBe(36 + 3 + 2);
    expect(p.clinicalShare).toBeCloseTo(36 / 41);
    expect(p.clinicalSessions).toBe(4);
  });
  it("breaks hours down by setting, mode, shift and day, sorted by hours", () => {
    expect(p.settings.map((x) => [x.key, x.hours])).toEqual([["General Radiography", 24], ["Fluoroscopy / GI", 12]]);
    expect(p.settings[0].share).toBeCloseTo(24 / 36);
    expect(p.modes.map((x) => x.key)).toEqual(["Preceptor-led", "Instructor-led"]);
    expect(p.shifts.map((x) => [x.key, x.hours])).toEqual([["Day", 8], ["Evening", 8], ["Night", 12], [NOT_SET, 8]]);
    expect(p.shifts[0].starts).toEqual(["07:00"]);
    expect(p.days.map((x) => [x.key, x.sessions])).toEqual([["Mon", 2], ["Tue", 1], [NOT_SET, 1]]);
    expect(p.unscheduled).toBe(1);
  });
  it("scales to enrollment: sections, student-hours and preceptor-shifts", () => {
    // 1:1 sessions → 40 sections each; the 2-student one → 20 sections
    expect(p.sectionsAtEnrollment).toBe(40 + 40 + 40 + 20);
    expect(p.preceptorShiftsAtEnrollment).toBe(140);
    expect(p.studentHoursAtEnrollment).toBe(36 * 40);
  });
  it("reports shift length range and the peak program week", () => {
    expect(p.avgShiftHours).toBe(9); expect(p.longestShiftHours).toBe(12); expect(p.shortestShiftHours).toBe(8);
    // weeks restart each term: First Fall wk 1 = 8h (c1 only); c3's wk 1 is in First Spring
    expect(p.peakWeek).toBe("First Fall wk 3"); expect(p.peakWeekHours).toBe(12);
    expect(p.weeksWithClinical).toBe(4);
  });
  it("uses delivery mode across every kind of session", () => {
    expect(p.delivery.find((d) => d.key === "Online — asynchronous")?.hours).toBe(2);
    expect(p.delivery.find((d) => d.key === "In-person")?.hours).toBe(3);
  });
  it("writes a readable statement", () => {
    const t = clinicalStatement(p, "Radiography (template)");
    expect(t).toContain("36 clinical hours");
    expect(t).toContain("General Radiography 24h");
    expect(t).toContain("At 40 students");
    expect(t).toContain("no start time yet");
    expect(clinicalStatement(clinicalProfile([], 10), "X")).toContain("no clinical sessions");
  });
});

describe("courseProfiles and settingMatrix", () => {
  it("gives each course its own profile with hours per week", () => {
    const cp = courseProfiles(courses, 10);
    expect(cp.find((c) => c.courseId === "c1")?.clinicalHours).toBe(28);
    expect(cp.find((c) => c.courseId === "c1")?.hoursPerWeek).toBeCloseTo(28 / 16);
    expect(cp.find((c) => c.courseId === "c2")?.clinicalSessions).toBe(0);
  });
  it("builds the course × setting hours matrix with only clinical courses", () => {
    const m = settingMatrix(courses);
    expect(m.settings).toEqual(["General Radiography", "Fluoroscopy / GI"]);
    expect(m.rows.map((r) => r.courseId)).toEqual(["c1", "c3"]);
    expect(m.rows[0].hours).toEqual({ "General Radiography": 16, "Fluoroscopy / GI": 12 });
    expect(m.totals["General Radiography"]).toBe(24);
  });
});
