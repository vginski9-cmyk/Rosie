import { describe, expect, it } from "vitest";
import { schedulerWindow, filterDemand, planInputs } from "../src/lib/schedulerplan";
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
    const a = { assetId: "a1", employerId: "e1", unit: unit({}), date: "2026-08-19", block: "day", seats: 3, preceptorIds: ["q1"], instructorId: null, parts: [{ assetId: "a1", seats: 2, asset: {} }, { assetId: "a2", seats: 1, asset: {} }], seatOffset: 1 } as unknown as Assignment;
    expect(planInputs([a])).toEqual([{ assetId: "a1", employerId: "e1", cohortId: "c1", sessionId: "s1", sectionIndex: 1, courseId: "k1", date: "2026-08-19", block: "day", seats: 3, seatsPerSection: 4, preceptorIds: ["q1"], instructorId: null, parts: [{ assetId: "a1", seats: 2 }, { assetId: "a2", seats: 1 }], seatOffset: 1 }]);
  });
});
