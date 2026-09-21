import { describe, it, expect } from "vitest";
import { candidateStarts, offeringEnd, spacedStarts, suggestedStarts } from "../src/lib/goaldates";
import type { CodedEventLite, TermLite } from "../src/lib/termalign";

const anchors = { springStart: "01-08", summerStart: "05-28", fallStart: "08-15" };
const cal = { anchors, events: [
  { iso: "2028-11-22", endIso: "2028-11-24", label: "Thanksgiving", kind: "holiday", season: "Fall" },
  { iso: "2028-12-25", endIso: "2029-01-01", label: "Winter break", kind: "holiday", season: "Spring" },
  { iso: "2029-12-25", endIso: "2030-01-01", label: "Winter break", kind: "holiday", season: "Spring" },
] as CodedEventLite[] };
// An 11-week Nurse Aide class, continuing education: it runs from whatever Monday it starts.
const CNA = { calendarMode: "continuous" as const, terms: [{ id: "t1", index: 1, name: "Term 1", startWeek: 1, endWeek: 11 }] as TermLite[] };
// A five-term AAS starting each Fall (Fall · Spring · Summer · Fall · Spring).
const RAD = { calendarMode: "semester" as const, terms: [
  { id: "a", index: 1, name: "Term 1", startWeek: 1, endWeek: 16, semester: "Fall" }, { id: "b", index: 2, name: "Term 2", startWeek: 17, endWeek: 32, semester: "Spring" },
  { id: "c", index: 3, name: "Term 3", startWeek: 33, endWeek: 40, semester: "Summer" }, { id: "d", index: 4, name: "Term 4", startWeek: 41, endWeek: 56, semester: "Fall" }, { id: "e", index: 5, name: "Term 5", startWeek: 57, endWeek: 72, semester: "Spring" },
] as TermLite[] };

describe("goal-year starts", () => {
  it("a continuing-education class for 2029 starts on Mondays that finish inside 2029 — never in 2027", () => {
    const c = candidateStarts(2029, CNA, cal, "2026-09-21");
    expect(c.length).toBeGreaterThan(30);
    expect(c[0] >= "2028-10-01").toBe(true); // 11 weeks back from January 2029, at the earliest
    expect(c.every((d) => offeringEnd(d, CNA, cal).endYear === 2029)).toBe(true);
    expect(c.every((d) => new Date(d + "T00:00:00Z").getUTCDay() === 1)).toBe(true);
    expect(c).not.toContain("2028-12-25"); // a closed week is never a start
  });
  it("eight classes are spaced across the year, first and last used", () => {
    const c = candidateStarts(2029, CNA, cal, "2026-09-21");
    const s = spacedStarts(c, 8);
    expect(s.length).toBe(8);
    expect(s[0]).toBe(c[0]); expect(s[7]).toBe(c[c.length - 1]);
    expect(new Set(s).size).toBe(8);
    expect(spacedStarts(c, 1)).toEqual([c[0]]);
    expect(spacedStarts([], 3)).toEqual([]);
  });
  it("the end beside a start is the calendar-aligned end, closed weeks included", () => {
    const e = offeringEnd("2028-12-11", CNA, cal);
    expect(e.endIso).toBe("2029-03-02"); // 11 open weeks, the winter-break week skipped → Friday Mar 2
    expect(e.endYear).toBe(2029);
  });
  it("a Fall-start AAS graduating in 2030 starts in Fall 2028 — and only in a Fall", () => {
    const c = candidateStarts(2030, RAD, cal, "2026-09-21");
    expect(c).toEqual(["2028-08-15"]);
    expect(suggestedStarts(2030, 2, RAD, cal, "2026-09-21")).toEqual(["2028-08-15", "2028-08-15"]); // two parallel classes share the start
  });
  it("a year no start can still reach gives no suggestion", () => {
    expect(candidateStarts(2026, CNA, cal, "2026-11-30")).toEqual([]);
  });
});

import { computeCohortTiming } from "../src/lib/term";
describe("an offering ends on its last term's real last day", () => {
  const terms = [{ index: 1, name: "Term 1", startWeek: 1, endWeek: 16 }];
  it("the calendar's end wins over start + weeks", () => {
    const t = computeCohortTiming(new Date("2029-09-10T00:00:00Z"), terms, new Date("2026-09-21T00:00:00Z"), [new Date("2029-09-10T00:00:00Z")], [new Date("2029-12-28T00:00:00Z")]);
    expect(t.endDate?.toISOString().slice(0, 10)).toBe("2029-12-28");
    expect(t.phase).toBe("recruiting");
    const u = computeCohortTiming(new Date("2029-09-10T00:00:00Z"), terms, new Date("2026-09-21T00:00:00Z"), [new Date("2029-09-10T00:00:00Z")]);
    expect(u.endDate?.toISOString().slice(0, 10)).toBe("2029-12-31"); // without a real end: the Monday after the last week, as before
  });
});
