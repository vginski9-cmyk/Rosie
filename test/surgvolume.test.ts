import { describe, expect, it } from "vitest";
import { avgCasesPerDay, casesPerOrDay, caseVolumeLine, normalizeFacilityName, parseScrubRoles, joinScrubRoles } from "../src/lib/surgvolume";

describe("surgical case volume", () => {
  it("averages annual cases over the facility's operating days, else the program's case days", () => {
    expect(avgCasesPerDay({ annualSurgicalCases: 6558, operatingDaysPerYear: 250 })).toBeCloseTo(26.23, 2);
    expect(avgCasesPerDay({ annualSurgicalCases: 15035, operatingDaysPerYear: 260 })).toBeCloseTo(57.83, 2);
    expect(avgCasesPerDay({ annualSurgicalCases: 1000 }, 200)).toBe(5);
    expect(avgCasesPerDay({ annualSurgicalCases: null })).toBeNull();
  });
  it("gives cases per OR per operating day, the tracker's own metric", () => {
    expect(casesPerOrDay({ annualSurgicalCases: 12298, operatingDaysPerYear: 260, operatingRooms: 17 })).toBeCloseTo(2.78, 2);
    expect(casesPerOrDay({ annualSurgicalCases: 6558, operatingDaysPerYear: 250, operatingRooms: 0 })).toBeNull();
  });
  it("writes the one-line summary", () => {
    expect(caseVolumeLine({ annualSurgicalCases: 6558, operatingDaysPerYear: 250, operatingRooms: 4, inpatientSurgicalCases: 0, ambulatorySurgicalCases: 6558 })).toBe("6,558 cases/yr · 0 inpatient · 6,558 ambulatory · ≈ 26.2 a day over 250 operating days · 6.6 per OR-day");
    expect(caseVolumeLine({ annualSurgicalCases: null })).toBeNull();
  });
  it("matches tracker names to organizations on file", () => {
    expect(normalizeFacilityName("FirstHealth Moore Regional Hospital and Pinehurst Treatment Center")).toBe(normalizeFacilityName("FirstHealth Moore Regional Hospital & Pinehurst Treatment Center"));
    expect(normalizeFacilityName("FirstHealth Moore Regional Hospital - Richmond")).toBe(normalizeFacilityName("FirstHealth Moore Regional Hospital Richmond"));
    expect(normalizeFacilityName("The Eye Surgery Center of the Carolinas")).toBe("eye surgery center of carolinas");
  });
  it("stores several scrub roles as one list and reads old single values", () => {
    expect(joinScrubRoles(["observation", "first scrub"])).toBe("first scrub, observation");
    expect(joinScrubRoles([])).toBeNull();
    expect(parseScrubRoles("first scrub, second scrub")).toEqual(["first scrub", "second scrub"]);
    expect(parseScrubRoles("observe")).toEqual(["observation"]);
    expect(parseScrubRoles(null)).toEqual([]);
  });
});
