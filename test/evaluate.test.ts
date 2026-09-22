import { describe, expect, it } from "vitest";
import { aggregate, checkAccess, checkAvailability, checkCapacity, checkCapability, checkRequirement, checkSetting, evaluatePlacement, summarize, recommend } from "../src/lib/evaluate";
import { onlyRule, proposeRuleFromText } from "../src/lib/settingrule";

describe("the evaluation service — explicit aggregation", () => {
  it("fail beats unknown beats pass; unknown never passes silently; all n/a is n/a", () => {
    expect(aggregate([{ status: "pass" }, { status: "unknown" }])).toBe("unknown");
    expect(aggregate([{ status: "unknown" }, { status: "fail" }])).toBe("fail");
    expect(aggregate([{ status: "pass" }, { status: "n/a" }])).toBe("pass");
    expect(aggregate([{ status: "n/a" }])).toBe("n/a");
    expect(aggregate([])).toBe("n/a");
  });
  it("13. unknown availability, explicit inheritance and zero availability are three distinct results", () => {
    expect(checkAvailability("s", "unknown", null, "family site record").status).toBe("unknown");
    expect(checkAvailability("s", "inherit", true, "asset schedule: Mon–Fri Day").status).toBe("pass");
    expect(checkAvailability("s", "inherit", false, "asset schedule: closed Sat")).toMatchObject({ status: "fail", reasons: [{ code: "UNAVAILABLE" }] });
    expect(checkAvailability("s", "unavailable", null, "site closed to students Dec 20–Jan 3")).toMatchObject({ status: "fail", reasons: [{ code: "UNAVAILABLE" }] });
    // a limit: known, explicitly unrestricted, unknown — null is never infinity and never zero
    expect(checkCapacity("s", { label: "students at once", limit: null, mode: "unknown", used: 3, adding: 1 })).toMatchObject({ status: "unknown", reasons: [{ code: "CAPACITY_UNKNOWN" }] });
    expect(checkCapacity("s", { label: "students at once", limit: null, mode: "unrestricted", used: 30, adding: 1 }).status).toBe("pass");
    expect(checkCapacity("s", { label: "students at once", limit: 4, mode: "known", used: 4, adding: 1 })).toMatchObject({ status: "fail", reasons: [{ code: "CAPACITY_EXHAUSTED" }] });
  });
  it("14. an estimated case volume and a confirmed capability each leave throughput unproven", () => {
    expect(checkCapability("s", "estimate", "Moore Regional", "operating room").status).toBe("unknown");
    expect(checkCapability("s", "inferred", "Moore Regional", "operating room")).toMatchObject({ status: "unknown", reasons: [{ code: "CAPABILITY_UNVERIFIED" }] });
    expect(checkCapability("s", "confirmed", "Moore Regional", "operating room").status).toBe("pass");
    // confirmed capability + unknown capacity → the placement is still unknown, not ready
    const e = evaluatePlacement("s", "SUR 123 §1", [checkCapability("s", "confirmed", "Moore Regional", "operating room"), checkCapacity("s", { label: "students at once", limit: null, mode: "unknown", used: 0, adding: 2 })]);
    expect(e.status).toBe("unknown");
  });
  it("20. asked vs secured access: a scenario may assume access but the result never reads secured", () => {
    expect(checkAccess("s", "secured", null, "2026-10-01", "Moore Regional").status).toBe("pass");
    expect(checkAccess("s", "asked", null, "2026-10-01", "Moore Regional")).toMatchObject({ status: "fail", reasons: [{ code: "ACCESS_UNSECURED" }] });
    const sc = checkAccess("s", "asked", null, "2026-10-01", "Moore Regional", { scenarioAllows: ["asked"] });
    expect(sc.status).toBe("unknown"); expect(sc.reasons[0]).toMatchObject({ code: "SCENARIO_ASSUMED_ACCESS", status: "info" });
    expect(checkAccess("s", "secured", "2026-09-30", "2026-10-01", "Moore Regional")).toMatchObject({ status: "fail", reasons: [{ code: "ACCESS_EXPIRED" }] });
    expect(checkAccess("s", null, null, "2026-10-01", "Moore Regional")).toMatchObject({ status: "unknown", reasons: [{ code: "ACCESS_UNKNOWN" }] });
  });
  it("requirement and setting checks: unreviewed and unresolved rules are gaps; an ineligible seat is a conflict", () => {
    expect(checkRequirement("s", null)).toMatchObject({ status: "unknown", reasons: [{ code: "SETTING_UNMAPPED" }] });
    expect(checkRequirement("s", onlyRule("BEDS")).status).toBe("pass");
    expect(checkRequirement("s", proposeRuleFromText("Acute MedSurg or LTC")!)).toMatchObject({ status: "unknown", reasons: [{ code: "REQUIREMENT_UNREVIEWED" }] });
    expect(checkRequirement("s", proposeRuleFromText("Acute & LTC")!).reasons.map((r) => r.code)).toEqual(["REQUIREMENT_UNRESOLVED", "REQUIREMENT_UNREVIEWED"]);
    expect(checkSetting("s", onlyRule("BEDS"), "LTC")).toMatchObject({ status: "fail", reasons: [{ code: "SETTING_INELIGIBLE" }] });
    expect(checkSetting("s", { ...onlyRule("BEDS"), rule: { kind: "any-of", settings: ["BEDS", "LTC"] } }, "LTC").status).toBe("pass");
  });
  it("recommendations come from the binding constraint: eligible alternatives before a new agreement; no preceptor remedy when none is required", () => {
    const e = evaluatePlacement("s", "NAS 101 §1", [checkCapacity("s", { label: "BEDS seats", limit: 2, mode: "known", used: 2, adding: 1 })]);
    const recs = recommend(summarize([e]), { untriedAlternatives: ["LTC"], rolesRequired: ["instructor"] });
    expect(recs[0].label).toMatch(/alternative setting.* LTC first/);
    expect(recs.every((r) => r.proven === false)).toBe(true);
    expect(recs.some((r) => /preceptor/i.test(r.label))).toBe(false);
  });
});
