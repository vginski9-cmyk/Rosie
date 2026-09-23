import { describe, expect, it } from "vitest";
import { schedulerWindow, filterDemand, planInputs } from "../src/lib/schedulerplan";
import { roomForSeat } from "../src/lib/planwrite";
import type { DemandUnit, Assignment } from "../src/lib/scheduler";

const unit = (o: Partial<DemandUnit>): DemandUnit => ({ id: "s1|1|2026-08-18", cohortId: "c1", cohort: "Class of 2028", programId: "p1", program: "Radiography", familyId: "f1", sessionId: "s1", sectionIndex: 1, sectionCount: 2, courseId: "k1", courseCode: "RAD-151", courseTitle: "Clinical I", date: "2026-08-18", block: "day", startTime: "07:00", hours: 8, seats: 4, seatsPerSection: 4, rotationType: "GEN", settingCode: "GEN", holiday: null, preceptorsNeeded: 1, facultyNeeded: 0, ...o } as DemandUnit);

describe("scheduler plan, shared between the board and the apply action", () => {
  it("opens the window at the first term start and closes 20 weeks after the last", () => {
    const w = schedulerWindow([{ termStartByIndex: { 1: "2026-08-17T00:00:00.000Z", 2: "2027-01-11T00:00:00.000Z" } }, { termStartByIndex: { 1: "2026-08-24T00:00:00.000Z" } }]);
    expect(w).toEqual({ from: "2026-08-17", to: "2027-05-31" });
    expect(schedulerWindow([], new Date("2026-09-10T12:00:00Z"))).toEqual({ from: "2026-09-10", to: "2027-01-28" });
  });
  it("keeps the chosen offerings inside the window — no offerings chosen means all of them", () => {
    const d = [unit({}), unit({ id: "b", cohortId: "c2" }), unit({ id: "c", date: "2026-12-01" })];
    expect(filterDemand(d, { from: "2026-08-01", to: "2026-08-31", cohortIds: [] }).map((u) => u.id)).toEqual(["s1|1|2026-08-18", "b"]);
    expect(filterDemand(d, { from: "2026-08-01", to: "2026-12-31", cohortIds: ["c1"] }).map((u) => u.id)).toEqual(["s1|1|2026-08-18", "c"]);
  });
  it("turns a placed section into exactly what the apply action writes", () => {
    const a = { assetId: "a1", employerId: "e1", asset: { eveningStart: "14:30" }, unit: unit({ originalDate: "2026-08-18", startTime: "07:00" }), date: "2026-08-19", block: "Evening", seats: 3, hours: 8, movedDays: 1, changedBlock: true, preceptorIds: ["q1"], instructorId: null, parts: [{ assetId: "a1", seats: 2, asset: {} }, { assetId: "a2", seats: 1, asset: {} }], seatOffset: 1 } as unknown as Assignment;
    expect(planInputs([a])).toEqual([{ assetId: "a1", employerId: "e1", cohortId: "c1", sessionId: "s1", sectionIndex: 1, courseId: "k1", date: "2026-08-19", block: "Evening", seats: 3, seatsPerSection: 4, preceptorIds: ["q1"], instructorId: null, parts: [{ assetId: "a1", seats: 2 }, { assetId: "a2", seats: 1 }], seatOffset: 1, originalDate: "2026-08-18", movedDays: 1, changedBlock: true, startTime: "14:30", hours: 8 }]);
    // an unchanged shift block keeps the session's own start time
    const same = { ...a, block: "Day", changedBlock: false } as unknown as Assignment;
    expect(planInputs([same])[0].startTime).toBe("07:00");
  });

  it("pins each student to the room that seats them when a section spreads across rooms at one site", () => {
    // Section 1 of 7 seats (seats 1–7) booked across three rooms: r1 takes 3, r2 takes 3, r3 takes 1.
    const a = { assetId: "r1", parts: [{ assetId: "r1", seats: 3 }, { assetId: "r2", seats: 3 }, { assetId: "r3", seats: 1 }], seatsPerSection: 20, sectionIndex: 1, seatStart: 1, seatOffset: 0 };
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => roomForSeat(a, n))).toEqual(["r1", "r1", "r1", "r2", "r2", "r2", "r3"]);
    // The second piece of a section split across sites covers seats 3–4 of the section: seat 3 is its first seat.
    const piece = { assetId: "e3r1", parts: [{ assetId: "e3r1", seats: 1 }, { assetId: "e3r2", seats: 1 }], seatsPerSection: 4, sectionIndex: 1, seatStart: 1, seatOffset: 2 };
    expect([3, 4].map((n) => roomForSeat(piece, n))).toEqual(["e3r1", "e3r2"]);
    // One room, or an input from before parts existed: the lead room.
    expect(roomForSeat({ assetId: "r9", seatsPerSection: 1, sectionIndex: 4 }, 4)).toBe("r9");
    // Section 2 under the ceiling rule (no seatStart): seats 3–4 of a 2-per-section template.
    const s2 = { assetId: "x1", parts: [{ assetId: "x1", seats: 1 }, { assetId: "x2", seats: 1 }], seatsPerSection: 2, sectionIndex: 2 };
    expect([3, 4].map((n) => roomForSeat(s2, n))).toEqual(["x1", "x2"]);
  });
});
