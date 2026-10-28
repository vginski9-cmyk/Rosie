import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { NURSING_ROTATIONS, NURSING_SETTINGS, SETTING_KITS, nursingAreaOf } from "../prisma/seed-kits";
import { SETTING_PRESETS } from "../src/lib/settingPresets";
import { proposeRuleFromText, eligibleSettings } from "../src/lib/settingrule";
import { EXTRA_ROTATIONS } from "../prisma/seed-sandhills-sites";

// The nursing clinical vocabulary every RN family outside Sandhills now shares: rotation → setting, the kits a
// partner site of each setting supplies, and the seed branch that reads them.

describe("nursing clinical vocabulary", () => {
  it("maps each rotation wording to one preset setting, and leaves an unknown wording unmapped (never a guess)", () => {
    const presets = new Set(SETTING_PRESETS.map((p) => p[0]));
    for (const [rotation, setting] of NURSING_ROTATIONS) { expect(presets.has(setting), rotation).toBe(true); expect(nursingAreaOf(rotation)).toBe(setting); expect(nursingAreaOf(rotation.toUpperCase())).toBe(setting); }
    expect(nursingAreaOf("Operating Room")).toBeNull();
    expect(nursingAreaOf(null)).toBeNull();
    expect(nursingAreaOf("Med-Surg or Critical Care")).toBe("BEDS");
    expect(new Set(NURSING_ROTATIONS.map(([r]) => r)).size).toBe(NURSING_ROTATIONS.length);
  });
  it("every setting kit carries its preset's wording, a learner count and a liaison title; the family's settings are all kitted", () => {
    for (const [code, kit] of Object.entries(SETTING_KITS)) {
      const preset = SETTING_PRESETS.find((p) => p[0] === code)!;
      expect([kit.code, kit.setting, kit.assetType]).toEqual([code, preset[1], preset[2]]);
      expect(kit.learners).toBeGreaterThan(0); expect(kit.liaisonTitle).toMatch(/RN/); expect(kit.unitCategory.length).toBeGreaterThan(0);
    }
    for (const s of NURSING_SETTINGS) expect(SETTING_KITS[s], s).toBeDefined();
    // Inpatient and long-term-care units take an instructor-led group; community settings a precepted pair.
    expect([SETTING_KITS.BEDS.learners, SETTING_KITS.BEDS.preceptors, SETTING_KITS.PH.learners, SETTING_KITS.PH.preceptors]).toEqual([8, 0, 2, 1]);
  });
  it("Sandhills' rotation join carries the shared nursing rows plus its own", () => {
    const sandhills = new Map(EXTRA_ROTATIONS.map(([r, s]) => [r, s]));
    for (const [r, s] of NURSING_ROTATIONS) expect(sandhills.get(r)).toBe(s);
    expect(sandhills.get("Emergency")).toBe("ED"); expect(sandhills.get("Adult Care")).toBe("ALF");
  });
  it("the rule proposer reads obstetric wording as OB and the precepted capstone as med-surg or critical care", () => {
    expect(proposeRuleFromText("OB / Maternity")?.rule).toEqual({ kind: "only", setting: "OB" });
    expect(proposeRuleFromText("Labor and delivery")?.rule).toEqual({ kind: "only", setting: "OB" });
    const cap = proposeRuleFromText("Med-Surg or Critical Care")!;
    expect(cap.rule.kind).toBe("any-of"); expect(eligibleSettings(cap.rule)).toEqual(["BEDS", "ICU"]);
  });
  it("the seed's clinical-model loader has a nursing branch and the requirement set is registered", () => {
    const seed = readFileSync(new URL("../prisma/seed.ts", import.meta.url), "utf8");
    expect(seed).toMatch(/const isRn = !isCna && \/nursing\|prelicensure \(rn\|bsn\)\/i\.test\(fam\.name\)/);
    expect(seed).toMatch(/rotationPrimarySetting: "BEDS"/);
    expect(seed).toMatch(/of NURSING_ROTATIONS\) \{/);
    expect(readFileSync(new URL("../prisma/seed-geo-requirements.ts", import.meta.url), "utf8")).toMatch(/nursing\.json/);
    const set = JSON.parse(readFileSync(new URL("../prisma/templates/requirements/nursing.json", import.meta.url), "utf8")) as { kind: string; rules: unknown[]; items: { settingCodes: string; mandatory: boolean }[] };
    expect([set.kind, set.rules]).toEqual(["competency", []]); // the Board sets no hour minimums — none invented
    const presets = new Set(SETTING_PRESETS.map((p) => p[0]));
    for (const it of set.items) for (const code of it.settingCodes.split(",")) expect(presets.has(code), code).toBe(true);
    expect(set.items.some((it) => it.settingCodes === "BEDS,ICU")).toBe(true);
  });
});
