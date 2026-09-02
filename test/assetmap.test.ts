import { describe, it, expect } from "vitest";
import { blocksOn, assetTotals, assetSupply, assetMatch, assetsAvailable, parseAssetMapWorkbook, assetMapWorkbook, ruleDefaults, type AssetLite } from "../src/lib/assetmap";

const mk = (over: Partial<AssetLite>): AssetLite => ({
  id: "a1", externalId: "H001-GEN-01", employerId: "e1", facilityName: "Moore Regional", facilityExternalId: "H001", agreementStatus: "secured",
  settingCode: "GEN", setting: "General diagnostic radiography", assetType: "Fixed radiographic room", assetNumber: 1,
  operatingRule: "24x7", days: "Mon,Tue,Wed,Thu,Fri,Sat,Sun", shiftBlocks: "Day,Evening,Night", hoursPerShift: 8, serves: null,
  learnersPerShift: 1, preceptorsPerShift: 1, dataSource: "VERIFIED", status: "active", ...over,
});

describe("365-day asset map", () => {
  it("reproduces the partner workbook's operating rules and 2027 totals", () => {
    const a24 = mk({ id: "a1" });
    const wk = mk({ id: "a2", externalId: "H001-OR-01", settingCode: "OR", setting: "Operating room / C-arm", operatingRule: "Weekday Day", ...ruleDefaults("Weekday Day")! });
    expect(blocksOn(a24, "2027-01-01")).toEqual(["Day", "Evening", "Night"]);
    expect(blocksOn(wk, "2027-01-01")).toEqual(["Day"]);      // Friday
    expect(blocksOn(wk, "2027-01-02")).toEqual([]);           // Saturday
    const t = assetTotals([a24, wk], [], "2027-01-01", "2027-12-31");
    expect(t.days).toBe(365);
    const gen = t.settings.find((s) => s.settingCode === "GEN")!; const or = t.settings.find((s) => s.settingCode === "OR")!;
    expect([gen.day, gen.evening, gen.night, gen.total, gen.hours]).toEqual([365, 365, 365, 1095, 8760]);
    expect([or.day, or.evening, or.night, or.total, or.hours]).toEqual([261, 0, 0, 261, 2088]);
  });

  it("honors per-date exceptions (a closure) and books learners against seats", () => {
    const a = mk({ learnersPerShift: 2 });
    const closed = [{ assetId: "a1", date: "2027-12-25", shiftBlocks: "" }];
    expect(blocksOn(a, "2027-12-25", closed[0])).toEqual([]);
    const supply = assetSupply([a], closed, "2027-12-24", "2027-12-26");
    expect(supply.get("2027-12-25|Day|GEN")).toBeUndefined();
    expect(supply.get("2027-12-24|Day|GEN")).toMatchObject({ assets: 1, learners: 2, securedLearners: 2 });
    const avail = assetsAvailable([a], closed, [{ id: "b1", assetId: "a1", cohortId: "c", sessionId: null, sectionIndex: 1, date: "2027-12-24", block: "Day", students: 1 }], "2027-12-24", "Day", "GEN");
    expect(avail[0]).toMatchObject({ booked: 1, free: 1 });
  });

  it("matches demand to seats and reports shortfalls physical vs secured vs booked", () => {
    const secured = mk({ id: "a1" });
    const unsecured = mk({ id: "a2", externalId: "H012-GEN-01", employerId: "e2", facilityName: "Cape Fear", agreementStatus: "none" });
    const supply = assetSupply([secured, unsecured], [], "2027-03-01", "2027-03-01");
    const demand = [{ iso: "2027-03-01", block: "Day" as const, settingCode: "GEN", rotationType: "Diagnostic Radiography", students: 3, sections: 3, cohortId: "c", cohort: "Class of 2028", program: "Radiography", courseCode: "RAD 111", sessionId: "s", startTime: "07:00" }];
    const cells = assetMatch(demand, supply, [{ id: "b", assetId: "a1", cohortId: "c", sessionId: "s", sectionIndex: 1, date: "2027-03-01", block: "Day", students: 1 }], new Map([["a1", secured], ["a2", unsecured]]));
    expect(cells[0]).toMatchObject({ demand: 3, learners: 2, securedLearners: 1, booked: 1, shortPhysical: 1, shortSecured: 2, unbooked: 2 });
  });

  it("parses the partner workbook and round-trips it", () => {
    const sheets = {
      ASSET_MAP: [["Radiography Physical Asset Map"], [], [],
        ["asset_id", "facility_id", "facility_name", "county", "ring", "facility_type", "setting_code", "setting", "asset_type", "asset_number", "operating_rule", "serves", "day_shifts", "evening_shifts", "night_shifts", "total_annual_shifts", "annual_asset_hours"],
        ["H001-GEN-01", "H001", "Moore Regional", "Moore", "Core", "Acute care hospital", "GEN", "General diagnostic radiography", "Fixed radiographic room", 1, "24x7", "Routine", 365, 365, 365, 1095, 8760],
        ["H001-OR-01", "H001", "Moore Regional", "Moore", "Core", "Acute care hospital", "OR", "Operating room / C-arm", "Mobile C-arm", 1, "Weekday Day", "Surgical fluoroscopy", 261, 0, 0, 261, 2088]],
      "365_SHIFT_MAP": [["map"], [], [],
        ["asset_day_id", "date", "day_of_week", "asset_id", "facility_id", "facility_name", "setting_code", "setting", "asset_type", "asset_number", "day_shift", "evening_shift", "night_shift", "total_shifts", "total_hours", "serves"],
        ["x", "2027-01-01", "Friday", "H001-GEN-01", "H001", "Moore Regional", "GEN", "", "", 1, 1, 1, 1, 3, 24, ""],
        ["y", "2027-12-25", "Saturday", "H001-GEN-01", "H001", "Moore Regional", "GEN", "", "", 1, 0, 0, 0, 0, 0, ""],   // closed on Christmas → exception
        ["z", "2027-01-04", "Monday", "H001-OR-01", "H001", "Moore Regional", "OR", "", "", 1, 1, 0, 0, 1, 8, ""]],
    };
    const p = parseAssetMapWorkbook(sheets);
    expect(p.issues).toEqual([]);
    expect(p.assets.map((a) => [a.externalId, a.days, a.shiftBlocks])).toEqual([["H001-GEN-01", "Mon,Tue,Wed,Thu,Fri,Sat,Sun", "Day,Evening,Night"], ["H001-OR-01", "Mon,Tue,Wed,Thu,Fri", "Day"]]);
    expect(p.exceptions).toEqual([{ assetId: "H001-GEN-01", date: "2027-12-25", shiftBlocks: "" }]);
    expect(p.mapDates).toEqual({ from: "2027-01-01", to: "2027-12-25" });
    const wb = assetMapWorkbook([mk({})], [], "2027-01-01", "2027-01-07");
    expect(wb.ASSET_MAP[4][0]).toBe("H001-GEN-01");
    expect(wb["365_SHIFT_MAP"].length - 4).toBe(7);
    expect(wb.TOTALS[3]).toContain(21);
  });
});
