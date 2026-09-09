import { describe, it, expect } from "vitest";
import { competencyProgress, caseProgress, needsBySetting, inScope } from "../src/lib/requirementprogress";

const rad = [
  { id: "cpr", category: "Patient care", name: "BLS or ACLS certified", mandatory: true, electiveGroup: null, minCount: null, role: null, settingCodes: "", notes: null },
  { id: "chest", category: "Chest & thorax", name: "Chest routine", mandatory: true, electiveGroup: null, minCount: null, role: null, settingCodes: "GEN,ED", notes: null },
  { id: "ribs", category: "Chest & thorax", name: "Ribs", mandatory: true, electiveGroup: null, minCount: null, role: null, settingCodes: "GEN,ED", notes: null },
  { id: "skull", category: "Head", name: "Skull", mandatory: true, electiveGroup: null, minCount: null, role: null, settingCodes: "GEN,ED", notes: null },
  { id: "facial", category: "Head", name: "Facial bones", mandatory: false, electiveGroup: "head", minCount: null, role: null, settingCodes: "GEN,ED", notes: null },
  { id: "ugi", category: "Fluoroscopy", name: "Upper GI series", mandatory: false, electiveGroup: "fluoro", minCount: null, role: null, settingCodes: "FLUORO", notes: null },
  { id: "sbs", category: "Fluoroscopy", name: "Small bowel series", mandatory: false, electiveGroup: "fluoro", minCount: null, role: null, settingCodes: "FLUORO", notes: null },
  { id: "myelo", category: "Fluoroscopy", name: "Myelography", mandatory: false, electiveGroup: "fluoro", minCount: null, role: null, settingCodes: "FLUORO", notes: null },
  { id: "pedchest", category: "Pediatric", name: "Pediatric: chest routine", mandatory: false, electiveGroup: "pediatric", minCount: null, role: null, settingCodes: "GEN,ED", notes: null },
];
const radRules = [
  { key: "mandatory", label: "Mandatory imaging", min: 3, of: 3, scope: "category != Patient care && mandatory" },
  { key: "elective", label: "Electives", min: 3, of: 5, scope: "!mandatory" },
  { key: "elective-head", label: "Head electives", min: 1, scope: "electiveGroup == head" },
  { key: "elective-fluoro", label: "Fluoro electives", min: 2, scope: "electiveGroup == fluoro", anyOf: ["Upper GI series", "Contrast enema"] },
  { key: "patient-care", label: "Patient care", min: 1, of: 1, scope: "category == Patient care" },
  { key: "simulation", label: "Simulations", max: 1, scope: "simulated" },
];
const log = (itemId: string, extra: Partial<{ outcome: string; role: string | null; simulated: boolean; count: number; employerId: string }> = {}) => ({ itemId, outcome: "competent", role: null, simulated: false, count: 1, date: "2026-10-01", employerId: "hosp", ...extra });

describe("ARRT competency progress", () => {
  it("scopes rules over the item list", () => {
    expect(inScope(rad[1], "category != Patient care && mandatory")).toBe(true);
    expect(inScope(rad[0], "category != Patient care && mandatory")).toBe(false);
    expect(inScope(rad[5], "electiveGroup == fluoro")).toBe(true);
  });
  it("counts mandatory, electives, section minimums and the upper-GI-or-enema condition", () => {
    const p = competencyProgress(rad, radRules, [log("cpr"), log("chest"), log("ribs"), log("skull"), log("facial"), log("sbs"), log("myelo")]);
    const by = Object.fromEntries(p.rules.map((r) => [r.key, r]));
    expect(by.mandatory.have).toBe(3); expect(by.mandatory.ok).toBe(true);
    expect(by.elective.have).toBe(3); expect(by.elective.ok).toBe(true);
    expect(by["elective-head"].ok).toBe(true);
    expect(by["elective-fluoro"].have).toBe(2); expect(by["elective-fluoro"].ok).toBe(false); // neither is an upper GI or enema
    expect(p.complete).toBe(false);
    const p2 = competencyProgress(rad, radRules, [log("cpr"), log("chest"), log("ribs"), log("skull"), log("facial"), log("sbs"), log("ugi")]);
    expect(p2.complete).toBe(true); expect(p2.missingRequired).toEqual([]);
  });
  it("an attempt that did not reach competency does not count; simulations are counted against the cap", () => {
    const p = competencyProgress(rad, radRules, [log("chest", { outcome: "attempted" }), log("ribs", { simulated: true }), log("skull", { simulated: true })]);
    expect(p.items.find((i) => i.item.id === "chest")!.met).toBe(false);
    expect(p.items.find((i) => i.item.id === "chest")!.attempts).toBe(1);
    expect(p.rules.find((r) => r.key === "simulation")!.have).toBe(2);
    expect(p.rules.find((r) => r.key === "simulation")!.ok).toBe(false);
    expect(p.missingRequired.map((i) => i.id)).toEqual(["cpr", "chest"]);
  });
  it("turns what is missing into demand by setting for the rotation planner", () => {
    const p = competencyProgress(rad, radRules, [log("cpr"), log("chest"), log("ribs"), log("skull")]);
    const n = needsBySetting(p);
    expect(n.FLUORO).toBe(0.75); // three fluoro electives still open
    expect(n.GEN).toBe(0.5); // facial bones + pediatric chest electives
  });
});

const st = [
  { id: "gen", category: "General Surgery", name: "General surgery cases", mandatory: true, electiveGroup: null, minCount: 30, role: "first scrub", settingCodes: "ORS", notes: null },
  { id: "ortho", category: "Orthopedic", name: "Orthopedic cases", mandatory: false, electiveGroup: "specialty", minCount: null, role: null, settingCodes: "ORS", notes: null },
  { id: "gu", category: "Genitourinary", name: "GU cases", mandatory: false, electiveGroup: "specialty", minCount: null, role: null, settingCodes: "ORS", notes: null },
  { id: "ent", category: "ENT", name: "ENT cases", mandatory: false, electiveGroup: "specialty", minCount: null, role: null, settingCodes: "ORS", notes: null },
  { id: "eye", category: "Eye", name: "Ophthalmic cases", mandatory: false, electiveGroup: "specialty", minCount: null, role: null, settingCodes: "ORS", notes: null },
  { id: "endo", category: "Diagnostic endoscopy", name: "Diagnostic endoscopy", mandatory: false, electiveGroup: "remaining", minCount: null, role: "second scrub", settingCodes: "ORS,ENDO", notes: null },
  { id: "vag", category: "Vaginal delivery", name: "Vaginal delivery", mandatory: false, electiveGroup: "remaining", minCount: null, role: "second scrub", settingCodes: "OB", notes: null },
];
const stRules = [
  { key: "total", label: "Total", min: 120 }, { key: "general", label: "General", min: 30 }, { key: "general-fs", label: "General FS", min: 20 }, { key: "specialty", label: "Specialty", min: 90 }, { key: "specialty-fs", label: "Specialty FS", min: 60 }, { key: "specialty-spread", label: "Spread", min: 4 }, { key: "second-scrub-max", label: "SS max", max: 40 }, { key: "observation", label: "Observation" },
];
const cases = (itemId: string, role: string, count: number) => ({ itemId, outcome: "competent", role, simulated: false, count, date: "2026-11-01", employerId: "hosp" });

describe("surgical technology case progress (CCST-7e)", () => {
  it("a complete log: 20 FS + 10 SS general, 10 FS in each of four specialties plus 20 more FS, 30 SS specialty", () => {
    const p = caseProgress(st, stRules, [cases("gen", "first scrub", 20), cases("gen", "second scrub", 10), cases("ortho", "first scrub", 25), cases("gu", "first scrub", 15), cases("ent", "first scrub", 10), cases("eye", "first scrub", 10), cases("ortho", "second scrub", 30), cases("ortho", "observation", 4)]);
    const by = Object.fromEntries(p.rules.map((r) => [r.key, r]));
    expect(by.total.have).toBe(120); expect(by["general-fs"].have).toBe(20); expect(by["specialty-fs"].have).toBe(60); expect(by["specialty-spread"].have).toBe(4);
    expect(by.observation.have).toBe(4); expect(p.complete).toBe(true);
  });
  it("first scrub cases pile up in one specialty do not satisfy the spread, and second scrub is capped at 40 with endoscopy at 10 and vaginal delivery at 5", () => {
    const p = caseProgress(st, stRules, [cases("gen", "first scrub", 20), cases("ortho", "first scrub", 60), cases("ortho", "second scrub", 50), cases("endo", "second scrub", 15), cases("vag", "second scrub", 8)]);
    const by = Object.fromEntries(p.rules.map((r) => [r.key, r]));
    expect(by["specialty-spread"].have).toBe(1); expect(by["specialty-fs"].ok).toBe(false);
    expect(by["second-scrub-max"].have).toBe(40); // 50 + 10 + 5 logged, 40 counted
    expect(by.total.have).toBe(120); expect(p.complete).toBe(false);
  });
  it("observation never counts", () => {
    const p = caseProgress(st, stRules, [cases("gen", "observation", 30)]);
    expect(p.rules.find((r) => r.key === "total")!.have).toBe(0);
    expect(p.items.find((i) => i.item.id === "gen")!.met).toBe(false);
  });
});
