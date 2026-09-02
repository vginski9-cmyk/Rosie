import { describe, it, expect } from "vitest";
import { parseAcademicCalendar, anchorsFromEvents, holidayMap, classify, knownStartsOf } from "../src/lib/academiccalendar";
import { deriveTermStarts, nextSemesterStart, DEFAULT_ANCHORS } from "../src/lib/term";

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("parseAcademicCalendar", () => {
  it("reads a web-page style calendar with section headers and month-name dates", () => {
    const text = `
      Fall 2026
      Classes begin — Monday, August 17, 2026
      Labor Day Holiday (College Closed) — September 7, 2026
      Fall Break — October 12–13, 2026
      Thanksgiving Holiday — November 25–27, 2026
      Last day of classes — December 15, 2026
      Spring 2027
      Classes begin — January 11, 2027
      Martin Luther King Jr. Day — January 18, 2027
      Spring Break — March 8–12, 2027
      Last day of classes — May 7, 2027
      Summer 2027
      Classes begin — May 31, 2027
      Independence Day Holiday — July 5, 2027
      Last day of classes — July 30, 2027
    `;
    const { events, warnings } = parseAcademicCalendar(text);
    expect(warnings).toEqual([]);
    const starts = events.filter((e) => e.kind === "term_start").map((e) => [e.season, e.iso]);
    expect(starts).toEqual([["Fall", "2026-08-17"], ["Spring", "2027-01-11"], ["Summer", "2027-05-31"]]);
    const ends = events.filter((e) => e.kind === "term_end").map((e) => e.iso);
    expect(ends).toEqual(["2026-12-15", "2027-05-07", "2027-07-30"]);
    const breaks = events.filter((e) => e.kind === "holiday");
    expect(breaks.map((e) => [e.iso, e.endIso])).toEqual([
      ["2026-09-07", null], ["2026-10-12", "2026-10-13"], ["2026-11-25", "2026-11-27"],
      ["2027-01-18", null], ["2027-03-08", "2027-03-12"], ["2027-07-05", null],
    ]);
  });

  it("reads Excel / PDF style pastes: tab-separated cells, numeric dates, dates on the next line, year band header", () => {
    const text = [
      "2026-2027 Academic Calendar",
      "Event\tDate",
      "Fall Semester Classes Begin\t8/17/2026",
      "Labor Day (no classes)\t9/7",
      "12-Week Session Begins\t9/14",
      "Registration deadline\t9/18",
      "Winter Break (College Closed)\t12/21/2026 - 1/1/2027",
      "Spring Semester Classes Begin",
      "1/11/2027",
      "Summer Classes Begin\t5/31/2027",
    ].join("\n");
    const { events } = parseAcademicCalendar(text);
    const byLabel = (l: string) => events.find((e) => e.label.startsWith(l))!;
    expect(byLabel("Fall Semester Classes Begin")).toMatchObject({ iso: "2026-08-17", kind: "term_start", season: "Fall" });
    expect(byLabel("Labor Day")).toMatchObject({ iso: "2026-09-07", kind: "holiday" });
    expect(byLabel("12-Week Session Begins")).toMatchObject({ iso: "2026-09-14", kind: "session_start" });
    expect(byLabel("Registration deadline")).toMatchObject({ kind: "other" });
    expect(byLabel("Winter Break")).toMatchObject({ iso: "2026-12-21", endIso: "2027-01-01", kind: "holiday" });
    expect(byLabel("Spring Semester Classes Begin")).toMatchObject({ iso: "2027-01-11", kind: "term_start", season: "Spring" });
    expect(byLabel("Summer Classes Begin")).toMatchObject({ iso: "2027-05-31", kind: "term_start", season: "Summer" });
  });

  it("keeps only the earliest 'begins' per semester as the semester start", () => {
    const { events } = parseAcademicCalendar("Fall 2026\nSecond 8-week classes begin Oct 12\nClasses begin Aug 17\n");
    expect(events.map((e) => [e.iso, e.kind])).toEqual([["2026-08-17", "term_start"], ["2026-10-12", "session_start"]]);
  });

  it("classifies labels", () => {
    expect(classify("First day of classes")).toBe("term_start");
    expect(classify("Last day of classes")).toBe("term_end");
    expect(classify("Thanksgiving Break — no classes")).toBe("holiday");
    expect(classify("Last day to drop with a W")).toBe("other");
    expect(classify("Commencement")).toBe("other");
    expect(classify("Late-start classes begin")).toBe("session_start");
  });

  it("derives the semester pattern from coded starts and drives term dates from the known dates", () => {
    const { events } = parseAcademicCalendar("Fall classes begin August 17, 2026\nSpring classes begin January 11, 2027\nSummer classes begin May 31, 2027\nFall classes begin August 16, 2027");
    const anchors = anchorsFromEvents(events, DEFAULT_ANCHORS);
    // Aug 17 2026 and Aug 16 2027 are both the 3rd Monday of August → anchor Aug 15;
    // Jan 11 2027 is the 2nd Monday of January → Jan 8; May 31 2027 the 5th Monday → May 29.
    expect(anchors.fallStart).toBe("08-15");
    expect(anchors.springStart).toBe("01-08");
    expect(anchors.summerStart).toBe("05-29");
    const known = knownStartsOf(events);
    const a = { ...anchors, knownStarts: known };
    expect(iso(nextSemesterStart(new Date("2026-08-01T00:00:00Z"), a))).toBe("2026-08-17");
    const starts = deriveTermStarts("2026-08-17", [16, 16, 10, 16], a).map(iso);
    expect(starts).toEqual(["2026-08-17", "2027-01-11", "2027-05-31", "2027-08-16"]);
    // Beyond the imported years the pattern carries on (a Monday in Jan 2028).
    const s5 = deriveTermStarts("2026-08-17", [16, 16, 10, 16, 16], a).map(iso)[4];
    expect(s5.startsWith("2028-01")).toBe(true);
    expect(new Date(s5 + "T00:00:00Z").getUTCDay()).toBe(1);
  });

  it("expands breaks into a holiday map", () => {
    const { events } = parseAcademicCalendar("Spring Break — March 8–12, 2027\nMLK Day — January 18, 2027");
    const m = holidayMap(events);
    expect(Object.keys(m).sort()).toEqual(["2027-01-18", "2027-03-08", "2027-03-09", "2027-03-10", "2027-03-11", "2027-03-12"]);
    expect(m["2027-03-10"]).toMatch(/Spring Break/);
  });
});
