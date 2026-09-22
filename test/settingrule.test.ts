import { describe, expect, it } from "vitest";
import { validateSettingRule, allocateObligation, judgeExposure, describeRule, proposeRuleFromText, openQuestions, parseRuleSpec, ruleSpecJson, onlyRule, type SettingRuleSpec } from "../src/lib/settingrule";

// Synthetic fixture policies — not claims about any real program's requirements.
const spec = (rule: SettingRuleSpec["rule"], o: Partial<SettingRuleSpec> = {}): SettingRuleSpec => ({ rule, mixing: "allowed", continuity: "unknown", scope: "learner", sourceText: null, status: "reviewed", questions: [], ...o });

describe("setting rules — validation (server-side, bounded, no expressions)", () => {
  it("accepts the five shapes and rejects the rest", () => {
    expect(validateSettingRule({ kind: "only", setting: "BEDS" })).toEqual([]);
    expect(validateSettingRule({ kind: "any-of", settings: ["BEDS", "LTC"] })).toEqual([]);
    expect(validateSettingRule({ kind: "all-of", components: [{ setting: "BEDS", quantity: 20 }, { setting: "LTC", quantity: 20 }] }, undefined, 60)).toEqual([]);
    expect(validateSettingRule({ kind: "pool", settings: ["ORS", "AMB"], minimums: [{ setting: "ORS", quantity: 20 }] }, undefined, 60)).toEqual([]);
    expect(validateSettingRule({ kind: "n-of", count: 2, settings: ["BEDS", "LTC", "ICU"], minimumEach: 10 }, undefined, 60)).toEqual([]);
    expect(validateSettingRule({ kind: "expr", code: "A || B" })[0].message).toMatch(/unsupported rule kind/);
    expect(validateSettingRule({ kind: "only", setting: "NOPE" })[0].message).toMatch(/unrecognized setting/);
    expect(validateSettingRule({ kind: "pool", settings: ["ORS"], minimums: [{ setting: "ORS", quantity: -5 }] }).some((e) => /zero or more/.test(e.message))).toBe(true);
    expect(validateSettingRule({ kind: "pool", settings: ["ORS", "AMB"], minimums: [{ setting: "ORS", quantity: 70 }] }, undefined, 60).some((e) => /exceed the total/.test(e.message))).toBe(true);
    expect(validateSettingRule({ kind: "pool", settings: ["ORS"], minimums: [{ setting: "AMB", quantity: 5 }] }).some((e) => /outside the pool/.test(e.message))).toBe(true);
    expect(validateSettingRule({ kind: "n-of", count: 4, settings: ["BEDS", "LTC"], minimumEach: 1 }).some((e) => /cannot require 4/.test(e.message))).toBe(true);
    expect(validateSettingRule({ kind: "any-of", settings: [{ kind: "only", setting: "BEDS" }, "LTC"] }).length).toBeGreaterThan(0); // no nesting
  });
  it("round-trips a spec through JSON and never invents a rule from bad JSON", () => {
    const s = spec({ kind: "any-of", settings: ["BEDS", "LTC"] }, { mixing: "unknown", sourceText: "Acute MedSurg or LTC", status: "proposed" });
    expect(parseRuleSpec(ruleSpecJson(s))).toEqual(s);
    expect(parseRuleSpec("{not json")).toBeNull();
    expect(parseRuleSpec(JSON.stringify({ mixing: "allowed" }))).toBeNull();
  });
});

describe("allocation — the obligation once, against what each setting offers", () => {
  it("1. approved A OR B, 60 hours, mixing allowed; only B has room → all 60 in B, no hospital-only bottleneck, demand stays 60", () => {
    const r = allocateObligation(spec({ kind: "any-of", settings: ["BEDS", "LTC"] }), 60, { BEDS: 0, LTC: 80 });
    expect(r.feasible).toBe("yes"); expect(r.allocation).toEqual({ LTC: 60 }); expect(r.total).toBe(60);
  });
  it("2. the same wording unreviewed keeps its questions — no claim that B is approved", () => {
    const p = proposeRuleFromText("Acute MedSurg or LTC")!;
    expect(p.rule).toEqual({ kind: "any-of", settings: ["BEDS", "LTC"] });
    expect(p.status).toBe("proposed"); expect(p.mixing).toBe("unknown");
    expect(openQuestions(p).join(" ")).toMatch(/approved substitute/);
    expect(openQuestions(p).join(" ")).toMatch(/split across/);
    expect(openQuestions(p).join(" ")).toMatch(/confirmed this interpretation/);
  });
  it("3. A AND B with 20 each: 40 hours only in A cannot satisfy B", () => {
    const s = spec({ kind: "all-of", components: [{ setting: "BEDS", quantity: 20 }, { setting: "LTC", quantity: 20 }] });
    expect(allocateObligation(s, 40, { BEDS: 40, LTC: 0 })).toMatchObject({ feasible: "no", reasons: [{ code: "SETTING_MINIMUM_UNMET" }] });
    expect(judgeExposure(s, 40, { BEDS: 40 })).toMatchObject({ status: "unmet", reasons: [{ code: "SETTING_MINIMUM_UNMET" }] });
    expect(allocateObligation(s, 40, { BEDS: 20, LTC: 20 })).toMatchObject({ feasible: "yes", allocation: { BEDS: 20, LTC: 20 } });
  });
  it("4. “A & B” without quantities asks for them — never an invented equal split", () => {
    const p = proposeRuleFromText("Acute & LTC")!;
    expect(p.rule).toEqual({ kind: "all-of", components: [{ setting: "BEDS", quantity: null }, { setting: "LTC", quantity: null }] });
    const r = allocateObligation(p, 60, { BEDS: 60, LTC: 60 });
    expect(r.feasible).toBe("unknown"); expect(r.reasons[0].code).toBe("REQUIREMENT_UNRESOLVED");
    expect(openQuestions(p).join(" ")).toMatch(/quantity required in BEDS/);
  });
  it("5. 60 total, at least 20 A, balance A/B: 20 A + 40 B passes; 10 A + 50 B fails; demand remains 60", () => {
    const s = spec({ kind: "pool", settings: ["ORS", "AMB"], minimums: [{ setting: "ORS", quantity: 20 }] });
    expect(judgeExposure(s, 60, { ORS: 20, AMB: 40 })).toMatchObject({ status: "met", credited: 60 });
    expect(judgeExposure(s, 60, { ORS: 10, AMB: 50 })).toMatchObject({ status: "unmet", reasons: [{ code: "SETTING_MINIMUM_UNMET" }] });
    const a = allocateObligation(s, 60, { ORS: 25, AMB: 100 });
    expect(a.feasible).toBe("yes"); expect(Object.values(a.allocation).reduce((n, v) => n + v, 0)).toBe(60); expect(a.allocation.ORS).toBeGreaterThanOrEqual(20);
    expect(validateSettingRule(s.rule, undefined, 60)).toEqual([]);
  });
  it("6. OR with no mixing and 30 available at each of A/B cannot combine them for a 60-hour single-setting obligation", () => {
    const s = spec({ kind: "any-of", settings: ["BEDS", "LTC"] }, { mixing: "forbidden" });
    expect(allocateObligation(s, 60, { BEDS: 30, LTC: 30 })).toMatchObject({ feasible: "no", reasons: [{ code: "MIXING_FORBIDDEN" }] });
    expect(allocateObligation(s, 60, { BEDS: 30, LTC: 60 })).toMatchObject({ feasible: "yes", allocation: { LTC: 60 } });
    // mixing unknown: not proven feasible, not proven infeasible
    expect(allocateObligation({ ...s, mixing: "unknown" }, 60, { BEDS: 30, LTC: 30 }).feasible).toBe("unknown");
  });
  it("7. same-site continuity is a constraint on the rotation, not a setting synonym", () => {
    const s = spec({ kind: "only", setting: "BEDS" }, { continuity: "one-site" });
    expect(judgeExposure(s, 60, { BEDS: 60 }, 2)).toMatchObject({ status: "unmet", reasons: [{ code: "CONTINUITY_UNMET" }] });
    expect(judgeExposure(s, 60, { BEDS: 60 }, 1).status).toBe("met");
  });
  it("8. any two of three with explicit minimums needs two DISTINCT settings — one setting twice over is not enough", () => {
    const s = spec({ kind: "n-of", count: 2, settings: ["BEDS", "LTC", "ICU"], minimumEach: 10 });
    expect(judgeExposure(s, 40, { BEDS: 40 })).toMatchObject({ status: "unmet", reasons: [{ code: "SETTING_MINIMUM_UNMET" }] });
    expect(judgeExposure(s, 40, { BEDS: 30, ICU: 10 }).status).toBe("met");
    expect(allocateObligation(s, 40, { BEDS: 100, LTC: 5, ICU: 5 })).toMatchObject({ feasible: "no", reasons: [{ code: "SETTING_MINIMUM_UNMET" }] });
    expect(allocateObligation(s, 40, { BEDS: 100, LTC: 12 }).feasible).toBe("yes");
    expect(allocateObligation(spec({ kind: "n-of", count: 2, settings: ["BEDS", "LTC", "ICU"], minimumEach: null }), 40, { BEDS: 100, LTC: 100 }).feasible).toBe("unknown");
  });
  it("22. a site with two tags but one undifferentiated exposure gets no double credit against additive requirements", () => {
    // The seat's OWN setting is what is credited: 8 hours on a BEDS asset at a site that also has LTC credits BEDS only.
    const s = spec({ kind: "all-of", components: [{ setting: "BEDS", quantity: 8 }, { setting: "LTC", quantity: 8 }] });
    const j = judgeExposure(s, 16, { BEDS: 8 });
    expect(j.credited).toBe(8); expect(j.status).toBe("unmet"); expect(j.reasons.map((r) => r.code)).toContain("SETTING_MINIMUM_UNMET");
  });
  it("hours in an ineligible setting do not count, and a single-setting rule reads plainly", () => {
    const s = onlyRule("ORS");
    expect(judgeExposure(s, 10, { ORS: 6, AMB: 4 })).toMatchObject({ status: "unmet", credited: 6, reasons: [{ code: "SETTING_INELIGIBLE" }, { code: "SHORT" }] });
    expect(describeRule(s.rule)).toBe("ORS only");
    expect(describeRule({ kind: "pool", settings: ["ORS", "AMB"], minimums: [{ setting: "ORS", quantity: 20 }] })).toBe("at least 20 in ORS, the rest in ORS or AMB");
  });
  it("a lexical alias finds a setting but never settles substitutability", () => {
    const p = proposeRuleFromText("Long-Term Care")!;
    expect(p.rule).toEqual({ kind: "only", setting: "LTC" }); expect(p.status).toBe("proposed");
    expect(proposeRuleFromText("Med-Surg / LTC / ICU")!.rule).toEqual({ kind: "any-of", settings: ["BEDS", "LTC", "ICU"] });
    expect(proposeRuleFromText("something nobody recognises")).toBeNull();
  });
});
