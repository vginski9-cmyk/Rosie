import { describe, it, expect } from "vitest";
import { computeHealthMetrics, aggregateStages } from "../src/lib/metrics";

describe("computeHealthMetrics", () => {
  const stage = { interested: 206, qualified: 171, offered: 151, enrolled: 137, completing: 96, licensed: 86, placed: 78, productive: 70 };
  it("derives the canonical adjacent-stage ratios", () => {
    const m = computeHealthMetrics(stage, 137);
    const by = Object.fromEntries(m.map((x) => [x.key, x.ratio]));
    expect(by.completionRate).toBeCloseTo(96 / 137, 4);
    expect(by.licensureRate).toBeCloseTo(86 / 96, 4);
    expect(by.productivityRate).toBeCloseTo(70 / 78, 4);
    expect(by.utilization).toBeCloseTo(70 / 137, 4);
  });
  it("flags healthy vs below benchmark", () => {
    const m = computeHealthMetrics(stage);
    const comp = m.find((x) => x.key === "completionRate")!;
    expect(comp.healthy).toBe(true); // 0.70 ≈ benchmark
  });
});

describe("aggregateStages", () => {
  it("sums stage maps across cohorts", () => {
    const agg = aggregateStages([{ enrolled: 15, completing: 13 }, { enrolled: 20, completing: 18 }]);
    expect(agg.enrolled).toBe(35);
    expect(agg.completing).toBe(31);
  });
});
