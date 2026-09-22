import { describe, expect, it } from "vitest";
import { coverageOfRequirements, coursePools, type CoverageRequirement, type CoverageSession } from "../src/lib/requirementcoverage";
import { onlyRule, type SettingRuleSpec } from "../src/lib/settingrule";

// The template is the source of truth: represented hours come from the course's sessions and their rotation rules.
const spec = (rule: SettingRuleSpec["rule"]): SettingRuleSpec => ({ rule, mixing: "allowed", continuity: "unknown", scope: "learner", sourceText: null, status: "reviewed", questions: [] });
const rules = new Map<string, SettingRuleSpec>([["operating room", onlyRule("ORS")], ["operating room or doctor's office", spec({ kind: "any-of", settings: ["ORS", "AMB"] })], ["physician office", onlyRule("AMB")]]);
const s = (id: string, rotationType: string | null, hours = 6, courseId = "c1"): CoverageSession => ({ id, courseId, label: id, hours, rotationType });
const req = (id: string, setting: string, extra: Partial<CoverageRequirement> = {}): CoverageRequirement => ({ id, scope: "course", courseId: "c1", unit: "hours", rule: onlyRule(setting), stated: {}, ...extra });

describe("requirement coverage from the template", () => {
  it("a session whose rotation reaches only this requirement counts its full hours; one that reaches none counts nothing", () => {
    const cov = coverageOfRequirements([req("ors", "ORS")], [s("a", "Operating room"), s("b", "Physician office"), s("c", null)], rules);
    expect(cov.get("ors")).toMatchObject({ represented: 6, unstated: 0 });
    expect(cov.get("ors")!.contributors.map((c) => c.sessionId)).toEqual(["a"]);
  });
  it("a session reaching two requirements of the course is shared: it counts for neither until a person states the split — never an even guess", () => {
    const reqs = [req("ors", "ORS"), req("amb", "AMB")];
    const cov = coverageOfRequirements(reqs, [s("or1", "Operating room"), s("both", "Operating room or Doctor's office")], rules);
    expect(cov.get("ors")).toMatchObject({ represented: 6, unstated: 1 });
    expect(cov.get("amb")).toMatchObject({ represented: 0, unstated: 1 });
    expect(cov.get("amb")!.contributors[0]).toMatchObject({ sessionId: "both", amount: null, sharedWith: ["ors"] });
    const stated = coverageOfRequirements([req("ors", "ORS", { stated: { both: 4 } }), req("amb", "AMB", { stated: { both: 2 } })], [s("or1", "Operating room"), s("both", "Operating room or Doctor's office")], rules);
    expect(stated.get("ors")).toMatchObject({ represented: 10, unstated: 0 });
    expect(stated.get("amb")).toMatchObject({ represented: 2, unstated: 0 });
  });
  it("scope is respected: a course requirement never counts another course's sessions; a program requirement counts them all; a cases requirement is never derived from hours", () => {
    const cov = coverageOfRequirements([req("ors", "ORS"), req("prog", "ORS", { scope: "program", courseId: null }), req("cases", "ORS", { unit: "cases" })], [s("a", "Operating room"), s("b", "Operating room", 8, "c2")], rules);
    expect(cov.get("ors")!.represented).toBe(6);
    expect(cov.get("prog")!.represented).toBe(14);
    expect(cov.get("cases")).toMatchObject({ represented: 0, unstated: 1 });
  });
});

describe("automatic tagging from the setting taxonomy", () => {
  it("a rotation wording nobody mapped is tagged as a PROPOSED rule so demand reaches every eligible setting; unmatched wording stays unmapped", async () => {
    const { clinicalDemandRows, UNSPECIFIED_ROTATION } = await import("../src/lib/clinicaldemand");
    const row = (rotationType: string | null) => ({ dateIso: "2026-10-05", cohortId: "co", cohort: "NA", programId: "p", program: "P", termIndex: 1, termName: "T1", courseId: "c", courseCode: "NAS 101", courseTitle: "NA", weekOfTerm: 1, computed: { Y: 1, C: 10 }, session: { id: `s-${rotationType}`, kind: "CLINICAL", number: 1, title: null, lengthHours: 6, maxStudents: 10, startTime: "07:00", rotationType } }) as unknown as import("../src/lib/capacitymodel").DatedInstance;
    const rows = clinicalDemandRows([row("Acute MedSurg or LTC"), row("Zebra care"), row(null)], []);
    expect(rows[0].eligible).toEqual(["BEDS", "LTC"]); expect(rows[0].rule?.status).toBe("proposed");
    expect(rows[1].eligible).toEqual([]); expect(rows[1].rule).toBeNull();
    expect(rows[2].rotationType).toBe(UNSPECIFIED_ROTATION); expect(rows[2].rule).toBeNull();
  });
});

describe("course rotation pools — generically tagged sessions against requirements in several settings", () => {
  const radRules = new Map<string, SettingRuleSpec>([["other (imaging rotations)", onlyRule("GEN")]]);
  const rad = (id: string, setting: string, quantity: number, reviewed = true): CoverageRequirement => ({ id, scope: "course", courseId: "rad", unit: "hours", rule: onlyRule(setting), quantity, reviewed, stated: {} });
  const sessions = Array.from({ length: 6 }, (_, i) => s(`r${i + 1}`, "Other (imaging rotations)", 8, "rad"));
  it("builds a pool rule with the requirement quantities as minimums when requirements name settings no session is tagged for", () => {
    const pools = coursePools([rad("gen", "GEN", 20), rad("ed", "ED", 12), rad("port", "PORT", 8)], sessions, radRules);
    const p = pools.get("rad")!;
    expect(p.rule.rule).toEqual({ kind: "pool", settings: ["GEN", "ED", "PORT"], minimums: [{ setting: "GEN", quantity: 20 }, { setting: "ED", quantity: 12 }, { setting: "PORT", quantity: 8 }] });
    expect(p.rule.status).toBe("reviewed"); expect(p.untagged).toEqual(["ED", "PORT"]); expect(p.hours).toBe(48); expect(p.minimums).toBe(40);
    expect(coursePools([rad("gen", "GEN", 20), rad("ed", "ED", 12, false)], sessions, radRules).get("rad")!.rule.status).toBe("needs-review");
  });
  it("no pool when every requirement setting has tagged sessions (coverage stays exact), or when a session carries a compound rule", () => {
    expect(coursePools([req("ors", "ORS", { quantity: 6 }), req("amb", "AMB", { quantity: 6 })], [s("a", "Operating room"), s("b", "Physician office")], rules).size).toBe(0);
    const compound = new Map(radRules); compound.set("either", { ...onlyRule("GEN"), rule: { kind: "any-of", settings: ["GEN", "ED"] } });
    expect(coursePools([rad("gen", "GEN", 20), rad("ed", "ED", 12)], [s("x", "either", 8, "rad")], compound).size).toBe(0);
  });
  it("allocates the pool's hours to the requirements in order — the total shows whether it suffices; nothing is invented per session", () => {
    const cov = coverageOfRequirements([rad("gen", "GEN", 20), rad("ed", "ED", 12), rad("port", "PORT", 8), rad("ct", "CT", 20)], sessions, radRules);
    expect(cov.get("gen")).toMatchObject({ represented: 20, unstated: 0, pool: { hours: 48, sessions: 6, minimums: 60, allocated: 20 } });
    expect(cov.get("ed")!.represented).toBe(12); expect(cov.get("port")!.represented).toBe(8);
    expect(cov.get("ct")!.represented).toBe(8); // 48 − 40 left
    expect(cov.get("ct")!.contributors.every((c) => c.source === "pool" && c.amount == null)).toBe(true);
  });
});

describe("course pool status", () => {
  it("comes from the requirements that shape the pool; an unreviewed any-of over settings already in it is a listed question, and a draft never adds a minimum", () => {
    const radRules = new Map<string, SettingRuleSpec>([["other (imaging rotations)", onlyRule("GEN")]]);
    const sessions = Array.from({ length: 5 }, (_, i) => s(`r${i + 1}`, "Other (imaging rotations)", 8, "rad"));
    const only = (id: string, setting: string, q: number): CoverageRequirement => ({ id, scope: "course", courseId: "rad", unit: "hours", rule: onlyRule(setting), quantity: q, reviewed: true, published: true, stated: {} });
    const comp: CoverageRequirement = { id: "comp", scope: "course", courseId: "rad", unit: "hours", rule: { ...onlyRule("GEN"), rule: { kind: "any-of", settings: ["GEN", "ED"] }, status: "needs-review" }, quantity: 6, reviewed: false, published: true, stated: {} };
    const draft: CoverageRequirement = { id: "ct", scope: "course", courseId: "rad", unit: "hours", rule: onlyRule("CT"), quantity: null, reviewed: false, published: false, stated: {} };
    const p = coursePools([only("gen", "GEN", 20), only("ed", "ED", 12), comp, draft], sessions, radRules).get("rad")!;
    expect(p.rule.status).toBe("reviewed");
    expect((p.rule.rule as { minimums: unknown[] }).minimums).toHaveLength(2);
    expect((p.rule.rule as { settings: string[] }).settings).toEqual(["GEN", "ED"]);
    expect(p.rule.questions.join(" ")).toMatch(/no stated quantity/); expect(p.rule.questions.join(" ")).toMatch(/needs? interpretation review/);
    // a requirement that adds a NEW setting shapes the pool: unreviewed → the pool needs review
    const port: CoverageRequirement = { ...comp, id: "port", rule: { ...onlyRule("PORT"), rule: { kind: "any-of", settings: ["PORT", "OR"] }, status: "needs-review" } };
    expect(coursePools([only("gen", "GEN", 20), only("ed", "ED", 12), port], sessions, radRules).get("rad")!.rule.status).toBe("needs-review");
  });
});
