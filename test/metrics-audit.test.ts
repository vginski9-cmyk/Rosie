import { describe, expect, it } from "vitest";
import { resolveSessionDay, shiftBoard, distinctStudents, type DatedInstance } from "../src/lib/capacitymodel";
import { fmt, dec } from "../src/lib/format";

// Fixes from docs/metrics-audit.md (Phase 0).

describe("a session's weekday follows a moved weekly booking (audit §2.3)", () => {
  const tt = ["Tue", "Thu"];
  it("keeps the session's own day while a booking still sits on it", () => {
    expect(resolveSessionDay("Tue", false, [{ dayOfWeek: "Tue" }, { dayOfWeek: "Thu" }], tt)).toBe("Tue");
  });
  it("follows the booking the calendar moved to a day no session uses (Tue → Thu when the course had Tue only)", () => {
    expect(resolveSessionDay("Tue", false, [{ dayOfWeek: "Thu" }], ["Tue"])).toBe("Thu");
  });
  it("does not steal another session's day: with Tue and Thu sessions and only a Thu booking, Tue stays Tue", () => {
    expect(resolveSessionDay("Tue", false, [{ dayOfWeek: "Thu" }], tt)).toBe("Tue");
  });
  it("gives a day-less in-person session its first booking's day, and leaves an online session undated", () => {
    expect(resolveSessionDay(null, false, [{ dayOfWeek: "Wed" }], [])).toBe("Wed");
    expect(resolveSessionDay(null, true, [{ dayOfWeek: "Wed" }], [])).toBeNull();
    expect(resolveSessionDay("Mon", true, [{ dayOfWeek: "Wed" }], ["Mon"])).toBe("Mon");
  });
  it("with no bookings at all the session's day stands", () => {
    expect(resolveSessionDay("Fri", false, [], ["Fri"])).toBe("Fri");
  });
});

const inst = (cohortId: string, sessionId: string, kind: string, C: number, Y: number, maxStudents: number): DatedInstance => ({
  cohortId, cohort: cohortId, programId: "p", program: "P", courseId: "c", courseCode: "X", courseTitle: "X", termIndex: 1, termName: "Term 1", weekOfTerm: 1,
  mondayIso: "2026-08-17", dateIso: "2026-08-17", holiday: null,
  session: { id: sessionId, kind: kind as "CLASS", number: 1, title: null, lengthHours: 2, maxStudents, facultyNeeded: 1, preceptorsNeeded: 0, supportStaffNeeded: 0, week: 1, dayOfWeek: "Mon", startTime: null, location: null, rotationType: null, clinicalMode: null, deliveryMode: null, notes: null },
  computed: { C, Y, spaceHours: 0, facultyContactHours: 0, facultyFte: 0, preceptorContactHours: 0, preceptorFte: 0 },
} as unknown as DatedInstance);

describe("daily coverage counts students, not attendances (audit §1.6)", () => {
  // Aug 17, 2026: RAD-110 class (41 radiography students in 2 sections of 25), RAD-110 lab (the same 41 in 4 sections of 12), SUR 111 class (19).
  const day = [inst("rad", "s-class", "CLASS", 41, 2, 25), inst("rad", "s-lab", "LAB", 41, 4, 12), inst("surg", "s-sur", "CLASS", 19, 1, 20)];
  it("41 + 41 + 19 attendances are 60 distinct students", () => {
    expect(distinctStudents(day)).toBe(60);
    const [row] = shiftBoard(day);
    expect(row.studentsOnSite).toBe(60);
    expect(row.attendances).toBe(101);
  });
});

describe("the format module's rules (audit §2.1)", () => {
  it("counts are whole; required counts round up", () => {
    expect(fmt.num(82.2140822)).toBe("82");
    expect(fmt.atLeast(82.2140822)).toBe("83");
    expect(fmt.atLeast(83)).toBe("83");
  });
  it("percentages carry at most one decimal", () => {
    expect(fmt.pct(1.085365854)).toBe("108.5%");
    expect(fmt.pct(0.5)).toBe("50%");
  });
  it("FTE one to two decimals, hours at most one, age one, multipliers two", () => {
    expect(fmt.fte(5.6225411)).toBe("5.62");
    expect(fmt.fte(2)).toBe("2.0");
    expect(fmt.hours(5.833333333333333)).toBe("5.8");
    expect(fmt.hours(2091.6666667)).toBe("2,091.7");
    expect(fmt.age(30.1307692)).toBe("30.1");
    expect(fmt.mult(2.2222222)).toBe("2.22");
    expect(dec(199.9994664)).toBe("200");
  });
  it("missing reads as a dash, never NaN", () => {
    expect(fmt.num(null)).toBe("—");
    expect(fmt.pct(Number.NaN)).toBe("—");
  });
});
