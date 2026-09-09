import { describe, it, expect } from "vitest";
import { rollupSequence } from "../src/lib/requirementrollup";

const items = [
  { id: "chest", category: "Chest", name: "Chest routine", mandatory: true, electiveGroup: null, minCount: null, role: null, settingCodes: "GEN,ED", notes: null },
  { id: "mobile", category: "Mobile", name: "Mobile: chest", mandatory: true, electiveGroup: null, minCount: null, role: null, settingCodes: "PORT", notes: null },
  { id: "carm", category: "Surgical", name: "C-arm procedure", mandatory: true, electiveGroup: null, minCount: null, role: null, settingCodes: "OR", notes: null },
  { id: "ugi", category: "Fluoroscopy", name: "Upper GI series", mandatory: false, electiveGroup: "fluoro", minCount: null, role: null, settingCodes: "FLUORO", notes: null },
  { id: "cpr", category: "Patient care", name: "BLS", mandatory: true, electiveGroup: null, minCount: null, role: null, settingCodes: "", notes: null },
];
const set = { id: "s", name: "ARRT", authority: "ARRT", kind: "competency", items, rules: [{ key: "mandatory", label: "Mandatory", min: 3, scope: "category != Patient care && mandatory" }, { key: "elective", label: "Elective", min: 1, scope: "!mandatory" }, { key: "patient-care", label: "Patient care", min: 1, scope: "category == Patient care" }] };
const course = (id: string, termIndex: number, settings: string[], hours: Record<string, number>, plan: Record<string, number> = {}) => ({ id, code: id, name: id, termIndex, termName: `T${termIndex}`, settings, hours, cases: {}, plan });

describe("clinical sequence roll-up to the credentialing list", () => {
  it("says which items each course first reaches, what is reachable by its end, and paces the rules across the courses that reach them", () => {
    const r = rollupSequence(set, [course("RAD-151", 1, ["GEN"], { GEN: 80 }), course("RAD-161", 2, ["GEN", "PORT"], { GEN: 100, PORT: 25 }), course("RAD-251", 3, ["GEN", "OR", "FLUORO"], { GEN: 100, OR: 20, FLUORO: 20 })]);
    expect(r.courses[0].newItems.map((i) => i.id)).toEqual(["chest", "cpr"]);
    expect(r.courses[1].newItems.map((i) => i.id)).toEqual(["mobile"]);
    expect(r.courses[2].newItems.map((i) => i.id)).toEqual(["carm", "ugi"]);
    const mand = r.courses.map((c) => c.rules.find((x) => x.key === "mandatory")!);
    expect(mand.map((m) => m.reachable)).toEqual([1, 2, 3]);
    expect(mand.map((m) => m.target)).toEqual([1, 2, 3]); // auto-paced: 3 mandatory across 3 courses that reach them
    expect(r.endGaps).toEqual([]); expect(r.unreachableRequired).toEqual([]);
    expect(r.courses[2].cumHours).toBe(345);
  });
  it("flags a required item no course reaches, and a target the sequence cannot honour", () => {
    const r = rollupSequence(set, [course("A", 1, ["GEN"], { GEN: 80 }, { mandatory: 3 }), course("B", 2, ["GEN", "PORT"], { GEN: 100, PORT: 25 })]);
    expect(r.unreachableRequired.map((i) => i.id)).toEqual(["carm"]);
    expect(r.endGaps.map((g) => g.key)).toEqual(["mandatory", "elective"]);
    expect(r.courses[0].rules.find((x) => x.key === "mandatory")!.targetOk).toBe(false); // 3 by the end of A, but only 1 reachable there
  });
  it("case sets roll planned cases up against the 120", () => {
    const st = { id: "st", name: "CCST", authority: "ARC/STSA", kind: "cases", items: [{ id: "gen", category: "General Surgery", name: "General", mandatory: true, electiveGroup: null, minCount: 30, role: null, settingCodes: "ORS", notes: null }], rules: [{ key: "total", label: "Total", min: 120 }, { key: "general-fs", label: "General FS", min: 20 }] };
    const r = rollupSequence(st, [{ id: "SUR 123", code: "SUR 123", name: "", termIndex: 2, termName: "T2", settings: ["ORS"], hours: { ORS: 336 }, cases: { ORS: 30 }, plan: {} }, { id: "SUR 135", code: "SUR 135", name: "", termIndex: 3, termName: "T3", settings: ["ORS"], hours: { ORS: 200 }, cases: { ORS: 30 }, plan: {} }]);
    expect(r.caseDesign).toEqual({ planned: 60, required: 120 });
    expect(r.endGaps.find((g) => g.key === "total")!.reachable).toBe(60);
  });
});
