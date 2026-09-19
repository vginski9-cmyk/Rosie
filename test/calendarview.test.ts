import { describe, it, expect } from "vitest";
import { rangeFor, monthGrid, monthsIn, narrowEvent, narrowEvents, aggregateDays, totalsOf, searchEntities, parseEntityKey, entityKey, type CalEvent, type CalEntity } from "../src/lib/calendarview";

// The master calendar's pure half: the six views' ranges, the month grid, narrowing to one thing,
// and the roll-ups the coarse views draw.

const anchors = { springStart: "01-11", summerStart: "05-31", fallStart: "08-16" };

describe("rangeFor: every view knows its range and where ← and → go", () => {
  it("day", () => { expect(rangeFor("day", "2026-10-07", anchors)).toMatchObject({ fromIso: "2026-10-07", toIso: "2026-10-07", prevIso: "2026-10-06", nextIso: "2026-10-08" }); });
  it("week is Monday to Sunday around any day", () => {
    const r = rangeFor("week", "2026-10-07", anchors); // a Wednesday
    expect(r).toMatchObject({ fromIso: "2026-10-05", toIso: "2026-10-11", prevIso: "2026-09-30", nextIso: "2026-10-14" });
    expect(rangeFor("week", "2026-10-11", anchors).fromIso).toBe("2026-10-05"); // Sunday belongs to the week before
  });
  it("month, quarter and year snap to their first day", () => {
    expect(rangeFor("month", "2026-10-07", anchors)).toMatchObject({ dateIso: "2026-10-01", fromIso: "2026-10-01", toIso: "2026-10-31", prevIso: "2026-09-01", nextIso: "2026-11-01", label: "October 2026" });
    expect(rangeFor("quarter", "2026-11-20", anchors)).toMatchObject({ fromIso: "2026-10-01", toIso: "2026-12-31", prevIso: "2026-07-01", nextIso: "2027-01-01" });
    expect(rangeFor("year", "2026-06-15", anchors)).toMatchObject({ fromIso: "2026-01-01", toIso: "2026-12-31", prevIso: "2025-01-01", nextIso: "2027-01-01", label: "2026" });
    expect(rangeFor("month", "2028-02-10", anchors).toIso).toBe("2028-02-29"); // a leap February
  });
  it("semester runs from its start (the Monday on or after the anchor) to the day before the next one", () => {
    const fall = rangeFor("semester", "2026-10-07", anchors);
    expect(fall.semester).toEqual({ season: "Fall", year: 2026 });
    expect(fall.fromIso).toBe("2026-08-17"); // Aug 16 2026 is a Sunday → Monday the 17th
    expect(fall.toIso).toBe("2027-01-10"); // Spring 2027 starts Mon Jan 11
    expect(fall.nextIso).toBe("2027-01-11");
    expect(rangeFor("semester", fall.prevIso, anchors).semester).toEqual({ season: "Summer", year: 2026 });
  });
});

describe("the month grid", () => {
  it("starts on the Monday before the first and runs whole weeks past the last", () => {
    const rows = monthGrid("2026-10-01"); // Oct 1 2026 is a Thursday
    expect(rows[0][0]).toEqual({ iso: "2026-09-28", inMonth: false });
    expect(rows[0][3]).toEqual({ iso: "2026-10-01", inMonth: true });
    expect(rows.at(-1)![6]).toEqual({ iso: "2026-11-01", inMonth: false });
    expect(rows.length).toBe(5);
    expect(rows.every((r) => r.length === 7)).toBe(true);
  });
  it("lists the months a range touches", () => { expect(monthsIn("2026-08-17", "2027-01-10")).toEqual(["2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01", "2026-12-01", "2027-01-01"]); });
});

const ev = (o: Partial<CalEvent> & { id: string }): CalEvent => ({
  date: "2026-10-07", dayOfWeek: "Wed", startTime: "08:00", endTime: "11:00", hours: 3, kind: "CLASS", online: false, title: null,
  courseId: "c1", courseCode: "RAD-111", courseName: "Intro", cohortId: "co1", cohortName: "Class of 2028", cohortStatus: "active", programId: "p1", programName: "Radiography",
  termName: "Term 1", weekOfTerm: 3, holidayMoved: null, holiday: null,
  sections: [{ index: 1, count: 2, seats: 10, patternId: "m1", roomId: "r1", room: "Lab A", siteId: null, site: null, booked: false, staff: [{ id: "i1", name: "Ana", role: "instructor" }], students: [{ id: "s1", name: "Bo", status: "enrolled" }, { id: "s2", name: "Cy", status: "enrolled" }], moved: null },
    { index: 2, count: 2, seats: 10, patternId: "m2", roomId: "r2", room: "Lab B", siteId: null, site: null, booked: false, staff: [{ id: "i2", name: "Di", role: "instructor" }], students: [{ id: "s3", name: "Ed", status: "enrolled" }], moved: null }],
  students: 3, ...o,
});
const clinical = ev({ id: "e2", kind: "CLINICAL", date: "2026-10-08", dayOfWeek: "Thu", hours: 8, sections: [{ index: 1, count: 1, seats: 4, patternId: null, roomId: null, room: null, siteId: "h1", site: "FirstHealth", booked: true, staff: [{ id: "pr1", name: "Pat", role: "preceptor" }], students: [{ id: "s1", name: "Bo", status: "scheduled" }, { id: "s9", name: "Zed", status: "scheduled" }], moved: null }], students: 2, holidayMoved: { fromIso: "2026-10-09", holiday: "Fall break" } });

describe("narrowing to one thing", () => {
  const e = ev({ id: "e1" });
  it("a student keeps only their section", () => {
    const n = narrowEvent(e, { kind: "student", id: "s3" })!;
    expect(n.sections.map((s) => s.index)).toEqual([2]); expect(n.students).toBe(1);
    expect(narrowEvent(e, { kind: "student", id: "nobody" })).toBeNull();
  });
  it("an instructor, a room, a site", () => {
    expect(narrowEvent(e, { kind: "person", id: "i1" })!.sections.map((s) => s.index)).toEqual([1]);
    expect(narrowEvent(e, { kind: "room", id: "r2" })!.sections.map((s) => s.index)).toEqual([2]);
    expect(narrowEvent(e, { kind: "site", id: "h1" })).toBeNull();
    expect(narrowEvent(clinical, { kind: "site", id: "h1" })!.students).toBe(2);
  });
  it("an offering, a program, a course, and the type and program filters", () => {
    expect(narrowEvent(e, { kind: "cohort", id: "co1" })).toBe(e);
    expect(narrowEvent(e, { kind: "program", id: "px" })).toBeNull();
    expect(narrowEvents([e, clinical], { kind: "course", id: "c1" }).length).toBe(2);
    expect(narrowEvents([e, clinical], null, "CLINICAL").map((x) => x.id)).toEqual(["e2"]);
    expect(narrowEvents([e, clinical], { kind: "student", id: "s1" }, null, "p1").length).toBe(2);
    expect(narrowEvents([e, clinical], null, null, "other").length).toBe(0);
  });
});

describe("roll-ups", () => {
  const e = ev({ id: "e1" });
  it("per day: sessions by kind, student shifts only for clinical, hours, sites and rooms", () => {
    const d = aggregateDays([e, clinical]);
    expect(d["2026-10-07"]).toMatchObject({ sessions: 1, classes: 1, clinicals: 0, studentShifts: 0, hours: 3, rooms: 2, sites: 0 });
    expect(d["2026-10-08"]).toMatchObject({ sessions: 1, clinicals: 1, studentShifts: 2, hours: 8, sites: 1, rooms: 0 });
  });
  it("totals: distinct people and students, days, what the rule moved", () => {
    const t = totalsOf([e, clinical]);
    expect(t).toMatchObject({ sessions: 2, classes: 1, clinicals: 1, studentShifts: 2, hours: 11, sites: 1, rooms: 2, people: 3, students: 4, days: 2, movedByRule: 1, onHoliday: 0, unbookedClinical: 0, unstaffed: 0 });
    expect(totalsOf([ev({ id: "x", sections: [{ ...e.sections[0], staff: [] }] })]).unstaffed).toBe(1);
  });
});

describe("search", () => {
  const entities: CalEntity[] = [
    { kind: "student", id: "s1", name: "Maria Lopez", sub: "Radiography · Class of 2028" },
    { kind: "person", id: "p1", name: "Lopez, Ana", sub: "instructor" },
    { kind: "site", id: "h1", name: "FirstHealth Moore Regional", sub: "Acute care hospital · Pinehurst" },
    { kind: "room", id: "r1", name: "Van Dusen 214", sub: "lab" },
  ];
  it("every word must match the name or its sub-line; prefix matches first", () => {
    expect(searchEntities(entities, "lopez").map((e) => e.id)).toEqual(["p1", "s1"]);
    expect(searchEntities(entities, "maria 2028").map((e) => e.id)).toEqual(["s1"]);
    expect(searchEntities(entities, "pinehurst").map((e) => e.id)).toEqual(["h1"]);
    expect(searchEntities(entities, "")).toEqual([]);
    expect(searchEntities(entities, "zzz")).toEqual([]);
  });
  it("entity keys round-trip and reject junk", () => {
    expect(parseEntityKey(entityKey({ kind: "room", id: "r1" }))).toEqual({ kind: "room", id: "r1" });
    expect(parseEntityKey("bogus:1")).toBeNull(); expect(parseEntityKey("student:")).toBeNull(); expect(parseEntityKey(null)).toBeNull();
  });
});
