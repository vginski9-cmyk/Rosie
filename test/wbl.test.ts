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
