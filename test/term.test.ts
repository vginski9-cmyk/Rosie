import { describe, it, expect } from "vitest";
import { computeCohortTiming, programSpanWeeks, gradVerb, type TimingTerm } from "../src/lib/term";

// A 5-term radiography program laid out across ~76 instructional weeks (with gaps).
const RAD: TimingTerm[] = [
  { index: 1, name: "Term 1", startWeek: 1, endWeek: 16 },
  { index: 2, name: "Term 2", startWeek: 17, endWeek: 32 },
  { index: 3, name: "Term 3", startWeek: 35, endWeek: 45 }, // gap weeks 33-34
  { index: 4, name: "Term 4", startWeek: 46, endWeek: 61 },
  { index: 5, name: "Term 5", startWeek: 62, endWeek: 76 },
];
// A short 2-term certificate with no week spans set.
const CERT: TimingTerm[] = [
  { index: 1, name: "Term 1", startWeek: null, endWeek: null },
  { index: 2, name: "Term 2", startWeek: null, endWeek: null },
];

describe("program span", () => {
  it("uses the last instructional week when weeks are set (respects gaps)", () => {
    expect(programSpanWeeks(RAD)).toBe(76);
  });
  it("falls back to 16 weeks/term when weeks are unset", () => {
    expect(programSpanWeeks(CERT)).toBe(32);
  });
});

describe("computeCohortTiming", () => {
  const start = new Date("2024-08-19T00:00:00Z");
  it("is recruiting before the start date", () => {
    const t = computeCohortTiming(start, RAD, new Date("2024-06-01T00:00:00Z"));
    expect(t.phase).toBe("recruiting");
    expect(t.endDate).not.toBeNull();
  });
  it("is in-program mid-way and reports the current term", () => {
    // ~30 weeks in → week 31 → Term 2 (17–32).
    const t = computeCohortTiming(start, RAD, new Date(start.getTime() + 30 * 7 * 24 * 3600 * 1000));
    expect(t.phase).toBe("in-program");
    expect(t.currentTermIndex).toBe(2);
    expect(t.pctElapsed).toBeGreaterThan(0.3);
    expect(t.pctElapsed).toBeLessThan(0.5);
  });
  it("names the break when today lands in a gap", () => {
    // week 33-34 are a gap before Term 3.
    const t = computeCohortTiming(start, RAD, new Date(start.getTime() + 33 * 7 * 24 * 3600 * 1000));
    expect(t.phase).toBe("in-program");
    expect(t.currentTermIndex).toBeNull();
    expect(t.currentTermName).toContain("Break");
  });
  it("is graduated after the program span", () => {
    const t = computeCohortTiming(start, RAD, new Date("2026-12-01T00:00:00Z"));
    expect(t.phase).toBe("graduated");
    expect(t.pctElapsed).toBe(1);
  });
  it("is unscheduled with no start date", () => {
    expect(computeCohortTiming(null, RAD, new Date()).phase).toBe("unscheduled");
  });
});

describe("gradVerb", () => {
  const today = new Date("2026-06-26T00:00:00Z");
  it("is tense-aware", () => {
    expect(gradVerb(2025, today)).toBe("graduated");
    expect(gradVerb(2026, today)).toBe("graduating");
    expect(gradVerb(2028, today)).toBe("expected to graduate");
  });
});
