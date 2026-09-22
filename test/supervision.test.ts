import { describe, expect, it } from "vitest";
import { supervisionFromLegacy, staffDemand, overlappingObligations, roleFinding, requires, modeFromText } from "../src/lib/supervision";
import { checkSupervision, recommend, summarize, evaluatePlacement, checkReadiness } from "../src/lib/evaluate";

// Fixture assumptions only — one instructor per ten-learner group is a synthetic policy, not a regulatory ratio.
const instructorLed = supervisionFromLegacy({ clinicalMode: "Instructor-Led Clinical Group", facultyNeeded: 1, preceptorsNeeded: 0, maxStudents: 10 });

describe("supervision — explicit roles from the legacy columns", () => {
  it("maps explicit modes without changing their meaning and never coerces an unknown mode", () => {
    expect(instructorLed.mode).toBe("instructor-led"); expect(instructorLed.status).toBe("reviewed");
    expect(requires(instructorLed, "instructor")).toBe(true); expect(requires(instructorLed, "preceptor")).toBe(false);
    const p = supervisionFromLegacy({ clinicalMode: "preceptor-led", facultyNeeded: 1 / 21, preceptorsNeeded: 1, maxStudents: 1 });
    expect(p.mode).toBe("preceptor-led"); expect(requires(p, "preceptor")).toBe(true); expect(requires(p, "instructor")).toBe(false);
    expect(p.roles.find((r) => r.role === "instructor")!.note).toMatch(/oversight/);
    const h = supervisionFromLegacy({ clinicalMode: "hybrid", facultyNeeded: 1, preceptorsNeeded: 1, maxStudents: 6 });
    expect(h.mode).toBe("combined"); expect(requires(h, "instructor") && requires(h, "preceptor")).toBe(true);
    const u = supervisionFromLegacy({ clinicalMode: "Observation only", facultyNeeded: 0, preceptorsNeeded: 0, maxStudents: 4 });
    expect(u.mode).toBe("unknown"); expect(u.status).toBe("needs-review"); expect(u.questions[0]).toMatch(/not a recognized supervision model/);
    expect(modeFromText(null)).toBe("unknown");
  });
  it("24. an instructor-led row with no staff count keeps the mode and flags the missing policy — never zero staff", () => {
    const s = supervisionFromLegacy({ clinicalMode: "instructor-led", facultyNeeded: 0, preceptorsNeeded: null, maxStudents: 10 });
    expect(s.mode).toBe("instructor-led"); expect(s.status).toBe("needs-review");
    expect(s.questions[0]).toMatch(/Instructors are required .* no count or ratio/);
    const d = staffDemand(s, 1, 10, 6);
    expect(d.concurrent.instructor).toBeNull(); expect(d.missingPolicy).toEqual(["instructor"]); expect(d.learnerHours).toBe(60);
  });
});

describe("staff demand from group structure and actual time", () => {
  it("15. ten learners, one six-hour instructor-led group: 60 learner-hours, 6 group hours, 6 instructor hours, 0 preceptor hours", () => {
    expect(staffDemand(instructorLed, 1, 10, 6)).toMatchObject({ learnerHours: 60, groupHours: 6, concurrent: { instructor: 1, preceptor: 0 }, contactHours: { instructor: 6, preceptor: 0 }, missingPolicy: [] });
  });
  it("16. two simultaneous ten-person groups: two instructors, 12 instructor hours; one person cannot cover both without a permitting policy", () => {
    expect(staffDemand(instructorLed, 2, 10, 6)).toMatchObject({ learnerHours: 120, groupHours: 12, concurrent: { instructor: 2 }, contactHours: { instructor: 12 } });
    const obs = [{ personId: "p1", date: "2026-10-01", startMin: 480, endMin: 840, groupKey: "g1", role: "instructor" as const }, { personId: "p1", date: "2026-10-01", startMin: 480, endMin: 840, groupKey: "g2", role: "instructor" as const }];
    expect(overlappingObligations(obs)).toHaveLength(1);
    expect(overlappingObligations(obs, () => true)).toHaveLength(0); // an explicit policy permits sharing
    expect(overlappingObligations([obs[0], { ...obs[1], startMin: 840, endMin: 1200 }])).toHaveLength(0); // back to back is fine
  });
  it("18. combined supervision enforces both roles independently", () => {
    const h = supervisionFromLegacy({ clinicalMode: "hybrid", facultyNeeded: 1, preceptorsNeeded: 2, maxStudents: 6 });
    expect(staffDemand(h, 1, 6, 8)).toMatchObject({ concurrent: { instructor: 1, preceptor: 2 }, contactHours: { instructor: 8, preceptor: 16 } });
    const findings = h.roles.map((r) => roleFinding(r, 6, r.role === "instructor" ? 1 : 0, r.role === "preceptor" ? 0 : 3, "Moore Regional"));
    const c = checkSupervision("shift-1", h, findings);
    expect(c.status).toBe("fail");
    expect(c.reasons.map((r) => r.code)).toEqual(["PRECEPTOR_UNAVAILABLE"]);
  });
});

describe("role-specific guidance", () => {
  it("17. instructor-led with no preceptor: no preceptor blocker or recruitment remedy; the missing instructor stays actionable", () => {
    const findings = instructorLed.roles.map((r) => roleFinding(r, 10, 0, r.role === "instructor" ? 2 : null, "Carteret Health"));
    const c = checkSupervision("shift-1", instructorLed, findings);
    expect(c.reasons.map((r) => r.code)).toEqual(["INSTRUCTOR_UNASSIGNED"]);
    expect(c.reasons[0].remediation!.label).toMatch(/Assign a qualified college instructor/i);
    const recs = recommend(summarize([evaluatePlacement("shift-1", "NAS 101 §1", [c])]), { rolesRequired: ["instructor"] });
    expect(recs.some((x) => /preceptor/i.test(x.label))).toBe(false);
    expect(recs[0].label).toMatch(/college instructor/);
  });
  it("19. qualified but unavailable, available but unassigned, expired on the placement date — three distinct reasons, none ready", () => {
    const r = instructorLed.roles[0];
    expect(roleFinding(r, 10, 1, 1, null, { conflictLabel: "NAS 102 lab 08:00–12:00" }).state).toBe("assigned-unavailable");
    expect(roleFinding(r, 10, 0, 1, null).state).toBe("unassigned");
    expect(roleFinding({ ...r, validTo: "2026-06-30" }, 10, 1, 1, null, { placementDate: "2026-09-01" }).state).toBe("expired");
    expect(roleFinding(r, 10, 0, null, null).state).toBe("unknown-qualification");
    const codes = [
      roleFinding(r, 10, 1, 1, null, { conflictLabel: "x" }), roleFinding(r, 10, 0, 1, null), roleFinding({ ...r, validTo: "2026-06-30" }, 10, 1, 1, null, { placementDate: "2026-09-01" }),
    ].map((f) => checkSupervision("s", instructorLed, [f]).reasons[0].code);
    expect(codes).toEqual(["INSTRUCTOR_UNAVAILABLE", "INSTRUCTOR_UNASSIGNED", "QUALIFICATION_EXPIRED"]);
    expect(checkSupervision("s", instructorLed, [roleFinding(r, 10, 0, null, null)])).toMatchObject({ status: "unknown", reasons: [{ code: "QUALIFICATION_UNKNOWN" }] });
  });
  it("21. two blockers on one placement count as one affected placement and two occurrences", () => {
    const c = checkSupervision("s1", instructorLed, [roleFinding(instructorLed.roles[0], 10, 0, 1, null)]);
    const e = evaluatePlacement("s1", "NAS 101 §1 Tue Day", [c, checkReadiness("s1", { holiday: "Labor Day" })]);
    const s = summarize([e]);
    expect(s.placements).toBe(1); expect(s.conflictPlacements).toBe(1); expect(s.occurrences).toBe(2);
    expect(s.byCode.map((t) => [t.code, t.placements, t.occurrences])).toEqual([["INSTRUCTOR_UNASSIGNED", 1, 1], ["HOLIDAY", 1, 1]]);
  });
});
