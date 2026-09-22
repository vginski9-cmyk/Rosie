import { describe, expect, it } from "vitest";
import { reviseSurgTech, type RevSession, type RevTerm } from "../src/lib/surgtechrevision";

// The workbook's Surgical Technology pattern, reduced to the rows the revision touches (prisma/templates/surgtech.json).
const base: Partial<RevSession> = { title: null, maxStudents: 20, facultyNeeded: 1, supportStaffNeeded: 0, preceptorsNeeded: 0, sectionTimes: null, rotationType: null, experiences: null, progression: null, clinicalMode: null, notes: null, homework: null, facultyContactPolicy: null, supportContactPolicy: null, preceptorContactPolicy: null };
const s = (o: Partial<RevSession> & { kind: string; number: number; lengthHours: number; week: number }): RevSession => ({ ...base, deliveryMode: "In-person", location: "Kennedy Hall 148", dayOfWeek: null, startTime: null, endTime: null, ...o } as RevSession);
const weeks = (n: number, mk: (w: number, i: number) => RevSession[]) => Array.from({ length: n }, (_, i) => mk(i + 1, i)).flat();
const clin = (o: Partial<RevSession>): Partial<RevSession> => ({ deliveryMode: "In-person", location: "Clinical site", maxStudents: 1, facultyNeeded: 0.0526, preceptorsNeeded: 1, clinicalMode: "Precepted Experience", rotationType: "Operating Room", ...o });
const template = (): RevTerm[] => [
  { index: 1, startWeek: 1, endWeek: 16, courses: [{ code: "SUR 111", weeklyClassHours: 5, weeklyLabHours: 6, weeklyClinicalHours: 0, sessions: weeks(16, (w) => [
    s({ kind: "CLASS", number: w * 2 - 1, week: w, dayOfWeek: "Mon", startTime: "08:30", endTime: "09:20", lengthHours: 0.83, title: `Module ${w}` }),
    s({ kind: "CLASS", number: w * 2, week: w, lengthHours: 4.17, deliveryMode: "Online", location: "Internet" }),
    s({ kind: "LAB", number: w, week: w, dayOfWeek: "Thu", startTime: "08:30", endTime: "15:00", lengthHours: 6, deliveryMode: "Online", location: "Internet", facultyNeeded: 2, title: `Lab ${w}` }),
  ]) }] },
  { index: 2, startWeek: 17, endWeek: 32, courses: [
    { code: "SUR 122", weeklyClassHours: 5, weeklyLabHours: 3, weeklyClinicalHours: 0, sessions: weeks(16, (w) => [
      s({ kind: "CLASS", number: w * 2 - 1, week: w, dayOfWeek: "Thu", startTime: "08:30", endTime: "11:00", lengthHours: 2.5 }),
      s({ kind: "CLASS", number: w * 2, week: w, startTime: "08:30", endTime: "11:00", lengthHours: 2.5, deliveryMode: "Online", location: "Internet" }),
      s({ kind: "LAB", number: w * 2 - 1, week: w, dayOfWeek: "Thu", startTime: "12:00", endTime: "14:00", lengthHours: 1.5, location: "Kennedy Hall Lab 129", facultyNeeded: 2 }),
      s({ kind: "LAB", number: w * 2, week: w, startTime: "12:00", endTime: "14:00", lengthHours: 1.5, deliveryMode: "Online", location: "Internet", facultyNeeded: 2 }),
    ]) },
    { code: "SUR 123", weeklyClassHours: 0, weeklyLabHours: 0, weeklyClinicalHours: 21, sessions: weeks(16, (w) => [
      s({ ...clin({}), kind: "CLINICAL", number: w * 3 - 2, week: w, dayOfWeek: "Mon", startTime: "08:30", endTime: "15:00", lengthHours: 6.5 }),
      s({ ...clin({ rotationType: w === 1 ? "Doctor's Office" : "Operating Room" }), kind: "CLINICAL", number: w * 3 - 1, week: w, dayOfWeek: "Tue", startTime: "08:30", endTime: "15:00", lengthHours: 6.5 }),
      s({ ...clin({}), kind: "CLINICAL", number: w * 3, week: w, dayOfWeek: "Fri", startTime: "06:30", endTime: "12:30", lengthHours: 6 }),
      s({ kind: "CLASS", number: w, week: w, lengthHours: 2, deliveryMode: "Online", location: "Internet", maxStudents: 1 }),
    ]) },
  ] },
  { index: 3, startWeek: 33, endWeek: 42, courses: [
    { code: "SUR 134", weeklyClassHours: 8, weeklyLabHours: 0, weeklyClinicalHours: 0, sessions: weeks(10, (w) => [
      s({ kind: "CLASS", number: w * 2 - 1, week: w, dayOfWeek: "Thu", startTime: "08:30", endTime: "11:00", lengthHours: 3, title: `Procedures ${w}` }),
      s({ kind: "CLASS", number: w * 2, week: w, lengthHours: 5, deliveryMode: "Online", location: "Internet" }),
    ]) },
    { code: "SUR 135", weeklyClassHours: 0, weeklyLabHours: 0, weeklyClinicalHours: 20, sessions: weeks(10, (w) => [
      s({ ...clin({ rotationType: "Other (surgical rotations)" }), kind: "CLINICAL", number: w * 3 - 2, week: w, dayOfWeek: "Mon", startTime: "06:30", endTime: "15:30", lengthHours: 7.5 }),
      s({ ...clin({ rotationType: "Other (surgical rotations)" }), kind: "CLINICAL", number: w * 3 - 1, week: w, dayOfWeek: "Tue", startTime: "06:30", endTime: "15:30", lengthHours: 7.5 }),
      s({ ...clin({ rotationType: "Other (surgical rotations)" }), kind: "CLINICAL", number: w * 3, week: w, dayOfWeek: "Fri", startTime: "06:30", endTime: "12:30", lengthHours: 5 }),
    ]) },
  ] },
  { index: 4, startWeek: 43, endWeek: 58, courses: [{ code: "SUR 211", weeklyClassHours: 2, weeklyLabHours: 0, weeklyClinicalHours: 0, sessions: weeks(16, (w) => [s({ kind: "CLASS", number: w, week: w, lengthHours: 2, deliveryMode: "Online", location: "Internet" })]) }] },
  { index: 5, startWeek: 59, endWeek: 74, courses: [
    { code: "SUR 137", weeklyClassHours: 1, weeklyLabHours: 0, weeklyClinicalHours: 0, sessions: weeks(16, (w) => [s({ kind: "CLASS", number: w, week: w, lengthHours: 1, deliveryMode: "Online", location: "Internet" })]) },
    { code: "SUR 210", weeklyClassHours: 0, weeklyLabHours: 0, weeklyClinicalHours: 6, sessions: weeks(16, (w) => [s({ ...clin({ rotationType: "Operating Room or Doctor's Office", clinicalMode: "Capstone / Preceptorship", facultyNeeded: w % 2 ? 0.03125 : 0 }), kind: "CLINICAL", number: w, week: w, dayOfWeek: w % 2 ? "Wed" : "Thu", startTime: "06:30", endTime: "15:00", lengthHours: 6 })]) },
  ] },
];
const course = (r: ReturnType<typeof reviseSurgTech>, code: string) => r.terms.flatMap((t) => t.courses.map((c) => ({ ...c, term: t.index }))).find((c) => c.code === code)!;
const online = (x: RevSession) => /online|internet/i.test(x.deliveryMode ?? "") || /^internet$/i.test(x.location ?? "");

describe("Surgical Technology (revised) — the program's meeting pattern applied to the workbook template", () => {
  const r = reviseSurgTech(template());
  it("SUR 111: Thursday 8:30–3:00 meets in person every week, classroom then lab, beside the Monday meeting; nothing is invented for a Tuesday", () => {
    const c = course(r, "SUR 111");
    const thu = c.sessions.filter((x) => x.dayOfWeek === "Thu");
    expect(thu).toHaveLength(32); expect(thu.every((x) => x.kind === "LAB" && x.deliveryMode === "In-person")).toBe(true);
    expect(thu.filter((x) => x.startTime === "08:30" && x.endTime === "11:30" && x.lengthHours === 3 && x.location === "Kennedy Hall 148")).toHaveLength(16);
    expect(thu.filter((x) => x.startTime === "12:00" && x.endTime === "15:00" && x.lengthHours === 3 && x.location === "Kennedy Hall Lab 129")).toHaveLength(16);
    expect(c.sessions.filter((x) => x.dayOfWeek === "Mon")).toHaveLength(16); expect(c.sessions.some((x) => x.dayOfWeek === "Tue")).toBe(false);
    expect(c.sessions.filter((x) => x.kind === "LAB").map((x) => x.number)).toEqual(Array.from({ length: 32 }, (_, i) => i + 1)); // renumbered
    expect(c.weeklyLabHours).toBe(6); expect(c.weeklyClassHours).toBe(5);
    expect(c.sessions.filter((x) => x.kind === "LAB" && x.week === 1).reduce((n, x) => n + x.lengthHours, 0)).toBe(6);
  });
  it("SUR 122: every Thursday 8:30–11:00 class and 12:00–3:00 lab in person; the workbook's duplicate online lab rows are gone", () => {
    const c = course(r, "SUR 122");
    expect(c.sessions.filter((x) => x.kind === "LAB")).toHaveLength(16);
    expect(c.sessions.filter((x) => x.kind === "LAB").every((x) => x.dayOfWeek === "Thu" && x.startTime === "12:00" && x.endTime === "15:00" && x.lengthHours === 3 && !online(x))).toBe(true);
    expect(c.sessions.filter((x) => x.kind === "CLASS" && x.dayOfWeek === "Thu").every((x) => x.startTime === "08:30" && x.endTime === "11:00" && x.lengthHours === 2.5)).toBe(true);
    expect(c.sessions.filter((x) => x.kind === "CLASS" && online(x))).toHaveLength(16); // the catalog's other 2.5 class hours a week stay online
    expect(c.weeklyLabHours).toBe(3);
  });
  it("SUR 123 and SUR 135: clinicals Monday and Tuesday 6:30–3:00, Friday 6:30–12:30, 1:1 with a preceptor; the weekly clinical hours follow", () => {
    for (const code of ["SUR 123", "SUR 135"]) {
      const c = course(r, code);
      const clinical = c.sessions.filter((x) => x.kind === "CLINICAL");
      expect(clinical.filter((x) => (x.dayOfWeek === "Mon" || x.dayOfWeek === "Tue") && x.startTime === "06:30" && x.endTime === "15:00" && x.lengthHours === 8.5)).toHaveLength(code === "SUR 123" ? 32 : 20);
      expect(clinical.filter((x) => x.dayOfWeek === "Fri" && x.startTime === "06:30" && x.endTime === "12:30" && x.lengthHours === 6)).toHaveLength(code === "SUR 123" ? 16 : 10);
      expect(clinical.every((x) => x.maxStudents === 1 && x.preceptorsNeeded === 1)).toBe(true);
      expect(c.weeklyClinicalHours).toBe(23);
    }
    expect(course(r, "SUR 123").sessions.find((x) => x.week === 1 && x.dayOfWeek === "Tue")!.rotationType).toBe("Doctor's Office"); // the first Tuesday's office day is kept
  });
  it("SUR 134: Thursday 8:30–11:00 and 12:00–3:00 in the classroom; the online share is what is left of 8 class hours a week", () => {
    const c = course(r, "SUR 134");
    expect(c.sessions.filter((x) => x.dayOfWeek === "Thu" && x.startTime === "08:30" && x.endTime === "11:00" && x.lengthHours === 2.5)).toHaveLength(10);
    expect(c.sessions.filter((x) => x.dayOfWeek === "Thu" && x.startTime === "12:00" && x.endTime === "15:00" && x.lengthHours === 3 && x.location === "Kennedy Hall 148")).toHaveLength(10);
    expect(c.sessions.filter(online).every((x) => x.lengthHours === 2.5)).toBe(true);
    expect(c.sessions.filter((x) => x.week === 1).reduce((n, x) => n + x.lengthHours, 0)).toBe(8);
  });
  it("SUR 210: in Term 4, clinicals every Wednesday and Thursday 6:30–3:00; Term 5 keeps SUR 137", () => {
    const c = course(r, "SUR 210");
    expect(c.term).toBe(4); expect(r.moves).toEqual([{ code: "SUR 210", fromTerm: 5, toTerm: 4 }]);
    const clinical = c.sessions.filter((x) => x.kind === "CLINICAL");
    expect(clinical).toHaveLength(32);
    expect(clinical.filter((x) => x.dayOfWeek === "Wed")).toHaveLength(16); expect(clinical.filter((x) => x.dayOfWeek === "Thu")).toHaveLength(16);
    expect(clinical.every((x) => x.startTime === "06:30" && x.endTime === "15:00" && x.lengthHours === 8.5 && x.rotationType === "Operating Room or Doctor's Office" && x.preceptorsNeeded === 1 && x.facultyNeeded === 0.03125)).toBe(true);
    expect(c.weeklyClinicalHours).toBe(17);
    expect(r.terms.find((t) => t.index === 5)!.courses.map((x) => x.code)).toEqual(["SUR 137"]);
    expect(r.terms.find((t) => t.index === 4)!.courses.map((x) => x.code)).toEqual(["SUR 211", "SUR 210"]);
  });
  it("untouched courses are copied as they are, and every change is written down", () => {
    expect(course(r, "SUR 211").sessions).toHaveLength(16);
    expect(r.notes).toHaveLength(6);
    expect(r.notes.join("\n")).toMatch(/SUR 111.*tagged online/); expect(r.notes.join("\n")).toMatch(/SUR 210.*moved from Term 5 to Term 4/);
  });
});
