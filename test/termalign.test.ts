import { describe, it, expect } from "vitest";
import { alignOffering, endYearOf, type CodedEventLite, type TermLite } from "../src/lib/termalign";

const anchors = { springStart: "01-08", summerStart: "05-28", fallStart: "08-15" };
const TERMS: TermLite[] = [
  { id: "t1", index: 1, name: "Term 1", startWeek: 1, endWeek: 16 },
  { id: "t2", index: 2, name: "Term 2", startWeek: 17, endWeek: 32 },
  { id: "t3", index: 3, name: "Term 3", startWeek: 33, endWeek: 40 },
];
// A coded college calendar: Fall 2026 is 15 weeks + exams, Spring 2027 16 weeks, Summer 2027 8 weeks.
const EVENTS: CodedEventLite[] = [
  { iso: "2026-08-17", endIso: null, label: "Fall classes begin", kind: "term_start", season: "Fall" },
  { iso: "2026-10-12", endIso: null, label: "2nd 8-week session begins", kind: "session_start", season: "Fall" },
  { iso: "2026-11-25", endIso: "2026-11-27", label: "Thanksgiving break", kind: "holiday", season: "Fall" },
  { iso: "2026-12-11", endIso: null, label: "Last day of fall classes", kind: "term_end", season: "Fall" },
  { iso: "2027-01-11", endIso: null, label: "Spring classes begin", kind: "term_start", season: "Spring" },
  { iso: "2027-05-07", endIso: null, label: "Spring semester ends", kind: "term_end", season: "Spring" },
  { iso: "2027-05-24", endIso: null, label: "Summer classes begin", kind: "term_start", season: "Summer" },
  { iso: "2027-07-23", endIso: null, label: "Summer session ends", kind: "term_end", season: "Summer" },
];

describe("alignOffering", () => {
  it("puts every term on the coded semester starts and ends", () => {
    const a = alignOffering({ startIso: "2026-08-17", terms: TERMS, courses: [], anchors, events: EVENTS });
    expect(a.terms.map((t) => [t.startIso, t.endIso, t.startSource, t.endSource])).toEqual([
      ["2026-08-17", "2026-12-11", "calendar", "calendar"],
      ["2027-01-11", "2027-05-07", "calendar", "calendar"],
      ["2027-05-24", "2027-07-23", "calendar", "calendar"],
    ]);
    expect(a.terms[0].semester).toBe("Fall 2026");
    expect(a.terms[0].calendarWeeks).toBe(17); // Aug 17 → Dec 11 spans 17 calendar weeks (Thanksgiving inside)
    expect(endYearOf(a.terms)).toBe(2027);
    expect(a.warnings).toEqual([]); // a semester a little longer than the template is never a problem
  });

  it("snaps a chosen start near a coded semester start onto it and says so", () => {
    const a = alignOffering({ startIso: "2026-08-24", terms: TERMS, courses: [], anchors, events: EVENTS });
    expect(a.terms[0].startIso).toBe("2026-08-17");
    expect(a.terms[0].movedFrom).toBe("2026-08-24");
    expect(a.warnings.some((w) => /moved to the coded semester start/.test(w))).toBe(true);
  });

  it("keeps a chosen start that is a coded later session", () => {
    const a = alignOffering({ startIso: "2026-10-12", terms: TERMS, courses: [], anchors, events: EVENTS });
    expect(a.terms[0].startIso).toBe("2026-10-12");
    expect(a.terms[0].startSource).toBe("calendar");
  });

  it("falls back to the semester pattern and template weeks with no coded calendar", () => {
    const a = alignOffering({ startIso: "2026-08-17", terms: TERMS, courses: [], anchors, events: [] });
    expect(a.terms.map((t) => [t.startIso, t.startSource, t.endSource])).toEqual([
      ["2026-08-17", "chosen", "template"],
      ["2027-01-11", "pattern", "template"], // Monday on/after Jan 8
      ["2027-05-31", "pattern", "template"], // Monday on/after May 28
    ]);
    expect(a.terms[0].endIso).toBe("2026-12-04"); // Friday of week 16
    expect(a.warnings).toEqual([]);
  });

  it("warns when the calendar gives a term fewer weeks than the template plans", () => {
    const short = [...EVENTS.filter((e) => e.iso !== "2026-12-11"), { iso: "2026-11-20", endIso: null, label: "Fall ends", kind: "term_end", season: "Fall" }];
    const a = alignOffering({ startIso: "2026-08-17", terms: TERMS, courses: [], anchors, events: short });
    expect(a.terms[0].endIso).toBe("2026-11-20");
    expect(a.warnings.some((w) => /Term 1: the template plans 16 weeks but Fall 2026 gives only 14/.test(w))).toBe(true);
    // The next term still waits for the template's 16 weeks to pass.
    expect(a.terms[1].startIso).toBe("2027-01-11");
  });

  it("without a coded end, a term still ends with its semester — a 16-week summer template ends in early August, not September", () => {
    const sixteen: TermLite[] = [TERMS[0], TERMS[1], { id: "t3", index: 3, name: "Term 3", startWeek: 33, endWeek: 48 }];
    const a = alignOffering({ startIso: "2026-08-17", terms: sixteen, courses: [], anchors, events: [] });
    const summer = a.terms.find((t) => t.semester.startsWith("Summer"))!;
    expect(summer.startIso).toBe("2027-05-31");
    expect(summer.endIso).toBe("2027-08-06"); // the Friday at least nine days before Fall 2027 starts (Aug 16)
    expect(summer.endSource).toBe("pattern");
    expect(summer.calendarWeeks).toBe(10);
    expect(a.warnings.some((w) => /Summer 2027 gives only 10/.test(w))).toBe(true);
    // Fall and spring fit their 16 weeks, so the template end stands.
    expect(a.terms[0].endIso).toBe("2026-12-04");
    expect(a.terms[0].endSource).toBe("template");
  });

  it("keeps typed term dates and aligns the rest around them", () => {
    const a = alignOffering({ startIso: "2026-08-17", terms: TERMS, courses: [], anchors, events: EVENTS, manual: { t2: { startIso: "2027-01-19", endIso: null } } });
    expect(a.terms[1].startIso).toBe("2027-01-19");
    expect(a.terms[1].startSource).toBe("manual");
    expect(a.terms[1].endIso).toBe("2027-05-07"); // the coded end still applies
    expect(a.terms[2].startIso).toBe("2027-05-24");
  });

  it("gives shorter courses their own window and snaps to a coded later session", () => {
    const courses = [
      { id: "c-full", termId: "t1", code: "RAD 110", name: "Full term", sessions: Array.from({ length: 16 }, (_, i) => ({ week: i + 1 })) },
      { id: "c-late", termId: "t1", code: "RAD 199", name: "2nd 8 weeks", sessions: Array.from({ length: 8 }, (_, i) => ({ week: i + 9 })) },
      { id: "c-early", termId: "t1", code: "RAD 100", name: "First 8 weeks", sessions: Array.from({ length: 8 }, (_, i) => ({ week: i + 1 })) },
    ];
    const a = alignOffering({ startIso: "2026-08-17", terms: TERMS, courses, anchors, events: EVENTS });
    expect(a.courses.map((c) => c.courseId)).toEqual(["c-late", "c-early"]);
    const late = a.courses.find((c) => c.courseId === "c-late")!;
    expect(late.startIso).toBe("2026-10-12"); // coded "2nd 8-week session begins" (week 9 would be Oct 12 anyway)
    expect(late.snappedTo).toBe("2nd 8-week session begins");
    expect(late.endIso).toBe("2026-12-04");
    const early = a.courses.find((c) => c.courseId === "c-early")!;
    expect([early.startIso, early.endIso]).toEqual(["2026-08-17", "2026-10-09"]);
  });
});
