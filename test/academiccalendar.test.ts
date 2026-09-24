import { describe, it, expect } from "vitest";
import { parseAcademicCalendar, anchorsFromEvents, holidayMap, classify, knownStartsOf, weeksNamed, sessionWeeksOf, eventSpan } from "../src/lib/academiccalendar";
import { readFileSync } from "node:fs";
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

describe("parseAcademicCalendar on the colleges' own calendars", () => {
  it("splits Lenoir-style lines joined by ' / ' and reads 'Holiday Classes' as a session, not a holiday", () => {
    const text = [
      "Fall Semester 2026",
      "August 14\tRegistration Day (8:00 a.m. – 1:00 p.m.) / Last Day for 100% Refund / No Class Day",
      "August 17\t16-week & 1st 8-week Classes Begin (8:00 a.m.) / 75% Refund Period Begins (16-week classes)",
      "August 24\tLate-Start Classes Begin",
      "October 12\tMidterm / 1st 8-week Classes End (11:00 p.m.)",
      "October 19\t2nd 8-week Classes Begin",
      "November 30\tHoliday Classes Begin",
      "December 1\t10% Date for Holiday Classes / Last Day for 75% Refund for Holiday Classes",
      "December 14\tSemester Ends (11:00 p.m.)",
      "December 18\tLast Day to Process Withdrawals – Holiday Classes (2:00 p.m.)",
      "December 31\tHoliday Classes End",
    ].join("\n");
    const { events } = parseAcademicCalendar(text);
    const of = (iso: string) => events.filter((e) => e.iso === iso).map((e) => e.kind);
    expect(of("2026-08-14")).toEqual(["other", "other", "holiday"]);
    expect(of("2026-08-17")).toEqual(["term_start", "other"]);
    expect(of("2026-08-24")).toEqual(["session_start"]);
    expect(of("2026-10-12")).toEqual(["other", "other"]);
    expect(of("2026-10-19")).toEqual(["session_start"]);
    expect(of("2026-11-30")).toEqual(["session_start"]);
    expect(of("2026-12-01")).toEqual(["other", "other"]);
    expect(of("2026-12-14")).toEqual(["term_end"]);
    expect(of("2026-12-18")).toEqual(["other"]);
    expect(of("2026-12-31")).toEqual(["other"]);
  });
  it("makes the earliest 'begins' the semester start even when it lists later sessions too (Carteret)", () => {
    const text = "2026 Fall Semester\n15-week Classes Begin\tAugust 24\nClasses Begin | 16-week, 1st 10-week, & 1st 8-week courses\tAugust 17\nLast Day for Schedule Changes | Late Start 10-week courses\tSeptember 29 - October 2\nWithdrawal without Academic Penalty | Late Start 10-week courses\tNovember 13\nSemester Ends | Fall 2026\tDecember 15\n";
    const { events } = parseAcademicCalendar(text, { today: new Date("2026-09-17T00:00:00Z") });
    expect(events.map((e) => [e.iso, e.kind])).toEqual([["2026-08-17", "term_start"], ["2026-08-24", "session_start"], ["2026-09-29", "other"], ["2026-11-13", "other"], ["2026-12-15", "term_end"]]);
  });
  it("reads 'First Day of …', 'Last Day for …', 'Beginning of …' and 'End of …' (Albemarle, Roanoke-Chowan, Sandhills)", () => {
    expect(classify("First Day of 16-Week and 1st 8-Week Sessions")).toBe("term_start");
    expect(classify("First Day of 14-Week Session")).toBe("session_start");
    expect(classify("First Day for 16-week and 1st 8-week classes")).toBe("term_start");
    expect(classify("First day of the 12-week classes")).toBe("session_start");
    expect(classify("First Day to Charge in Bookstore")).toBe("other");
    expect(classify("Last Day for 16-week, 12-week, 2nd 8-week classes")).toBe("term_end");
    expect(classify("Last Day of 1st 8-week classes")).toBe("other");
    expect(classify("Beginning of Second 8 weeks")).toBe("session_start");
    expect(classify("End of First 8 weeks")).toBe("other");
    expect(classify("End of Full & Second Half Session")).toBe("term_end");
    expect(classify("Begin Summer Schedule - College Closed on Fridays")).toBe("other");
    expect(classify("Faculty Work Days (No Classes)")).toBe("holiday");
    const { events } = parseAcademicCalendar("Fall Semester 2026\nAugust 17 (Monday)\tFirst Day of Classes - Traditional & First 8 weeks\nOctober 14 (Wednesday)\tBeginning of Second 8 weeks\n");
    expect(events[0]).toMatchObject({ iso: "2026-08-17", kind: "term_start", label: "First Day of Classes Traditional & First 8 weeks" });
    expect(events[1]).toMatchObject({ iso: "2026-10-14", kind: "session_start", label: "Beginning of Second 8 weeks" });
  });
});

// The calendar's summary lines give each session its END ("First 8 week classes | Aug 13 – Oct 8"): a start
// with its length, so a class of that length can start with the session and end with it.
describe("sessions with their ends (Carteret's range lines)", () => {
  const fall = `2025-2026 Academic Calendar
2025 Fall Semester | August 13 - December 12, 2025
16 week classes | August 13, 2025 – December 12, 2025
14 week classes | August 27, 2025 – December 12, 2025
First 10 week classes | August 13, 2025 - October 24, 2025
Late Start 10 week classes | September 25, 2025 – December 12, 2025
First 8 week classes | August 13, 2025 – October 8, 2025
Second 8 week classes | October 14, 2025 – December 12, 2025
Winter term classes | November 18, 2025 - December 29, 2026
Fall Early Registration | March 12, 2025 – July 16, 2025
Event	Date(s)
Classes Begin | 16-week, 1st 10-week, & 1st 8-week courses	August 13
Last Day for Schedule Changes | 16-week, 1st 10-week, & 1st 8-week courses	August 13-18
14-week Classes Begin	August 27
Last Day for Schedule Changes | 14-week courses	August 27- September 2
1st 8-week Session End	October 8
Mid-Semester Break | No Classes	October 9-13
2nd 8-week Classes Begin	October 14
Semester Ends | Fall 2025	December 12
`;
  it("codes each range line as a start with its end; the date-only 'begins' beside it adds nothing", () => {
    const { events, warnings } = parseAcademicCalendar(fall, { today: new Date("2026-09-24T00:00:00Z") });
    const starts = events.filter((e) => e.kind === "term_start" || e.kind === "session_start").map((e) => [e.kind, e.iso, e.endIso, sessionWeeksOf(e), e.label]);
    expect(starts).toEqual([
      ["term_start", "2025-08-13", "2025-12-12", 16, "16 week classes"],
      ["session_start", "2025-08-13", "2025-10-24", 10, "First 10 week classes"],
      ["session_start", "2025-08-13", "2025-10-08", 8, "First 8 week classes"],
      ["session_start", "2025-08-27", "2025-12-12", 14, "14 week classes"],
      ["session_start", "2025-09-25", "2025-12-12", 10, "Late Start 10 week classes"],
      ["session_start", "2025-10-14", "2025-12-12", 8, "Second 8 week classes"],
    ]);
    // the registration window, the schedule-change windows and the session-end line are not starts
    expect(events.filter((e) => e.kind === "other").map((e) => e.label)).toEqual(expect.arrayContaining([expect.stringContaining("Registration"), expect.stringContaining("Schedule Changes"), expect.stringContaining("Session End")]));
    expect(events.filter((e) => e.kind === "term_end").map((e) => e.iso)).toEqual(["2025-12-12"]);
    expect(events.filter((e) => e.kind === "holiday").map((e) => [e.iso, e.endIso])).toEqual([["2025-10-09", "2025-10-13"]]);
    // a 58-week "session" is the college's typo, not a term
    expect(warnings).toEqual([expect.stringContaining("58 weeks")]);
    expect(events.some((e) => e.iso === "2025-11-18" && e.kind !== "other")).toBe(false);
  });
  it("a summer block: the semester line, its '8 weeks' line and 'Classes Begin' are one term start", () => {
    const { events } = parseAcademicCalendar("2025-2026 Academic Calendar\n2026 Summer Semester | June 1 - July 27, 2026\n8 weeks | June 1, 2026 – July 27, 2026\nEvent\tDate(s)\nClasses Begin | Summer 8-week courses\tJune 1\nSemester Ends | Summer 2026\tJuly 27\n");
    expect(events.filter((e) => e.kind !== "other").map((e) => [e.kind, e.iso, e.endIso, e.season])).toEqual([["term_start", "2026-06-01", "2026-07-27", "Summer"], ["term_end", "2026-07-27", null, "Summer"]]);
    expect(sessionWeeksOf(events[0])).toBe(8);
  });
  it("a session's length is the count its label names, else its dates, else nothing", () => {
    expect(weeksNamed("Second 8 week classes")).toBe(8); expect(weeksNamed("16-Week")).toBe(16); expect(weeksNamed("Late Start 10 weeks")).toBe(10); expect(weeksNamed("Classes begin")).toBeNull();
    expect(sessionWeeksOf({ iso: "2026-08-17", endIso: "2026-12-15", label: "16 week classes" })).toBe(16); // 17.1 calendar weeks — the college's word wins
    expect(sessionWeeksOf({ iso: "2026-11-18", endIso: "2026-12-29", label: "Winter term classes" })).toBe(6);
    expect(sessionWeeksOf({ iso: "2026-08-17", endIso: null, label: "Classes begin" })).toBeNull();
  });
  it("a paste owns the span from its first to its last coded day", () => {
    expect(eventSpan([{ iso: "2025-08-13", endIso: "2025-12-12" }, { iso: "2026-06-01", endIso: "2026-07-27" }, { iso: "2026-07-27", endIso: null }])).toEqual({ from: "2025-08-13", to: "2026-07-27" });
    expect(eventSpan([])).toBeNull();
  });
  it("the seed file carries both Carteret years, every term start with its end and every session with its length", () => {
    const { events, warnings } = parseAcademicCalendar(readFileSync("prisma/seed-data/calendars/carteret.txt", "utf8"), { today: new Date("2026-09-24T00:00:00Z") });
    expect(events.filter((e) => e.kind === "term_start").map((e) => [e.iso, e.endIso])).toEqual([["2025-08-13", "2025-12-12"], ["2026-01-07", "2026-05-08"], ["2026-06-01", "2026-07-27"], ["2026-08-17", "2026-12-15"], ["2027-01-06", "2027-05-10"], ["2027-06-01", "2027-07-27"]]);
    expect(events.filter((e) => e.kind === "term_end").map((e) => e.iso)).toEqual(["2025-12-12", "2026-05-08", "2026-07-27", "2026-12-15", "2027-05-10", "2027-07-27"]);
    const sessions = events.filter((e) => e.kind === "session_start");
    expect(sessions.length).toBeGreaterThanOrEqual(22);
    expect(sessions.every((e) => e.endIso && sessionWeeksOf(e) != null)).toBe(true);
    expect(sessions.filter((e) => sessionWeeksOf(e) === 8).map((e) => e.iso)).toEqual(["2025-08-13", "2025-10-14", "2026-01-07", "2026-03-09", "2026-08-17", "2026-10-15", "2027-01-06", "2027-03-08"]);
    const holidays = events.filter((e) => e.kind === "holiday").map((e) => [e.iso, e.endIso]);
    expect(holidays).toEqual(expect.arrayContaining([["2025-10-09", "2025-10-13"], ["2025-11-27", "2025-11-28"], ["2025-12-23", "2025-12-26"], ["2026-04-06", null], ["2026-04-07", "2026-04-10"], ["2026-11-26", "2026-11-27"]]));
    expect(warnings).toEqual([expect.stringContaining("Winter term classes")]);
  });
});
