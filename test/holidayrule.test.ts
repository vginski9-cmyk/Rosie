import { describe, it, expect } from "vitest";
import { resolveHoliday, resolveHolidays, holidayOn } from "../src/lib/holidayrule";
import { buildInstances, type CohortCalendarInput, type SessionInput } from "../src/lib/capacitymodel";
import { demandUnits } from "../src/lib/scheduler";

// The holiday rule (Phase 13): a session on an observed holiday moves itself to the nearest open
// day in the same week — class, lab and clinical alike — never onto a day the same course already
// uses, never out of the week. A whole-week break stays flagged. Thanksgiving 2027 is Thu Nov 25.

const HOL = { "2027-11-25": "Thanksgiving", "2027-11-26": "Day after Thanksgiving", "2027-03-08": "Spring break", "2027-03-09": "Spring break", "2027-03-10": "Spring break", "2027-03-11": "Spring break", "2027-03-12": "Spring break" };

describe("resolveHoliday", () => {
  it("leaves an open day alone", () => {
    expect(resolveHoliday("2027-11-23", HOL)).toEqual({ dateIso: "2027-11-23", fromIso: null, holiday: null, unresolved: false });
  });
  it("moves a Thursday session forward past the Friday holiday to … nothing forward, so back to Wednesday", () => {
    // Thu 25 and Fri 26 are holidays; a weekday session stays on weekdays, so forward finds nothing and it goes back to Wed 24.
    expect(resolveHoliday("2027-11-25", HOL)).toEqual({ dateIso: "2027-11-24", fromIso: "2027-11-25", holiday: "Thanksgiving", unresolved: false });
  });
  it("never lands on a day the same course already uses that week", () => {
    expect(resolveHoliday("2027-11-25", HOL, { taken: new Set(["2027-11-24"]) }).dateIso).toBe("2027-11-23");
  });
  it("previous-open-day goes backward first", () => {
    // Mon Jul 5 2027? Use Veterans Day Thu Nov 11 2027 with the US list: previous open day is Wed 10.
    expect(resolveHoliday("2027-11-11", null, { rule: "previous-open-day" })).toMatchObject({ dateIso: "2027-11-10", holiday: "Veterans Day" });
    expect(resolveHoliday("2027-11-11", null, { rule: "next-open-day" })).toMatchObject({ dateIso: "2027-11-12" });
  });
  it("flag-only never moves; a whole-week break cannot be resolved", () => {
    expect(resolveHoliday("2027-11-25", HOL, { rule: "flag-only" })).toEqual({ dateIso: "2027-11-25", fromIso: null, holiday: "Thanksgiving", unresolved: true });
    expect(resolveHoliday("2027-03-10", HOL)).toEqual({ dateIso: "2027-03-10", fromIso: null, holiday: "Spring break", unresolved: true });
  });
  it("a weekend clinical may move within the weekend; a weekday session never moves onto a weekend", () => {
    // Sat Dec 25 2027 is Christmas on the US list and Sun 26 is winter break, so the weekend session falls back to the last open weekday, Thu 23 (Fri 24 is Christmas Eve).
    expect(resolveHoliday("2027-12-25", null)).toMatchObject({ dateIso: "2027-12-23", unresolved: false });
    // … and a Friday session on Christmas Eve (Fri Dec 24 2027) goes back to Thursday, not forward to Saturday.
    expect(resolveHoliday("2027-12-24", null).dateIso).toBe("2027-12-23");
  });
  it("the coded calendar is the only authority once it exists", () => {
    expect(holidayOn("2027-11-11", HOL)).toBeNull(); // Veterans Day is not coded → an open day
    expect(holidayOn("2027-11-11", {})).toBe("Veterans Day"); // no calendar → the U.S. list
  });
  it("prefers a day the cohort has nothing on, and uses a class day only when the week has no free day", () => {
    // Thu 25 holiday; Wed 24 is a class day (avoid), Tue 23 is free → Tue.
    expect(resolveHoliday("2027-11-25", HOL, { avoid: new Set(["2027-11-24"]) }).dateIso).toBe("2027-11-23");
    // Every other weekday is a class day → the nearest one is used rather than leaving the shift on the holiday.
    expect(resolveHoliday("2027-11-25", HOL, { avoid: new Set(["2027-11-22", "2027-11-23", "2027-11-24"]) }).dateIso).toBe("2027-11-24");
    expect(resolveHolidays(["2027-11-25"], HOL, undefined, { cohortDates: ["2027-11-24"] })[0]?.dateIso).toBe("2027-11-23");
  });
  it("resolveHolidays keeps siblings apart: a Mon/Wed/Thu course with Thu on a holiday lands on Tue", () => {
    const rs = resolveHolidays(["2027-11-22", "2027-11-24", "2027-11-25"], HOL);
    expect(rs.map((r) => r?.dateIso)).toEqual(["2027-11-22", "2027-11-24", "2027-11-23"]);
    expect(rs[2]).toMatchObject({ fromIso: "2027-11-25", holiday: "Thanksgiving" });
  });
});

const session = (o: Partial<SessionInput> & { id: string; kind: SessionInput["kind"]; week: number; dayOfWeek: string }): SessionInput => ({
  number: 1, title: null, deliveryMode: null, location: null, lengthHours: 3, maxStudents: 20, facultyNeeded: 1, facultyContactPolicy: null, supportStaffNeeded: 0, supportContactPolicy: null, startTime: "09:00", notes: null,
  preceptorsNeeded: o.kind === "CLINICAL" ? 1 : 0, preceptorContactPolicy: null, rotationType: o.kind === "CLINICAL" ? "General Radiography" : null, clinicalMode: o.kind === "CLINICAL" ? "Preceptor-led" : null, ...o,
});

describe("buildInstances applies the rule to class, lab and clinical", () => {
  // Term starts Mon Nov 22 2027 (week 1 holds Thanksgiving).
  const input = (rule?: CohortCalendarInput["holidayRule"]): CohortCalendarInput => ({
    cohortId: "co", cohort: "Class of 2029", programId: "p", program: "Radiography", enrollmentByTerm: { 1: 20 },
    termStartByIndex: { 1: new Date("2027-11-22T00:00:00Z") }, termEndByIndex: { 1: "2028-03-10" }, termWeeksByIndex: { 1: 16 }, holidays: HOL, holidayRule: rule,
    courses: [{ code: "RAD-111", title: "Intro", termIndex: 1, termName: "First Fall", sessions: [
      session({ id: "class-mon", kind: "CLASS", week: 1, dayOfWeek: "Mon" }), session({ id: "class-thu", kind: "CLASS", week: 1, dayOfWeek: "Thu" }),
      session({ id: "lab-fri", kind: "LAB", week: 1, dayOfWeek: "Fri" }),
      session({ id: "clin-thu", kind: "CLINICAL", week: 1, dayOfWeek: "Thu" }), session({ id: "clin-wed", kind: "CLINICAL", week: 1, dayOfWeek: "Wed" }),
    ] }],
  });
  it("moves each kind onto a day the cohort has nothing else on when one exists, else the nearest day of another kind", () => {
    const rows = buildInstances(input());
    const by = Object.fromEntries(rows.map((r) => [r.session.id, r]));
    // Pattern: Mon class · Wed clinical · Thu class + clinical (holiday) · Fri lab (holiday). Tue is the only free day.
    expect(by["class-mon"].dateIso).toBe("2027-11-22");
    expect(by["clin-wed"].dateIso).toBe("2027-11-24");
    // The Thursday class takes the free Tuesday; the Friday lab, with no free day left, falls back to the nearest day (Wed);
    // the Thursday clinical cannot use Wed (its sibling) and takes Tue, sharing it with the class.
    expect(by["class-thu"]).toMatchObject({ dateIso: "2027-11-23", holiday: null, holidayMoved: { fromIso: "2027-11-25", holiday: "Thanksgiving" } });
    expect(by["lab-fri"]).toMatchObject({ dateIso: "2027-11-24", holidayMoved: { fromIso: "2027-11-26", holiday: "Day after Thanksgiving" } });
    expect(by["clin-thu"]).toMatchObject({ dateIso: "2027-11-23", holidayMoved: { fromIso: "2027-11-25", holiday: "Thanksgiving" } });
    expect(rows.every((r) => r.holiday == null)).toBe(true);
  });
  it("flag-only keeps the collision flagged on the pattern date", () => {
    const rows = buildInstances(input("flag-only"));
    const thu = rows.find((r) => r.session.id === "class-thu")!;
    expect(thu.dateIso).toBe("2027-11-25"); expect(thu.holiday).toBe("Thanksgiving"); expect(thu.holidayMoved ?? null).toBeNull();
  });
  it("a hand-made move filed under the pattern date still wins over the rule in the scheduler's demand", () => {
    const rows = buildInstances(input()).filter((r) => r.session.kind === "CLINICAL");
    const units = demandUnits(rows, [{ rotationType: "general radiography", settingCode: "GEN" }], [{ sessionId: "clin-thu", sectionIndex: 1, fromDate: "2027-11-25", toDate: "2027-11-29", startTime: null }]);
    const moved = units.find((u) => u.sessionId === "clin-thu")!;
    expect(moved.date).toBe("2027-11-29"); expect(moved.moved).toBe(true); expect(moved.originalDate).toBe("2027-11-25");
    const ruled = units.find((u) => u.sessionId === "clin-wed")!;
    expect(ruled.date).toBe("2027-11-24"); expect(ruled.holidayMoved).toBeNull();
    // Without a hand-made move the rule's date stands, and the unit says which holiday it left.
    const plain = demandUnits(rows, [{ rotationType: "general radiography", settingCode: "GEN" }]).find((u) => u.sessionId === "clin-thu")!;
    expect(plain.date).toBe("2027-11-23"); expect(plain.holidayMoved).toBe("Thanksgiving"); expect(plain.holiday).toBeNull(); expect(plain.originalDate).toBe("2027-11-25");
  });
});
