import { describe, it, expect } from "vitest";
import {
  BENCHMARK_RATES,
  buildLadder,
  capacityFromNorthStar,
  backHalfYield,
  utilization,
  roundLadder,
  defaultTermRetention,
} from "../src/lib/northstar";

describe("northstar ladder", () => {
  it("reproduces the workbook's benchmark cohort from capacity 49", () => {
    const l = roundLadder(buildLadder(49, BENCHMARK_RATES));
    expect(l.interested).toBe(74); // 49 × 1.5 = 73.5 → 74
    expect(l.qualified).toBe(61); // 49 × 1.25 = 61.25
    expect(l.offered).toBe(54); // 49 × 1.1 = 53.9
    expect(l.enrolled).toBe(49); // 49 × 1.0
    expect(l.completing).toBe(34); // 49 × 0.7 = 34.3
    expect(l.licensed).toBe(31); // 34.3 × 0.9 = 30.87
    expect(l.placed).toBe(28); // 30.87 × 0.9 = 27.78
    expect(l.productive).toBe(25); // 27.78 × 0.9 = 25.0
  });

  it("sizes capacity backward from a North-Star productive goal", () => {
    const cap = capacityFromNorthStar(25, BENCHMARK_RATES);
    expect(Math.round(cap)).toBe(49);
    // round-trip: building from that capacity lands the goal
    const l = buildLadder(cap, BENCHMARK_RATES);
    expect(Math.round(l.productive)).toBe(25);
  });

  it("backHalfYield is the product of the chained yields", () => {
    const y = backHalfYield(BENCHMARK_RATES);
    expect(y).toBeCloseTo(1.0 * 0.7 * 0.9 * 0.9 * 0.9, 6);
  });

  it("builds a per-term retention curve (term 1 = enrolled)", () => {
    const l = buildLadder(49, BENCHMARK_RATES, [1, 0.94, 0.94, 0.94]);
    expect(Math.round(l.terms[0])).toBe(49);
    expect(l.terms).toHaveLength(4);
    expect(l.terms[1]).toBeCloseTo(49 * 0.94, 6);
    expect(l.terms[2]).toBeCloseTo(49 * 0.94 * 0.94, 6);
  });

  it("utilization is productive ÷ enrollment capacity (the 51% benchmark)", () => {
    expect(utilization(25, 49)).toBeCloseTo(0.5102, 3);
    expect(utilization(25, 0)).toBeNull();
    expect(utilization(25, null)).toBeNull();
  });

  it("defaultTermRetention starts at 1.0 then declines", () => {
    const r = defaultTermRetention(5);
    expect(r[0]).toBe(1);
    expect(r[1]).toBe(0.94);
    expect(r).toHaveLength(5);
  });
});
