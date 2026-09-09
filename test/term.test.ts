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

describe("computeCohortTiming with real per-term dates", () => {
  const FIVE: TimingTerm[] = [
    { index: 1, name: "First Fall", startWeek: 1, endWeek: 16 },
    { index: 2, name: "First Spring", startWeek: 1, endWeek: 16 },
    { index: 3, name: "First Summer", startWeek: 1, endWeek: 10 },
    { index: 4, name: "Second Fall", startWeek: 1, endWeek: 16 },
    { index: 5, name: "Second Spring", startWeek: 1, endWeek: 16 },
  ];
  const realStarts = [
    new Date("2025-08-18"), new Date("2026-01-12"), new Date("2026-05-18"),
    new Date("2026-08-17"), new Date("2027-01-11"),
  ];
  it("ends in the cohort's grad year (not 74 weeks after start)", () => {
    const t = computeCohortTiming(realStarts[0], FIVE, new Date("2026-06-26"), realStarts);
    expect(t.endDate!.getUTCFullYear()).toBe(2027); // last term Jan 2027 + 16wk → ~May 2027
    expect(t.endDate!.getUTCMonth()).toBeGreaterThanOrEqual(3);
  });
  it("reports the real current term from the calendar", () => {
    const t = computeCohortTiming(realStarts[0], FIVE, new Date("2026-06-26"), realStarts);
    expect(t.phase).toBe("in-program");
    expect(t.currentTermName).toBe("First Summer");
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

import { beyondTerm, fitWeek, weekMonday, sessionDate, calendarWeeksBetween } from "../src/lib/term";
describe("the week rule: template week w = calendar week w; weeks past the term are undated, never smeared", () => {
  const term = { termStart: "2027-05-31", termEnd: "2027-08-06", templateWeeks: 16 }; // a 10-week summer
  it("counts the term's calendar weeks", () => { expect(calendarWeeksBetween("2027-05-31", "2027-08-06")).toBe(10); });
  it("weeks 1–10 land on their own Monday", () => {
    expect(weekMonday(term, 1)?.toISOString().slice(0, 10)).toBe("2027-05-31");
    expect(weekMonday(term, 10)?.toISOString().slice(0, 10)).toBe("2027-08-02");
    expect(sessionDate(term, 3, "Wed")?.toISOString().slice(0, 10)).toBe("2027-06-16");
  });
  it("weeks 11–16 are beyond the term: no date", () => {
    expect(beyondTerm(11, 16, 10)).toBe(true); expect(beyondTerm(10, 16, 10)).toBe(false); expect(beyondTerm(11, 16, 16)).toBe(false);
    expect(weekMonday(term, 11)).toBeNull(); expect(sessionDate(term, 16, "Mon")).toBeNull();
  });
  it("a full-length term is untouched", () => {
    const fall = { termStart: "2026-08-17", termEnd: "2026-12-04", templateWeeks: 16 };
    expect(weekMonday(fall, 16)?.toISOString().slice(0, 10)).toBe("2026-11-30");
  });
  it("course windows clamp to the term's last week", () => { expect(fitWeek(14, 16, 10)).toBe(10); expect(fitWeek(4, 16, 10)).toBe(4); expect(fitWeek(14, 16, 16)).toBe(14); });
  it("a course with its own window counts weeks from its first session week", () => {
    expect(weekMonday({ ...term, courseStart: "2027-06-14", courseFirstWeek: 3 }, 5)?.toISOString().slice(0, 10)).toBe("2027-06-28");
  });
});
