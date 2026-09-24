import { describe, it, expect } from "vitest";
import { candidateStarts, offeringEnd, spacedStarts, suggestedStarts } from "../src/lib/goaldates";
const isos = (o: { iso: string }[]) => o.map((x) => x.iso);
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
    const c = isos(candidateStarts(2029, CNA, cal, "2026-09-21"));
    expect(c.length).toBeGreaterThan(30);
    expect(c[0] >= "2028-10-01").toBe(true); // 11 weeks back from January 2029, at the earliest
    expect(c.every((d) => offeringEnd(d, CNA, cal).endYear === 2029)).toBe(true);
    expect(c.every((d) => new Date(d + "T00:00:00Z").getUTCDay() === 1)).toBe(true);
    expect(c).not.toContain("2028-12-25"); // a closed week is never a start
    expect(candidateStarts(2029, CNA, cal, "2026-09-21").every((o) => o.source === "monday" && o.timing === "ahead" && o.label === null && o.sessionWeeks === null)).toBe(true);
  });
  it("eight classes are spaced across the year, first and last used", () => {
    const c = isos(candidateStarts(2029, CNA, cal, "2026-09-21"));
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
    expect(c.map((o) => [o.iso, o.source])).toEqual([["2028-08-21", "pattern"]]); // the Monday on/after Aug 15 — the rule every reader of the pattern uses
    expect(isos(suggestedStarts(2030, 2, RAD, cal, "2026-09-21"))).toEqual(["2028-08-21", "2028-08-21"]); // two parallel classes share the start
  });
  it("a season the calendar codes uses its date; a season it does not still follows the pattern (coverage per season and year)", () => {
    const coded = { anchors, events: [...cal.events, { iso: "2028-01-10", endIso: null, label: "Spring classes begin", kind: "term_start", season: "Spring" }, { iso: "2028-05-22", endIso: null, label: "Summer classes begin", kind: "term_start", season: "Summer" }] as CodedEventLite[] };
    // 2028 codes Spring and Summer only: Fall 2028 is still offered, from the pattern
    expect(candidateStarts(2030, RAD, coded, "2026-09-21").map((o) => [o.iso, o.source])).toEqual([["2028-08-21", "pattern"]]);
    const fall = { anchors, events: [...coded.events, { iso: "2028-08-14", endIso: null, label: "Fall classes begin", kind: "term_start", season: "Fall" }] as CodedEventLite[] };
    expect(candidateStarts(2030, RAD, fall, "2026-09-21").map((o) => [o.iso, o.source, o.label])).toEqual([["2028-08-14", "calendar", "Fall classes begin"]]);
  });
  it("a year already under way still lists its starts — each saying it has begun or finished — and the suggestion falls back to them", () => {
    const c = candidateStarts(2026, CNA, cal, "2026-11-30");
    expect(c.length).toBeGreaterThan(30);
    expect(c.every((o) => o.timing === "started" || o.timing === "finished")).toBe(true);
    expect(c.find((o) => o.iso === "2026-01-05")?.timing).toBe("finished");
    expect(c.find((o) => o.iso === "2026-10-05")?.timing).toBe("started");
    expect(isos(suggestedStarts(2026, 2, CNA, cal, "2026-11-30"))).toEqual([c[0].iso, c[c.length - 1].iso]);
  });
  it("a continuing-education class is offered the college's own starts, and suggested the session that fits its length", () => {
    const sessions = { anchors, events: [
      { iso: "2026-08-17", endIso: "2026-12-15", label: "16 week classes", kind: "term_start", season: "Fall" },
      { iso: "2026-08-17", endIso: "2026-10-12", label: "First 8 week classes", kind: "session_start", season: "Fall" },
      { iso: "2026-08-31", endIso: "2026-12-15", label: "14 week classes", kind: "session_start", season: "Fall" },
      { iso: "2026-09-29", endIso: "2026-12-15", label: "Late Start 10 week classes", kind: "session_start", season: "Fall" },
      { iso: "2026-10-15", endIso: "2026-12-15", label: "Second 8 week classes", kind: "session_start", season: "Fall" },
      { iso: "2026-11-26", endIso: "2026-11-27", label: "Thanksgiving", kind: "holiday", season: "Fall" },
    ] as CodedEventLite[] };
    const eight = { calendarMode: "continuous" as const, terms: [{ id: "t1", index: 1, name: "Term 1", startWeek: 1, endWeek: 8 }] as TermLite[] };
    const c = candidateStarts(2026, eight, sessions, "2026-09-24");
    const cal8 = c.filter((o) => o.source === "calendar");
    // Aug 17 names the 8-week session (it fits), not the semester; Oct 15 is the second 8-week session
    expect(cal8.map((o) => [o.iso, o.label, o.sessionWeeks, o.fits, o.timing])).toEqual([
      ["2026-08-17", "First 8 week classes", 8, true, "started"], ["2026-08-31", "14 week classes", 14, false, "started"],
      ["2026-09-29", "Late Start 10 week classes", 10, false, "ahead"], ["2026-10-15", "Second 8 week classes", 8, true, "ahead"],
    ]);
    // Mondays fill the rest, never doubling a coded day; a Thursday (Oct 15) is kept as the college codes it
    expect(c.filter((o) => o.source === "monday").every((o) => new Date(o.iso + "T00:00:00Z").getUTCDay() === 1 && !cal8.some((x) => x.iso === o.iso))).toBe(true);
    expect(c.find((o) => o.iso === "2026-10-15")?.endIso).toBe("2026-12-15"); // ends with its session
    expect(isos(suggestedStarts(2026, 1, eight, sessions, "2026-09-24"))).toEqual(["2026-10-15"]); // the fitting session still ahead
    const six = { calendarMode: "continuous" as const, terms: [{ id: "t1", index: 1, name: "Term 1", startWeek: 1, endWeek: 6 }] as TermLite[] };
    expect(isos(suggestedStarts(2026, 2, six, sessions, "2026-09-24"))).toEqual(["2026-09-29", "2026-10-15"]); // no 6-week session: any session long enough, still ahead
    const fourteen = { calendarMode: "continuous" as const, terms: [{ id: "t1", index: 1, name: "Term 1", startWeek: 1, endWeek: 14 }] as TermLite[] };
    expect(suggestedStarts(2026, 1, fourteen, sessions, "2026-09-24").map((o) => [o.iso, o.timing])).toEqual([["2026-08-31", "started"]]); // nothing ahead finishes in 2026: the year's own 14-week session, already begun
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
