import { describe, it, expect } from "vitest";
import { requirementCoverage, requirementCourseCoverage } from "../src/lib/requirements";

const items = [
  { category: "Mobile", name: "Mobile: chest", mandatory: true, electiveGroup: null, minCount: null, role: null, settingCodes: "PORT", notes: null },
  { category: "Fluoroscopy", name: "Upper GI", mandatory: false, electiveGroup: "fluoro", minCount: null, role: null, settingCodes: "FLUORO", notes: null },
  { category: "Patient care", name: "CPR", mandatory: true, electiveGroup: null, minCount: null, role: null, settingCodes: "", notes: null },
];
const site = (employerId: string, agreementRank: number, seats: Record<string, number>, driveMinutes: number) => ({ employerId, name: employerId, agreementRank, seatsBySetting: seats, casesPerDay: null, driveMinutes, ring: null });

describe("requirement coverage", () => {
  it("says which categories a secured site can supply, which only an asked site can, and which nobody can", () => {
    const cov = requirementCoverage(items, [site("A", 0, { PORT: 2 }, 20), site("B", 1, { FLUORO: 1 }, 50)]);
    expect(cov.find((c) => c.category === "Mobile")!.verdict).toBe("covered");
    expect(cov.find((c) => c.category === "Mobile")!.nearestSecuredMinutes).toBe(20);
    expect(cov.find((c) => c.category === "Fluoroscopy")!.verdict).toBe("asked-only");
    expect(cov.find((c) => c.category === "Patient care")!.verdict).toBe("n/a");
    expect(requirementCoverage(items, [site("A", 0, { GEN: 2 }, 20)]).find((c) => c.category === "Mobile")!.verdict).toBe("none");
  });
  it("maps a template's clinical courses onto the categories they touch", () => {
    const cov = requirementCoverage(items, [site("A", 0, { PORT: 2, FLUORO: 1 }, 20)]);
    const cc = requirementCourseCoverage(cov, [{ code: "RAD-161", name: "Clin II", settings: ["GEN", "PORT"], hours: { GEN: 130, PORT: 25 } }, { code: "RAD-171", name: "Clin III", settings: ["PORT"], hours: { PORT: 15 } }]);
    expect(cc.find((c) => c.category === "Mobile")!.courses).toEqual(["RAD-161", "RAD-171"]);
    expect(cc.find((c) => c.category === "Mobile")!.hours).toBe(40); // 25 + 15 h of portables per student across the template
    expect(cc.find((c) => c.category === "Fluoroscopy")!.uncovered).toBe(true);
  });
});
