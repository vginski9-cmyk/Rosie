import { describe, it, expect } from "vitest";
import { accreditorClassOf, jrcertCapacity, peakAssigned, programCapacityChange } from "../src/lib/jrcert";

describe("JRCERT clinical capacity (Form 1010R)", () => {
  it("classes assets the way the form counts them", () => {
    expect(accreditorClassOf({ settingCode: "GEN", assetType: "Fixed radiographic room" })).toBe("RAD_ROOM");
    expect(accreditorClassOf({ settingCode: "ED", assetType: "ED radiographic room" })).toBe("RAD_ROOM");
    expect(accreditorClassOf({ settingCode: "FLUORO", assetType: "R&F / fluoroscopy room" })).toBe("RF_ROOM");
    expect(accreditorClassOf({ settingCode: "PORT", assetType: "Mobile radiography unit" })).toBe("MOBILE");
    expect(accreditorClassOf({ settingCode: "OR", assetType: "Mobile C-arm" })).toBe("C_ARM");
    for (const code of ["CT", "MRI", "US", "MAMMO", "BEDS"]) expect(accreditorClassOf({ settingCode: code, assetType: "x" })).toBe("EXCLUDED");
    expect(accreditorClassOf({ settingCode: "GEN", assetType: "Fixed radiographic room", accreditorClass: "EXCLUDED" })).toBe("EXCLUDED");
  });
  it("capacity is the lower of physical and human resources", () => {
    const assets = [
      { settingCode: "GEN", assetType: "Fixed radiographic room" }, { settingCode: "GEN", assetType: "Fixed radiographic room" }, { settingCode: "FLUORO", assetType: "R&F / fluoroscopy room" },
      { settingCode: "PORT", assetType: "Mobile radiography unit" }, { settingCode: "OR", assetType: "Mobile C-arm" }, { settingCode: "CT", assetType: "CT scanner" },
    ];
    const r = jrcertCapacity({ assets, qualifiedStaffOnShift: 3 });
    expect(r.rooms).toBe(3); expect(r.units).toBe(2); expect(r.physical).toBe(5); expect(r.excluded).toBe(1);
    expect(r.capacity).toBe(3); expect(r.limiting).toBe("human"); expect(r.humanIsEstimate).toBe(false);
    const r2 = jrcertCapacity({ assets, qualifiedStaffOnShift: 9 });
    expect(r2.capacity).toBe(5); expect(r2.limiting).toBe("physical");
  });
  it("falls back to an estimate from day-shift preceptors when the site has no coded staff count", () => {
    const r = jrcertCapacity({ assets: [{ settingCode: "GEN", preceptorsPerShift: 2, shiftBlocks: "Day,Evening" }, { settingCode: "PORT", preceptorsPerShift: 1, shiftBlocks: "Night" }, { settingCode: "CT", preceptorsPerShift: 5 }], qualifiedStaffOnShift: null });
    expect(r.humanEstimate).toBe(2); expect(r.humanIsEstimate).toBe(true); expect(r.capacity).toBe(2);
  });
  it("peak assigned is the most students on site at one time", () => {
    const W = 7 * 24 * 3600 * 1000;
    const m = (dayOfWeek: string, startMin: number, lengthHours: number, seats: number, w0 = 0, w1 = 16 * W) => ({ dayOfWeek, startMin, lengthHours, seats, weekStartMs: w0, weekEndMs: w1 });
    expect(peakAssigned([m("Tue", 420, 7.5, 1), m("Tue", 420, 7.5, 1), m("Tue", 420, 7.5, 1), m("Thu", 420, 7.5, 2)]).peak).toBe(3);
    // Different terms never overlap.
    expect(peakAssigned([m("Tue", 420, 7.5, 3, 0, 16 * W), m("Tue", 420, 7.5, 4, 20 * W, 36 * W)]).peak).toBe(4);
    expect(peakAssigned([]).peak).toBe(0);
  });
  it("section III reads the change from approved to requested", () => {
    expect(programCapacityChange(40, 4, 6)).toEqual({ kind: "increase", by: 2, newTotal: 42 });
    expect(programCapacityChange(40, 4, 4)).toEqual({ kind: "same", by: 0, newTotal: 40 });
    expect(programCapacityChange(null, 4, 3)).toEqual({ kind: "decrease", by: 1, newTotal: null });
  });
});
