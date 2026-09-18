import { describe, expect, it } from "vitest";
import { evidenceStatus, weakest, isSuccess, coverageHeadline, provisionalVerdict } from "../src/lib/evidence";
import { requirementCoverage, siteFit, siteFitScore } from "../src/lib/requirements";
import { caseRuleLines, serviceLineCategories } from "../src/lib/requirementrules";

// Phase 3 (docs/metrics-audit.md): evidence status drives the verdict — every headline is computed
// from the weakest required input, inference never reads as success, missing is neither zero nor available.

describe("the evidence ladder", () => {
  it("climbs inferred → confirmed → committed → scheduled → verified complete only when every lower rung holds", () => {
    expect(evidenceStatus({ provided: "inferred" })).toBe("inferred");
    expect(evidenceStatus({ provided: "estimate", agreementSecured: true, capacityKnown: true })).toBe("inferred"); // a guess is not the site's word
    expect(evidenceStatus({ provided: "confirmed" })).toBe("confirmed");
    expect(evidenceStatus({ provided: "confirmed", agreementSecured: true, capacityKnown: false })).toBe("confirmed"); // unknown capacity is not capacity
    expect(evidenceStatus({ provided: "confirmed", agreementSecured: true, capacityKnown: true })).toBe("committed");
    expect(evidenceStatus({ provided: "confirmed", agreementSecured: true, capacityKnown: true, accreditorOk: false })).toBe("confirmed");
    expect(evidenceStatus({ provided: "confirmed", agreementSecured: true, capacityKnown: true, scheduled: true })).toBe("scheduled");
    expect(evidenceStatus({ provided: "confirmed", agreementSecured: true, capacityKnown: true, scheduled: true, verifiedComplete: true })).toBe("verified-complete");
    // Scheduled without a secured agreement is still only confirmed — the weakest input wins.
    expect(evidenceStatus({ provided: "confirmed", agreementSecured: false, capacityKnown: true, scheduled: true, verifiedComplete: true })).toBe("confirmed");
  });
  it("keeps unknown and unavailable off the ladder, and success styling off inference", () => {
    expect(evidenceStatus({ provided: "unknown", agreementSecured: true, capacityKnown: true, scheduled: true })).toBe("unknown");
    expect(evidenceStatus({ provided: "none", agreementSecured: true })).toBe("unavailable");
    expect(weakest(["verified-complete", "inferred", "committed"])).toBe("inferred");
    expect(weakest(["confirmed", "unknown"])).toBe("unknown");
    expect(isSuccess("inferred")).toBe(false);
    expect(isSuccess("confirmed")).toBe(true);
  });
});

describe("the coverage headline is computed from the weakest required input", () => {
  it("reads potential, not success, while any required item rests on inference (Radiography today)", () => {
    const h = coverageHeadline({ required: 42, requiredCovered: 42, requiredConfirmed: 0 });
    expect(h.text).toBe("Potential coverage identified for 42/42. Confirmed: 0/42.");
    expect(h.tone).toBe("potential");
  });
  it("is green only when every required item is confirmed, and a gap when any has no provider", () => {
    expect(coverageHeadline({ required: 42, requiredCovered: 42, requiredConfirmed: 42 })).toMatchObject({ tone: "success", text: "Confirmed: 42/42 required experiences" });
    expect(coverageHeadline({ required: 42, requiredCovered: 40, requiredConfirmed: 40 }).tone).toBe("gap");
    expect(coverageHeadline({ required: 0, requiredCovered: 0, requiredConfirmed: 0 }).tone).toBe("none");
  });
});

const item = (id: string, category: string, o: Partial<{ mandatory: boolean; electiveGroup: string | null; settingCodes: string; role: string | null }> = {}) => ({ id, category, name: id, mandatory: o.mandatory ?? true, electiveGroup: o.electiveGroup ?? null, minCount: null, role: o.role ?? null, settingCodes: o.settingCodes ?? "ORS", notes: null });
const site = (employerId: string, seats: Record<string, number>, rank = 0) => ({ employerId, name: employerId, agreementRank: rank, seatsBySetting: seats, casesPerDay: null, driveMinutes: 20, ring: null });

describe("coverage counts confirmed apart from inferred", () => {
  const items = [item("gen", "General Surgery"), item("ortho", "Orthopedic", { mandatory: false, electiveGroup: "specialty" })];
  it("an item covered only by inference is covered but not confirmed; a VERIFIED record confirms it", () => {
    const inferred = requirementCoverage(items, [site("A", { ORS: 4 })]);
    expect(inferred[0].itemCoverage[0]).toMatchObject({ verdict: "covered", confirmedSecured: 0, unverifiedSecured: 1 });
    expect(inferred[0].requiredConfirmed).toBe(0);
    const confirmed = requirementCoverage(items, [site("A", { ORS: 4 })], [{ employerId: "A", itemId: "gen", status: "provides", annualVolume: 900, studentRole: "first scrub", source: "VERIFIED" }]);
    expect(confirmed[0].itemCoverage[0]).toMatchObject({ verdict: "covered", confirmedSecured: 1, unverifiedSecured: 0 });
    expect(confirmed[0].requiredConfirmed).toBe(1);
    // An ESTIMATE record does not confirm — it ranks with inference.
    const est = requirementCoverage(items, [site("A", { ORS: 4 })], [{ employerId: "A", itemId: "gen", status: "provides", annualVolume: null, studentRole: null, source: "ESTIMATE" }]);
    expect(est[0].itemCoverage[0].confirmedSecured).toBe(0);
  });
  it("a site's fit score separates confirmed from provided", () => {
    const fit = siteFit(site("A", { ORS: 4 }), items, [{ employerId: "A", itemId: "gen", status: "provides", annualVolume: null, studentRole: null, source: "VERIFIED" }]);
    expect(siteFitScore(fit)).toMatchObject({ required: 1, requiredProvided: 1, requiredConfirmed: 1, elective: 1, electiveProvided: 1, unverified: 1 });
  });
});

describe("Surgical Technology: service lines and rule lines", () => {
  const rules = [
    { key: "total", label: "Total surgical cases", min: 120 },
    { key: "general-fs", label: "General Surgery — First Scrub", min: 20 },
    { key: "specialty-spread", label: "Specialties with ≥ 10 First Scrub cases", min: 4 },
    { key: "service-line-confirmation", label: "Service lines", categories: ["Cardiothoracic", "Neurosurgery", "Procurement & transplant"] },
  ];
  const items = [
    item("gen", "General Surgery", { role: "first scrub" }),
    item("ct", "Cardiothoracic", { mandatory: false, electiveGroup: "specialty" }),
    item("neuro", "Neurosurgery", { mandatory: false, electiveGroup: "specialty" }),
    item("ortho", "Orthopedic", { mandatory: false, electiveGroup: "specialty" }),
    item("gu", "Genitourinary", { mandatory: false, electiveGroup: "specialty" }),
    item("ent", "ENT", { mandatory: false, electiveGroup: "specialty" }),
    item("plast", "Plastics", { mandatory: false, electiveGroup: "specialty" }),
  ];
  const OR = [site("Hospital", { ORS: 6 })];
  it("a generic OR never infers cardiothoracic, neuro or transplant — they read possible until the site confirms", () => {
    const noInfer = serviceLineCategories(rules);
    expect(noInfer).toEqual(["Cardiothoracic", "Neurosurgery", "Procurement & transplant"]);
    const cov = requirementCoverage(items, OR, [], { noInferCategories: noInfer });
    expect(cov.find((c) => c.category === "Cardiothoracic")!.itemCoverage[0].verdict).toBe("possible");
    expect(cov.find((c) => c.category === "Orthopedic")!.itemCoverage[0].verdict).toBe("covered");
    const fit = siteFit(OR[0], items, [], { noInferCategories: noInfer });
    expect(fit.find((f) => f.item.id === "ct")!.state).toBe("possible");
    expect(fit.find((f) => f.item.id === "neuro")!.state).toBe("possible");
    // Once the site confirms the service line, it provides.
    const confirmed = requirementCoverage(items, OR, [{ employerId: "Hospital", itemId: "ct", status: "provides", annualVolume: 300, studentRole: "first scrub", source: "VERIFIED" }], { noInferCategories: noInfer });
    expect(confirmed.find((c) => c.category === "Cardiothoracic")!.itemCoverage[0]).toMatchObject({ verdict: "covered", confirmedSecured: 1 });
  });
  it("puts volume, First Scrub and specialty spread on the scorecard as lines, none of them met by inference alone", () => {
    const cov = requirementCoverage(items, OR, [], { noInferCategories: serviceLineCategories(rules) });
    const lines = caseRuleLines(rules, cov, 19);
    expect(lines.map((l) => [l.key, l.verdict])).toEqual([["general-fs", "possible"], ["specialty-spread", "possible"], ["total", "unknown"]]);
    // The site confirms First Scrub for general and four specialties with volumes: the lines confirm; 120 × 19 = 2,280 needed.
    const prov = ["gen", "ortho", "gu", "ent", "plast"].map((id) => ({ employerId: "Hospital", itemId: id, status: "provides", annualVolume: 500, studentRole: "first scrub", source: "VERIFIED" }));
    const cov2 = requirementCoverage(items, OR, prov, { noInferCategories: serviceLineCategories(rules) });
    const lines2 = caseRuleLines(rules, cov2, 19);
    expect(lines2.map((l) => [l.key, l.verdict])).toEqual([["general-fs", "confirmed"], ["specialty-spread", "confirmed"], ["total", "confirmed"]]);
    expect(caseRuleLines(rules, cov2, 30).find((l) => l.key === "total")!.verdict).toBe("none"); // 2,500 < 3,600
    // Without a student count the volume line is unknown, never met.
    expect(caseRuleLines(rules, cov2, null).find((l) => l.key === "total")!.verdict).toBe("unknown");
  });
});

describe("provisional dates", () => {
  it("flags provisional while no college calendar is imported, a hand-set note otherwise, quiet when the calendar dates everything", () => {
    expect(provisionalVerdict({ calendarImported: false, termsTotal: 5, termsFromCalendar: 0, termsHandSet: 0, termsPattern: 5 }).level).toBe("provisional");
    expect(provisionalVerdict({ calendarImported: true, termsTotal: 87, termsFromCalendar: 17, termsHandSet: 69, termsPattern: 1 })).toMatchObject({ level: "hand-set" });
    expect(provisionalVerdict({ calendarImported: true, termsTotal: 5, termsFromCalendar: 5, termsHandSet: 0, termsPattern: 0 }).level).toBe("ok");
  });
});
