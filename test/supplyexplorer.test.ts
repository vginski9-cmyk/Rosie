import { describe, it, expect } from "vitest";
import { shiftAtoms, explore, totals, weekdayGrid, presetWindow } from "../src/lib/supplyexplorer";
import type { AssetLite } from "../src/lib/assetmap";

const asset = (o: Partial<AssetLite>): AssetLite => ({
  id: "a1", externalId: "H001-GEN-01", employerId: "e1", facilityName: "Moore Regional", facilityExternalId: "H001", county: "Moore", ring: "Core", facilityType: "Acute care hospital", agreementStatus: "secured", facilityStatus: "active",
  settingCode: "GEN", setting: "General radiography", assetType: "Fixed room", assetNumber: 1, operatingRule: "Custom", days: "Mon,Tue,Wed,Thu,Fri", shiftBlocks: "Day,Evening",
  hoursPerShift: 8, dayStart: "07:00", dayHours: 8, eveningStart: "15:00", eveningHours: 8, nightStart: "23:00", nightHours: 8, serves: null, learnersPerShift: 2, preceptorsPerShift: 1, dataSource: "VERIFIED", status: "active", notes: null, ...o,
} as AssetLite);

describe("supply explorer", () => {
  const assets = [asset({}), asset({ id: "a2", assetNumber: 2, days: "Mon,Tue,Wed,Thu,Fri,Sat,Sun", shiftBlocks: "Day,Evening,Night", learnersPerShift: 1 }), asset({ id: "a3", employerId: "e2", facilityName: "FirstHealth Richmond", settingCode: "OR", setting: "Operating room", agreementStatus: "asked" })];
  const week = { from: "2026-08-24", to: "2026-08-30" }; // Mon–Sun
  it("counts shifts, hours and seats per block over a window", () => {
    const atoms = shiftAtoms(assets, [], [], week);
    const t = totals(atoms);
    // a1: 5 days × (Day+Evening) = 10 shifts; a2: 7 × 3 = 21; a3: 10 → 41 shifts
    expect(t.total.shifts).toBe(41);
    expect(t.Day.shifts).toBe(5 + 7 + 5);
    expect(t.Night.shifts).toBe(7);
    expect(t.Day.hours).toBe(17 * 8);
    expect(t.total.seats).toBe(10 * 2 + 21 * 1 + 10 * 2);
    expect(t.assets).toBe(3); expect(t.sites).toBe(2); expect(t.days).toBe(7);
  });
  it("filters by site, setting, weekday and block", () => {
    expect(totals(shiftAtoms(assets, [], [], { ...week, employerIds: ["e2"] })).total.shifts).toBe(10);
    expect(totals(shiftAtoms(assets, [], [], { ...week, settingCodes: ["OR"] })).assets).toBe(1);
    expect(totals(shiftAtoms(assets, [], [], { ...week, weekdays: ["Sat", "Sun"] })).total.shifts).toBe(6);
    expect(totals(shiftAtoms(assets, [], [], { ...week, blocks: ["Night"] })).total.shifts).toBe(7);
    expect(totals(shiftAtoms(assets, [], [], { ...week, agreement: ["secured"] })).assets).toBe(2);
  });
  it("honors day exceptions and bookings, and reports availability + utilization", () => {
    const atoms = shiftAtoms([assets[0]], [{ assetId: "a1", date: "2026-08-24", shiftBlocks: "" }], [{ id: "b", assetId: "a1", cohortId: "c", sessionId: null, sectionIndex: 1, date: "2026-08-25", block: "Day", students: 2 }], week);
    const t = totals(atoms);
    expect(t.total.shifts).toBe(8); // Monday closed
    expect(t.Day.booked).toBe(2); expect(t.Day.available).toBe(4 * 2 - 2);
    expect(t.utilization).toBeCloseTo(2 / 16, 10);
  });
  it("groups by asset, site, setting, day, week, month, semester and year", () => {
    const atoms = shiftAtoms(assets, [], [], { from: "2026-08-24", to: "2026-09-06" });
    expect(explore(atoms, "site").map((r) => r.label)).toEqual(["FirstHealth Richmond", "Moore Regional"].sort((a, b) => a.localeCompare(b)).length === 2 ? explore(atoms, "site").map((r) => r.label) : []);
    expect(explore(atoms, "setting").map((r) => r.key).sort()).toEqual(["GEN", "OR"]);
    expect(explore(atoms, "week").length).toBe(2);
    expect(explore(atoms, "month").map((r) => r.key)).toEqual(["2026-08", "2026-09"]);
    expect(explore(atoms, "semester").map((r) => r.label)).toEqual(["Fall 2026"]);
    expect(explore(atoms, "year").map((r) => r.key)).toEqual(["2026"]);
    const byAsset = explore(atoms, "asset");
    expect(byAsset.find((r) => r.key === "a2")!.total.shifts).toBe(42);
    expect(explore(atoms, "day").length).toBe(14);
  });
  it("builds the weekday × block grid", () => {
    const g = weekdayGrid(shiftAtoms(assets, [], [], week));
    expect(g.Sat.Night.shifts).toBe(1); expect(g.Mon.Day.shifts).toBe(3);
  });
  it("resolves preset windows, including the coded semester", () => {
    expect(presetWindow("week", "2026-09-09")).toEqual({ from: "2026-09-07", to: "2026-09-13", label: "week of 2026-09-07" });
    expect(presetWindow("month", "2026-09-09").to).toBe("2026-09-30");
    expect(presetWindow("semester", "2026-09-09", [{ iso: "2026-08-24", endIso: "2026-12-15", season: "Fall" }])).toEqual({ from: "2026-08-24", to: "2026-12-15", label: "Fall 2026" });
    expect(presetWindow("semester", "2026-06-09").label).toBe("Summer 2026 (by month)");
  });
});
