import { describe, it, expect } from "vitest";
import { requirementCoverage, requirementCourseCoverage, siteFit } from "../src/lib/requirements";

const items = [
  { id: "mob", category: "Mobile", name: "Mobile: chest", mandatory: true, electiveGroup: null, minCount: null, role: null, settingCodes: "PORT", notes: null },
  { id: "ugi", category: "Fluoroscopy", name: "Upper GI", mandatory: false, electiveGroup: "fluoro", minCount: null, role: null, settingCodes: "FLUORO", notes: null },
  { id: "myelo", category: "Fluoroscopy", name: "Myelography", mandatory: false, electiveGroup: "fluoro", minCount: null, role: null, settingCodes: "FLUORO", notes: null },
  { id: "cpr", category: "Patient care", name: "CPR", mandatory: true, electiveGroup: null, minCount: null, role: null, settingCodes: "", notes: null },
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
  it("infers provision from assets until a site says otherwise, and grades every item", () => {
    const A = site("A", 0, { FLUORO: 1 }, 20);
    const inferred = requirementCoverage(items, [A]).find((c) => c.category === "Fluoroscopy")!;
    expect(inferred.itemCoverage.map((i) => i.verdict)).toEqual(["covered", "covered"]);
    expect(inferred.unverified).toBe(2); // nobody confirmed either
    // The site confirms upper GIs (400 a year) and says it does no myelography.
    const provisions = [{ employerId: "A", itemId: "ugi", status: "provides", annualVolume: 400, studentRole: null, source: "VERIFIED" }, { employerId: "A", itemId: "myelo", status: "none", annualVolume: null, studentRole: null, source: "VERIFIED" }];
    const cov = requirementCoverage(items, [A], provisions).find((c) => c.category === "Fluoroscopy")!;
    expect(cov.itemCoverage.find((i) => i.item.id === "ugi")!.verdict).toBe("covered");
    expect(cov.itemCoverage.find((i) => i.item.id === "ugi")!.annualVolumeSecured).toBe(400);
    expect(cov.itemCoverage.find((i) => i.item.id === "myelo")!.verdict).toBe("none");
    expect(cov.itemCoverage.find((i) => i.item.id === "myelo")!.declined).toBe(1);
    expect(cov.electiveGaps.map((i) => i.id)).toEqual(["myelo"]);
    expect(cov.unverified).toBe(0);
    // A required item nobody provides is a mandatory gap and the category is not covered.
    const noPort = requirementCoverage(items, [A], [{ employerId: "A", itemId: "mob", status: "provides", annualVolume: null, studentRole: null, source: "ESTIMATE" }]);
    expect(noPort.find((c) => c.category === "Mobile")!.verdict).toBe("covered"); // an explicit record supplies it even without a PORT asset
    expect(requirementCoverage(items, [site("A", 0, { GEN: 3 }, 20)]).find((c) => c.category === "Mobile")!.mandatoryGaps.map((i) => i.id)).toEqual(["mob"]);
  });
  it("reads one site's fit item by item", () => {
    const fit = siteFit(site("A", 0, { FLUORO: 1 }, 20), items, [{ employerId: "A", itemId: "myelo", status: "none", annualVolume: null, studentRole: null, source: "VERIFIED" }]);
    expect(fit.map((f) => f.state)).toEqual(["unknown", "provides", "none", "n/a"]);
    expect(fit[1].basis).toBe("inferred");
  });
  it("maps a template's clinical courses onto the categories they touch", () => {
    const cov = requirementCoverage(items, [site("A", 0, { PORT: 2, FLUORO: 1 }, 20)]);
    const cc = requirementCourseCoverage(cov, [{ code: "RAD-161", name: "Clin II", settings: ["GEN", "PORT"], hours: { GEN: 130, PORT: 25 } }, { code: "RAD-171", name: "Clin III", settings: ["PORT"], hours: { PORT: 15 } }]);
    expect(cc.find((c) => c.category === "Mobile")!.courses).toEqual(["RAD-161", "RAD-171"]);
    expect(cc.find((c) => c.category === "Mobile")!.hours).toBe(40); // 25 + 15 h of portables per student across the template
    expect(cc.find((c) => c.category === "Fluoroscopy")!.uncovered).toBe(true);
  });
});
