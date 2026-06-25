import { describe, it, expect } from "vitest";
import { alignProfiles, type WblProfileInput } from "../src/lib/wbl";

const learner: WblProfileInput = {
  id: "l1",
  subjectType: "LEARNER",
  name: "Rad-Tech Cohort 2029",
  factors: [
    { layer: "MOTIVATION", label: "Living wage", weight: 1, binding: false, matchKey: "living wage" },
    { layer: "MOTIVATION", label: "Career advancement", weight: 0.8, binding: false, matchKey: "advancement" },
    { layer: "CONSTRAINT", label: "Needs daytime hours", weight: 1, binding: true, matchKey: "daytime hours" },
    { layer: "CAPACITY", label: "ARRT-eligible", weight: 1, binding: false, matchKey: "arrt eligible" },
  ],
};

const goodEmployer: WblProfileInput = {
  id: "e1",
  subjectType: "EMPLOYER",
  name: "FirstHealth",
  factors: [
    { layer: "CAPACITY", label: "Pays living wage", weight: 1, binding: false, matchKey: "living wage" },
    { layer: "CAPACITY", label: "Offers daytime shifts", weight: 1, binding: false, matchKey: "daytime hours" },
    { layer: "MOTIVATION", label: "Wants advancement-minded hires", weight: 0.6, binding: false, matchKey: "advancement" },
    { layer: "CONSTRAINT", label: "Requires ARRT eligibility", weight: 1, binding: true, matchKey: "arrt eligible" },
  ],
};

describe("alignProfiles", () => {
  it("scores a strong, feasible match highly", () => {
    const r = alignProfiles(learner, goodEmployer);
    expect(r.feasible).toBe(true);
    expect(r.unmetBinding).toHaveLength(0);
    expect(r.score).toBeGreaterThan(0.6);
  });

  it("flags an unmet binding constraint and penalizes the score", () => {
    const nightEmployer: WblProfileInput = {
      ...goodEmployer,
      id: "e2",
      factors: goodEmployer.factors.filter((f) => f.matchKey !== "daytime hours"),
    };
    const r = alignProfiles(learner, nightEmployer);
    expect(r.feasible).toBe(false);
    expect(r.unmetBinding.some((u) => u.factor.matchKey === "daytime hours")).toBe(true);
    // penalty halves the score relative to the feasible match
    const good = alignProfiles(learner, goodEmployer).score;
    expect(r.score).toBeLessThan(good);
  });

  it("reports per-layer alignment and unmatched factors", () => {
    const r = alignProfiles(learner, goodEmployer);
    expect(r.layers.MOTIVATION.score).toBeGreaterThan(0);
    expect(r.layers.CAPACITY.matched.length).toBeGreaterThanOrEqual(1);
  });

  it("discounts the score when matched factors are only inferred (low disclosure)", () => {
    const inferredEmployer = {
      ...goodEmployer,
      id: "e3",
      factors: goodEmployer.factors.map((f) => ({ ...f, disclosure: "INFERRED" as const })),
    };
    const stated = alignProfiles(learner, goodEmployer).score;
    const inferred = alignProfiles(learner, inferredEmployer).score;
    expect(inferred).toBeLessThan(stated);
    expect(alignProfiles(learner, inferredEmployer).confidence).toBeLessThan(1);
  });

  it("applies a context preset that re-weights layers", () => {
    const neutral = alignProfiles(learner, goodEmployer);
    const adult = alignProfiles(learner, goodEmployer, { label: "Adult learner", emphasis: { CONSTRAINT: 1.6 } });
    expect(adult.context).toBe("Adult learner");
    // All factors match here, so emphasis shouldn't break feasibility.
    expect(adult.feasible).toBe(true);
    expect(neutral.score).toBeGreaterThan(0);
  });
});

import { effectivePlacementCapacity } from "../src/lib/wbl";

describe("effectivePlacementCapacity (loop 2: alignment → placement)", () => {
  it("counts only alignment-feasible employer slots", () => {
    const nightEmployerProfile = { ...goodEmployer, id: "night", factors: goodEmployer.factors.filter((f) => f.matchKey !== "daytime hours") };
    const cap = effectivePlacementCapacity(learner, [
      { employerId: "e1", name: "FirstHealth", slots: 12, profile: goodEmployer },
      { employerId: "e2", name: "Night Clinic", slots: 8, profile: nightEmployerProfile },
    ]);
    expect(cap.raw).toBe(20);
    expect(cap.effective).toBe(12); // night clinic blocked by unmet daytime-hours constraint
    expect(cap.employers.find((e) => e.employerId === "e2")!.feasible).toBe(false);
  });

  it("treats employers with no profile as feasible (unknown, not blocked)", () => {
    const cap = effectivePlacementCapacity(learner, [{ employerId: "e3", name: "Unprofiled", slots: 5, profile: null }]);
    expect(cap.effective).toBe(5);
  });
});

import { recommendPlacement } from "../src/lib/wbl";

describe("recommendPlacement (per-student needs + recommendation)", () => {
  const nightProfile: WblProfileInput = { ...goodEmployer, id: "night", name: "Night Center", factors: goodEmployer.factors.filter((f) => f.matchKey !== "daytime hours") };

  it("ranks feasible employers first and picks the best as the recommendation", () => {
    const rec = recommendPlacement(learner, [
      { employerId: "night", name: "Night Center", slots: 6, profile: nightProfile },
      { employerId: "fh", name: "FirstHealth", slots: 12, profile: goodEmployer },
    ]);
    expect(rec.best?.employerId).toBe("fh");
    expect(rec.ranked[0].employerId).toBe("fh"); // feasible first
    expect(rec.ranked[1].feasible).toBe(false);   // night center blocked
    expect(rec.feasibleCount).toBe(1);
  });

  it("surfaces an unmet binding need with a support action when no feasible site meets it", () => {
    // Only the night center exists → the daytime-hours need is unmet everywhere.
    const rec = recommendPlacement(learner, [{ employerId: "night", name: "Night Center", slots: 6, profile: nightProfile }]);
    expect(rec.best).toBeNull();
    expect(rec.unmetNeeds.some((n) => n.factor.matchKey === "daytime hours")).toBe(true);
    expect(rec.actions.length).toBeGreaterThan(0);
  });

  it("reports the binding needs the best-fit employer satisfies", () => {
    const rec = recommendPlacement(learner, [{ employerId: "fh", name: "FirstHealth", slots: 12, profile: goodEmployer }]);
    expect(rec.metNeeds.some((f) => f.matchKey === "daytime hours")).toBe(true);
  });
});
