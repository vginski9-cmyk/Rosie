import { describe, it, expect } from "vitest";
import {
  computeQuadrant, recommendModes, configGuidance, mvdRequirement, pairing, cohortRollup,
  type Profile, type Tag,
} from "../src/lib/alignment";

// Learner M from the framework's healthcare case: single parent, retail schedule,
// benefits cliff, service motivation conditional on the economic floor.
const learnerM: Profile = {
  side: "LEARNER",
  tags: [
    { layer: "MOTIVATION", code: "B.2.b", tier: 1 }, // health benefits — driving
    { layer: "MOTIVATION", code: "B.3.a", tier: 2 },
    { layer: "MOTIVATION", code: "A.3.a", tier: 2 },
    { layer: "MOTIVATION", code: "C.2.a", tier: 2 },
    { layer: "MOTIVATION", code: "D.1.a", tier: 2, conditionalOn: "B.3.a" }, // service, conditional on economics
    { layer: "MOTIVATION", code: "F.3.a", tier: 3 },
    { layer: "CONSTRAINT", code: "G.3.b", binding: true },
    { layer: "CONSTRAINT", code: "J.4.b", binding: true },
    { layer: "CONSTRAINT", code: "H.1.c", binding: true },
    { layer: "CONSTRAINT", code: "H.6.a", binding: true },
    { layer: "CONSTRAINT", code: "I.1.c", binding: true },
    { layer: "CAPACITY", code: "Q.7" },
    { layer: "CAPACITY", code: "U.7" },
  ],
};

// An unsettled explorer with financial + geographic binds (the user's Q4 example).
const learnerQ4: Profile = {
  side: "LEARNER",
  tags: [
    { layer: "MOTIVATION", code: "A.1.b", tier: 2 }, // nothing driving
    { layer: "MOTIVATION", code: "C.1.a", tier: 3 },
    { layer: "CONSTRAINT", code: "H.1.c", binding: true },
    { layer: "CONSTRAINT", code: "I.2.b", binding: true },
  ],
};

// An open-supporter employer: no driving motive, few binds, real capacity.
const employerQ3: Profile = {
  side: "EMPLOYER",
  tags: [
    { layer: "MOTIVATION", code: "ED.1.a", tier: 2 },
    { layer: "MOTIVATION", code: "EE.2.a", tier: 3 },
    { layer: "CAPACITY", code: "EP1.a" },
    { layer: "CAPACITY", code: "EP6.c" },
  ],
};

// A strategic-but-stretched health system: pipeline driving, but preceptor + budget binds.
const employerQ2: Profile = {
  side: "EMPLOYER",
  tags: [
    { layer: "MOTIVATION", code: "EA.1.a", tier: 1 },
    { layer: "MOTIVATION", code: "EA.1.d", tier: 2 },
    { layer: "CONSTRAINT", code: "EC1.a", binding: true },
    { layer: "CONSTRAINT", code: "EC3.a", binding: true },
    { layer: "CONSTRAINT", code: "EC6.a", binding: true },
    { layer: "CAPACITY", code: "EP2.a" },
  ],
};

describe("computeQuadrant", () => {
  it("places Learner M as Q2 Aligned but Constrained (settled Tier 1, many binds)", () => {
    const q = computeQuadrant(learnerM);
    expect(q.quadrant).toBe("Q2");
    expect(q.name).toBe("Aligned but Constrained");
    expect(q.bindingFamilies.length).toBeGreaterThanOrEqual(2);
  });
  it("places the explorer as Q4 Exploring under Pressure (no Tier 1, 2 binding families)", () => {
    const q = computeQuadrant(learnerQ4);
    expect(q.quadrant).toBe("Q4");
    expect(q.reasoning[0]).toContain("no motivation is marked as driving");
  });
  it("reads exploration-driving as unsettled even when Tier 1 exists", () => {
    const p: Profile = { side: "LEARNER", tags: [{ layer: "MOTIVATION", code: "A.1.a", tier: 1 }] };
    expect(computeQuadrant(p).settled).toBe(false);
  });
  it("places the open supporter employer as Q3", () => {
    const q = computeQuadrant(employerQ3);
    expect(q.quadrant).toBe("Q3");
    expect(q.name).toBe("Open Supporter");
  });
  it("places the stretched health system as Q2 Strategic but Stretched", () => {
    expect(computeQuadrant(employerQ2).name).toBe("Strategic but Stretched");
  });
});

describe("recommendModes", () => {
  it("strikes unpaid substantive modes for an earnings-floor learner and boosts paid ones", () => {
    const recs = recommendModes(learnerM);
    const clin = recs.find((r) => r.mode.key === "CLIN")!;
    expect(clin.struck).toBe(true); // unpaid clinical struck by earnings floor
    const app = recs.find((r) => r.mode.key === "APP")!;
    expect(app.struck).toBe(false);
    expect(app.signals).toBeGreaterThan(0);
    expect(app.because.join(" ")).toContain("paid structures");
  });
  it("adds an evening/weekend variant note when daytime is unavailable", () => {
    // Remove the whole economic layer (constraints AND the driving economic motive)
    // so only the schedule constraint is left binding.
    const recs = recommendModes({
      ...learnerM,
      tags: learnerM.tags
        .filter((t) => !["H.1.c", "H.6.a"].includes(t.code))
        .map((t) => (t.code === "B.2.b" ? { ...t, tier: 3 } : t)),
    });
    const clin = recs.find((r) => r.mode.key === "CLIN")!;
    expect(clin.struck).toBe(false);
    expect(clin.variantNotes.join(" ")).toContain("evening / weekend");
  });
  it("recommends observation for explorers", () => {
    const recs = recommendModes(learnerQ4);
    expect(recs.find((r) => r.mode.key === "OBS")!.signals).toBeGreaterThan(0);
  });
  it("strikes paid modes for a no-stipend employer", () => {
    const recs = recommendModes(employerQ2);
    expect(recs.find((r) => r.mode.key === "APP")!.struck).toBe(true);
  });
});

describe("configGuidance", () => {
  it("surfaces compensation, cliff structuring, location, schedule, and capacity recognition for Learner M", () => {
    const topics = configGuidance(learnerM).map((n) => n.topic);
    expect(topics).toContain("Compensation");
    expect(topics).toContain("Compensation structure");
    expect(topics).toContain("Location");
    expect(topics).toContain("Schedule");
    expect(topics).toContain("Capacity recognition");
    expect(topics).toContain("Conditional cascade risk");
  });
  it("tells a no-headcount employer not to run conversion-intent placements", () => {
    const p: Profile = { side: "EMPLOYER", tags: [{ layer: "CONSTRAINT", code: "EC7.a", binding: true }] };
    expect(configGuidance(p).map((n) => n.topic)).toContain("Conversion honesty");
  });
});

describe("mvdRequirement", () => {
  it("requires MVD.2 when consequence-bearing leaves are tagged", () => {
    const r = mvdRequirement(learnerM);
    expect(r.tier).toBeGreaterThanOrEqual(2);
  });
  it("requires MVD.3 for high-stakes modes", () => {
    expect(mvdRequirement(learnerM, "CLIN").tier).toBe(3);
    expect(mvdRequirement(learnerM, "APP").tier).toBe(3);
  });
  it("stays MVD.1 for a clean low-stakes profile", () => {
    const p: Profile = { side: "LEARNER", tags: [{ layer: "MOTIVATION", code: "A.1.a", tier: 2 }] };
    expect(mvdRequirement(p, "OBS").tier).toBe(1);
  });
});

describe("pairing", () => {
  it("flags paid-need × no-stipend and evening × day-only gaps", () => {
    const r = pairing(learnerM, employerQ2);
    expect(r.gaps.join(" ")).toContain("no stipend budget");
    expect(r.gaps.join(" ")).toContain("day-shift only");
    expect(r.tone).toBe("caution");
  });
  it("reads a compatible pair as workable/good", () => {
    const r = pairing(learnerQ4, employerQ3);
    expect(r.headline).toContain("Q4 learner × Q3 employer");
    expect(r.tone).not.toBe("caution");
  });
});

describe("cohortRollup", () => {
  const cohort = [learnerM, learnerQ4, { ...learnerM }, { side: "LEARNER", tags: [{ layer: "MOTIVATION", code: "A.3.a", tier: 1 } as Tag] } as Profile];
  it("computes evening + paid shares and sizes support services", () => {
    const r = cohortRollup(cohort);
    expect(r.n).toBe(4);
    expect(r.eveningShare).toBeCloseTo(0.5, 5); // the two M-profiles
    expect(r.paidShare).toBeCloseTo(0.75, 5); // M ×2 + Q4 (earnings floor)
    expect(r.supportServices.find((s) => s.service.includes("Childcare"))!.count).toBe(2);
    expect(r.clinicalDesign.join(" ")).toContain("evening/weekend");
    expect(r.employerAsks.join(" ")).toContain("evening/weekend rotation");
  });
  it("tallies quadrants and driving families", () => {
    const r = cohortRollup(cohort);
    expect(r.quadrants.Q2).toBe(2);
    expect(r.drivingByFamily.find((d) => d.family === "B")!.count).toBe(2);
  });
});
