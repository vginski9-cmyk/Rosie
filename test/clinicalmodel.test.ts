import { describe, it, expect } from "vitest";
import { weeklyDemand, demandBySetting, weeklySupply, matchWeekly, settingSummaries, regionRollup, requirementTotals } from "../src/lib/clinicalmodel";
import type { AssetLite } from "../src/lib/assetmap";

const gen = (id: string, over: Partial<AssetLite> = {}): AssetLite => ({
  id, externalId: id, employerId: "e1", facilityName: "Moore Regional", facilityExternalId: "H001", county: "Moore", ring: "Core", agreementStatus: "secured",
  settingCode: "GEN", setting: "General diagnostic radiography", assetType: "Fixed radiographic room", assetNumber: 1,
  operatingRule: "24x7", days: "Mon,Tue,Wed,Thu,Fri,Sat,Sun", shiftBlocks: "Day,Evening,Night", hoursPerShift: 8, serves: null,
  learnersPerShift: 1, preceptorsPerShift: 1, dataSource: "VERIFIED", status: "active", ...over,
});
const areas = [
  { id: "aGEN", code: "GEN", name: "General", settingCodes: ["GEN"], sortOrder: 0 },
  { id: "aCOMP", code: "COMP", name: "Competency completion", settingCodes: ["GEN", "ED"], sortOrder: 6 },
];

describe("hours-based clinical model", () => {
  it("turns hours per student into hours per week per service area — the workbook's 200 h/week for RAD 151", () => {
    const d = weeklyDemand(
      [{ cohortId: "c", cohort: "Class of 2028", programId: "p", program: "Radiography", courseId: "rad151", courseCode: "RAD-151", courseName: "Clinical Ed I", termIndex: 1, students: 40, startIso: "2026-08-17", weeks: 16 }],
      [{ courseId: "rad151", serviceAreaId: "aGEN", hoursPerStudent: 80 }, { courseId: "rad151", serviceAreaId: "aCOMP", hoursPerStudent: 16 }],
    );
    expect(d.filter((x) => x.areaId === "aGEN")).toHaveLength(16);
    expect(d.find((x) => x.areaId === "aGEN")!.hours).toBeCloseTo(200);
    expect(d.find((x) => x.areaId === "aCOMP")!.hours).toBeCloseTo(40);
    const bySetting = demandBySetting(d, areas);
    expect(bySetting.get("2026-08-17|GEN")).toBeCloseTo(220);  // 200 + half of 40
    expect(bySetting.get("2026-08-17|ED")).toBeCloseTo(20);
  });

  it("layers physical, offered and booked supply per week and setting, with region splits", () => {
    const assets = [gen("a1"), gen("a2"), gen("a3", { employerId: "e2", facilityName: "Cape Fear", county: "Cumberland", ring: "Ring 2", agreementStatus: "none" })];
    const s = weeklySupply(assets, [], [{ employerId: "e1", county: "Moore", ring: "Core", settingCode: "GEN", block: "Day", shiftsPerWeek: 15, hoursPerShift: 8, learnersPerShift: 1, from: null, to: null }],
      [{ id: "b", assetId: "a1", cohortId: "c", sessionId: null, sectionIndex: 1, date: "2026-08-18", block: "Day", students: 1 }], "2026-08-17", "2026-08-23");
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ weekIso: "2026-08-17", settingCode: "GEN", physicalShifts: 63, physicalHours: 504, offeredShifts: 15, offeredHours: 120, bookedShifts: 1, bookedHours: 8 });
    expect(s[0].byRegion["county:Moore"]).toEqual({ physical: 336, offered: 120 });
    expect(s[0].byRegion["ring:Ring 2"]).toEqual({ physical: 168, offered: 0 });
  });

  it("matches demand to the layers and summarizes per setting and region", () => {
    const assets = [gen("a1")];
    const demand = weeklyDemand([{ cohortId: "c", cohort: "C", programId: "p", program: "Rad", courseId: "r", courseCode: "RAD-151", courseName: "x", termIndex: 1, students: 40, startIso: "2026-08-17", weeks: 2 }], [{ courseId: "r", serviceAreaId: "aGEN", hoursPerStudent: 10 }]);
    const supply = weeklySupply(assets, [], [{ employerId: "e1", county: "Moore", ring: "Core", settingCode: "GEN", block: "Day", shiftsPerWeek: 10, hoursPerShift: 8, learnersPerShift: 1, from: null, to: null }], [], "2026-08-17", "2026-08-30");
    const rows = matchWeekly(demand, areas, supply);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ demandHours: 200, physicalHours: 168, offeredHours: 80, shortPhysical: 32, shortOffered: 120, unbooked: 200 });
    const sum = settingSummaries(rows)[0];
    expect(sum).toMatchObject({ settingCode: "GEN", weeksWithDemand: 2, demandHours: 400, shortOfferedWeeks: 2, shortPhysicalWeeks: 2 });
    expect(sum.peakOfferedShare).toBeCloseTo(0.4);
    expect(regionRollup(rows).find((r) => r.key === "county:Moore")).toEqual({ key: "county:Moore", physical: 336, offered: 160 });
  });

  it("totals the requirement grid per student and per week", () => {
    const t = requirementTotals([{ courseId: "a", serviceAreaId: "x", hoursPerStudent: 80 }, { courseId: "a", serviceAreaId: "y", hoursPerStudent: 16 }, { courseId: "b", serviceAreaId: "x", hoursPerStudent: 35 }], [{ id: "a", weeks: 16 }, { id: "b", weeks: 10 }]);
    expect(t.perStudent).toBe(131); expect(t.byCourse.get("a")).toBe(96); expect(t.weeklyPerStudent).toBeCloseTo(6 + 3.5);
  });
});
