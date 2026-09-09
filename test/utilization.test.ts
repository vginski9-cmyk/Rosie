import { describe, it, expect } from "vitest";
import { utilizationAtoms, utilizationRollup, utilizationTotals, hourHeat, semesterOf, openRoomHours, datesBetween, type UtilRoom, type UtilMeeting } from "../src/lib/utilization";

const ms = (iso: string) => new Date(iso + "T00:00:00Z").getTime();
const room = (id: string, over: Partial<UtilRoom> = {}): UtilRoom => ({
  id, name: id, kind: "CLASSROOM", capacity: 30, buildingId: "b1", building: "Kennedy Hall", campusId: "c1", campus: "Main",
  hours: ["Mon", "Tue", "Wed", "Thu", "Fri"].map((d) => ({ dayOfWeek: d, openTime: "08:00", closeTime: "18:00" })), closures: [], ...over,
});
const meeting = (id: string, over: Partial<UtilMeeting> = {}): UtilMeeting => ({
  id, cohortId: "co1", cohort: "Class of 2028", programId: "p1", program: "Surg Tech", courseId: "k1", courseCode: "SUR 110", courseName: "Intro",
  kind: "CLASS", sectionIndex: 1, seats: 20, dayOfWeek: "Mon", startTime: "09:00", lengthHours: 3,
  facilityId: "r1", employerId: null, employerName: null, weekStartMs: ms("2026-08-17"), weekEndMs: ms("2026-12-05"), termIndex: 1, ...over,
});

describe("utilization atoms", () => {
  it("expands a weekly booking into one occurrence per week inside the window and the booking's run", () => {
    const atoms = utilizationAtoms([meeting("m1")], [room("r1")], { from: "2026-08-01", to: "2026-09-30" });
    expect(atoms.map((a) => a.iso)).toEqual(["2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"]);
    expect(atoms[0]).toMatchObject({ weekday: "Mon", monday: "2026-08-17", month: "2026-08", year: "2026", semester: "Fall 2026", hours: 3, seats: 20, room: "r1", building: "Kennedy Hall", withinOpen: true });
  });
  it("stops at the term's last day, so a summer booking never runs into the fall", () => {
    const atoms = utilizationAtoms([meeting("m1", { weekStartMs: ms("2027-05-31"), weekEndMs: ms("2027-08-07") })], [room("r1")], { from: "2027-01-01", to: "2027-12-31" });
    expect(atoms[atoms.length - 1].iso).toBe("2027-08-02");
    expect(atoms.every((a) => a.semester === "Summer 2027")).toBe(true);
  });
  it("filters by program, kind, weekday, building, room and campus/clinical", () => {
    const ms2 = [meeting("m1"), meeting("m2", { kind: "CLINICAL", facilityId: null, employerId: "e1", employerName: "FirstHealth", dayOfWeek: "Tue" }), meeting("m3", { programId: "p2", program: "Rad Tech", facilityId: "r2", dayOfWeek: "Wed" })];
    const rooms = [room("r1"), room("r2", { buildingId: "b2", building: "Blue Hall" })];
    const win = { from: "2026-08-17", to: "2026-08-23" };
    expect(utilizationAtoms(ms2, rooms, win).length).toBe(3);
    expect(utilizationAtoms(ms2, rooms, { ...win, programIds: ["p2"] }).map((a) => a.meetingId)).toEqual(["m3"]);
    expect(utilizationAtoms(ms2, rooms, { ...win, kinds: ["CLINICAL"] }).map((a) => a.meetingId)).toEqual(["m2"]);
    expect(utilizationAtoms(ms2, rooms, { ...win, weekdays: ["Wed"] }).map((a) => a.meetingId)).toEqual(["m3"]);
    expect(utilizationAtoms(ms2, rooms, { ...win, buildingIds: ["b2"] }).map((a) => a.meetingId)).toEqual(["m3"]);
    expect(utilizationAtoms(ms2, rooms, { ...win, roomIds: ["r1"] }).map((a) => a.meetingId)).toEqual(["m1"]);
    expect(utilizationAtoms(ms2, rooms, { ...win, where: "campus" }).map((a) => a.meetingId)).toEqual(["m1", "m3"]);
    expect(utilizationAtoms(ms2, rooms, { ...win, where: "clinical" }).map((a) => a.meetingId)).toEqual(["m2"]);
  });
  it("flags bookings outside a room's coded hours", () => {
    const atoms = utilizationAtoms([meeting("m1", { startTime: "17:00", lengthHours: 2 })], [room("r1")], { from: "2026-08-17", to: "2026-08-23" });
    expect(atoms[0].withinOpen).toBe(false);
  });
  it("codes semesters from coded windows when present", () => {
    expect(semesterOf("2027-06-10", [{ iso: "2027-05-24", endIso: "2027-08-06", season: "Summer" }])).toBe("Summer 2027");
    expect(semesterOf("2027-06-10")).toBe("Summer 2027");
    expect(semesterOf("2027-08-05")).toBe("Summer 2027"); // the pattern: fall starts mid-August
    expect(semesterOf("2027-09-10")).toBe("Fall 2027");
    expect(semesterOf("2027-01-04")).toBe("Fall 2026"); // before the spring start
  });
});

describe("utilization rollup", () => {
  const rooms = [room("r1"), room("r2", { capacity: 12, kind: "LAB" })];
  const ms2 = [meeting("m1"), meeting("m2", { id: "m2", facilityId: "r2", kind: "LAB", dayOfWeek: "Tue", lengthHours: 4, seats: 12 }), meeting("m3", { kind: "CLINICAL", facilityId: null, employerId: "e1", employerName: "FirstHealth", dayOfWeek: "Wed", lengthHours: 8 })];
  const win = { from: "2026-08-17", to: "2026-08-30" }; // two full weeks
  const atoms = utilizationAtoms(ms2, rooms, win);

  it("by room: booked ÷ open room-hours over the window", () => {
    const rows = utilizationRollup(atoms, rooms, "room", win.from, win.to);
    const r1 = rows.find((r) => r.key === "r1")!;
    expect(r1.bookings).toBe(2); expect(r1.hours).toBe(6);
    expect(r1.openHours).toBe(100); // 10 h × 5 days × 2 weeks
    expect(r1.utilization).toBeCloseTo(0.06);
    expect(r1.fill).toBeCloseTo(20 / 30);
    const off = rows.find((r) => r.key === "~unroomed")!;
    expect(off.hours).toBe(16); expect(off.openHours).toBeNull();
  });
  it("by building: every room in the building is the denominator, even unused ones", () => {
    const rows = utilizationRollup(atoms, rooms, "building", win.from, win.to);
    const b1 = rows.find((r) => r.key === "b1")!;
    expect(b1.rooms).toBe(2); expect(b1.hours).toBe(14); expect(b1.openHours).toBe(200);
    expect(b1.utilization).toBeCloseTo(14 / 200);
  });
  it("by week / day: the room scope's open hours on those dates", () => {
    const weeks = utilizationRollup(atoms, rooms, "week", win.from, win.to);
    expect(weeks.map((w) => w.key)).toEqual(["2026-08-17", "2026-08-24"]);
    expect(weeks[0].openHours).toBe(100); expect(weeks[0].hours).toBe(15); expect(weeks[0].utilization).toBeCloseTo(7 / 100); // clinical hours don't use rooms
    const days = utilizationRollup(atoms, rooms, "day", win.from, win.to);
    expect(days[0]).toMatchObject({ key: "2026-08-17", hours: 3, openHours: 20 });
  });
  it("by program / kind / semester", () => {
    expect(utilizationRollup(atoms, rooms, "program", win.from, win.to)[0]).toMatchObject({ label: "Surg Tech", bookings: 6, hours: 30, openHours: null });
    const kinds = utilizationRollup(atoms, rooms, "kind", win.from, win.to);
    expect(kinds.map((k) => [k.label, k.hours])).toEqual([["Class", 6], ["Clinical", 16], ["Lab", 8]]);
    const sem = utilizationRollup(atoms, rooms, "semester", win.from, win.to);
    expect(sem[0].label).toBe("Fall 2026"); expect(sem[0].openHours).toBe(200);
  });
  it("totals", () => {
    const t = utilizationTotals(atoms, rooms, win.from, win.to);
    expect(t).toMatchObject({ bookings: 6, hours: 30, campusHours: 14, clinicalHours: 16, openHours: 200, roomsUsed: 2, roomsInScope: 2, days: 14, daysWithBookings: 6 });
    expect(t.utilization).toBeCloseTo(0.07);
    expect(t.busiestDay).toMatchObject({ hours: 8 });
  });
  it("hour heat lights the hours a booking covers", () => {
    const { grid, hours } = hourHeat(atoms.filter((a) => a.meetingId === "m1" && a.iso === "2026-08-17"), 8, 12);
    expect(hours).toEqual([8, 9, 10, 11]);
    expect(grid.Mon).toEqual([0, 1, 1, 1]);
  });
  it("open hours honor closures", () => {
    const r = room("r1", { closures: [{ date: "2026-08-18", openTime: null, closeTime: null }, { date: "2026-08-19", openTime: "08:00", closeTime: "12:00" }] });
    expect(openRoomHours([r], datesBetween("2026-08-17", "2026-08-21"))).toBe(10 + 0 + 4 + 10 + 10);
  });
});
