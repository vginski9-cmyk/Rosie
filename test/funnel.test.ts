import { describe, it, expect } from "vitest";
import { sizeFunnelFromGoal, analyzeFunnel, pipelineHealth, STAGES } from "../src/lib/funnel";

describe("sizeFunnelFromGoal", () => {
  it("back-sizes the funnel from a North Star goal", () => {
    // Goal: 29 productive. Rates roughly from the Sandhills rad-tech deck.
    const rates = {
      qualified: 0.75,
      offered: 0.84,
      enrolled: 0.79,
      completing: 0.87,
      licensed: 0.9,
      placed: 0.91,
      productive: 1.0,
    };
    const sized = sizeFunnelFromGoal(29, rates);
    expect(sized.productive).toBe(29);
    expect(sized.placed).toBeGreaterThan(sized.productive - 0.0001); // 29/1.0
    expect(sized.interested).toBeGreaterThan(sized.qualified);
    // Interested should be well above the final goal.
    expect(sized.interested).toBeGreaterThan(60);
  });
});

describe("analyzeFunnel", () => {
  it("computes conversion, gap, and attainment", () => {
    const values = STAGES.map((s, i) => ({
      key: s.key,
      label: s.label,
      target: 100 - i * 10,
      actual: 90 - i * 12,
    }));
    const a = analyzeFunnel(values);
    expect(a[0].targetConversion).toBeNull(); // top stage has no prior
    expect(a[1].targetConversion).toBeCloseTo(90 / 100);
    expect(a[1].gap).toBe(values[1].actual - values[1].target);
    expect(a[1].attainment).toBeCloseTo(values[1].actual / values[1].target);
  });
});

describe("pipelineHealth", () => {
  it("flags the biggest conversion leak vs target", () => {
    const values = STAGES.map((s) => ({ key: s.key, label: s.label, target: 100, actual: 100 }));
    // Make the enrolled stage convert far worse than planned.
    const enrolledIdx = STAGES.findIndex((s) => s.key === "enrolled");
    values[enrolledIdx].actual = 30;
    const health = pipelineHealth(analyzeFunnel(values));
    expect(health.biggestLeak?.key).toBe("enrolled");
  });
});
