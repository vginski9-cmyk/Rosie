import { describe, it, expect } from "vitest";
import { sessionDate, weekMonday } from "../src/lib/term";
import { buildInstances, type SessionInput, type CohortCalendarInput } from "../src/lib/capacitymodel";
import { parseAcademicCalendar } from "../src/lib/academiccalendar";
import { sectionSpans, sectionOfSeat } from "../src/lib/sections";
import { thinTerms, deriveCohortTargets } from "../src/lib/pipeline";
import { fmt } from "../src/lib/format";
import { weeklyUtilization } from "../src/lib/rooms";
import { forFamily, type AssetLite } from "../src/lib/assetmap";

// Regression tests for the defects the 2026-09-19 audit found (docs/metrics-audit.md §17).

const session = (o: Partial<SessionInput> & { id: string }): SessionInput => ({
  kind: "CLASS", number: 1, title: null, deliveryMode: null, location: null, lengthHours: 3, maxStudents: 24, facultyNeeded: 1, facultyContactPolicy: null, supportStaffNeeded: 0, supportContactPolicy: null,
  week: 1, dayOfWeek: "Mon", startTime: "09:00", notes: null, preceptorsNeeded: 0, preceptorContactPolicy: null, rotationType: null, clinicalMode: null, ...o,
});
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

describe("dating sessions in a term that does not start on a Monday", () => {
  it("keeps every session on its own weekday: week 1 is the calendar week containing the first day", () => {
    const tue = { termStart: "2027-05-25" }; // Tuesday (Sandhills Summer 2027)
    expect(iso(weekMonday(tue, 1))).toBe("2027-05-24");
    expect(iso(sessionDate(tue, 1, "Thu"))).toBe("2027-05-27"); // a Thursday, not Friday
    expect(iso(sessionDate(tue, 1, "Fri"))).toBe("2027-05-28"); // a Friday, not Saturday
    expect(iso(sessionDate(tue, 2, "Tue"))).toBe("2027-06-01");
    const fri = { termStart: "2027-01-08" }; // Friday (Roanoke-Chowan Spring 2027)
    expect(iso(sessionDate(fri, 1, "Fri"))).toBe("2027-01-08");
    expect(iso(sessionDate(fri, 2, "Thu"))).toBe("2027-01-14");
  });
  it("does not hold a session before the term's first day: a Monday session in a Tuesday-start week is undated and flagged", () => {
    expect(sessionDate({ termStart: "2027-05-25" }, 1, "Mon")).toBeNull();
    const rows = buildInstances({
      cohortId: "c", cohort: "C", programId: "p", program: "P", enrollmentByTerm: { 1: 20 }, termStartByIndex: { 1: new Date("2027-05-25T00:00:00Z") }, termEndByIndex: { 1: "2027-09-10" }, termWeeksByIndex: { 1: 16 }, holidays: {},
      courses: [{ code: "X", title: "X", courseId: "x", termIndex: 1, termName: "T1", sessions: [session({ id: "m1", week: 1, dayOfWeek: "Mon" }), session({ id: "t1", week: 1, dayOfWeek: "Tue" }), session({ id: "m2", week: 2, dayOfWeek: "Mon" })] }],
    } as CohortCalendarInput);
    const by = Object.fromEntries(rows.map((r) => [r.session.id, r]));
    expect(by.m1.dateIso).toBeNull(); expect(by.m1.beforeTerm).toBe(true);
    expect(by.t1.dateIso).toBe("2027-05-25");
    expect(by.m2.dateIso).toBe("2027-05-31"); expect(by.m2.beforeTerm).toBeUndefined();
  });
  it("anchors a course's own window at the template week it begins in", () => {
    const a = { termStart: "2027-08-16", courseStart: "2027-10-11", courseFirstWeek: 9 };
    expect(iso(sessionDate(a, 9, "Mon"))).toBe("2027-10-11");
    expect(iso(sessionDate(a, 10, "Wed"))).toBe("2027-10-20");
  });
});

describe("holidays", () => {
  it("uses only the college's imported calendar once one exists; the US default list stands in only when none is coded", () => {
    const base: CohortCalendarInput = {
      cohortId: "c", cohort: "C", programId: "p", program: "P", enrollmentByTerm: { 1: 20 }, termStartByIndex: { 1: new Date("2026-11-02T00:00:00Z") }, termEndByIndex: { 1: "2026-12-18" }, termWeeksByIndex: { 1: 6 }, holidays: {},
      courses: [{ code: "X", title: "X", courseId: "x", termIndex: 1, termName: "T1", sessions: [session({ id: "v", week: 2, dayOfWeek: "Wed" })] }], // Nov 11, 2026 — Veterans Day
    } as CohortCalendarInput;
    expect(buildInstances(base)[0].holiday).toBe("Veterans Day"); // no calendar coded
    expect(buildInstances({ ...base, holidays: { "2026-11-26": "Thanksgiving" } })[0].holiday).toBeNull(); // the college's calendar does not close Nov 11
    expect(buildInstances({ ...base, holidays: { "2026-11-11": "Veterans Day (observed)" } })[0].holiday).toBe("Veterans Day (observed)");
  });
  it("parses a weekday in parentheses without leaving '( )' in the label", () => {
    const { events } = parseAcademicCalendar("Fall 2026\nOctober 12-13 (Monday-Tuesday) Fall Break\nNovember 26 (Thursday) Thanksgiving Holiday\n");
    const labels = events.map((e) => e.label);
    expect(labels.some((l) => /\(\s*[-–]?\s*\)/.test(l))).toBe(false);
    expect(labels).toContain("Fall Break");
  });
});

describe("one rule for seats and sections", () => {
  it("deals seats evenly and maps every seat to one section", () => {
    expect(sectionSpans(41, 4).map((s) => s.seats)).toEqual([11, 10, 10, 10]);
    expect(sectionSpans(41, 4).map((s) => s.start)).toEqual([1, 12, 22, 32]);
    expect(sectionOfSeat(15, 41, 4)).toBe(2);
    expect(sectionOfSeat(41, 41, 4)).toBe(4);
    expect(sectionOfSeat(1, 3, 2)).toBe(1); expect(sectionOfSeat(3, 3, 2)).toBe(2);
    expect(sectionOfSeat(45, 41, 4)).toBe(4); // a roster seat past the dealt total still lands somewhere
  });
});

describe("one thinning rule", () => {
  it("the workbook chain and thinTerms agree, and the last term sits one slice above completing", () => {
    const rates = { interestedSurplus: 1.5, qualifiedSurplus: 1.2, offeredSurplus: 1.1, enrollmentRate: 0.85, completionRate: 0.87, licensureRate: 0.9, placementRate: 0.9, productivityRate: 0.9 };
    const t = deriveCohortTargets(29, rates, 5);
    expect(thinTerms(t.terms[0], rates.completionRate, 5)).toEqual(t.terms);
    expect(t.terms[4]).toBeCloseTo(t.completing + (t.terms[0] - t.completing) / 5, 9);
  });
});

describe("small correctness guards", () => {
  it("never prints −0", () => {
    expect(fmt.atLeast(0)).toBe("0");
    expect(fmt.atLeast(-0)).toBe("0");
    expect(fmt.atLeastPhrase(0)).toBe("0");
  });
  it("room utilization is the busiest week, not every term's hours added together", () => {
    const spans = [{ dayOfWeek: "Mon", openTime: "08:00", closeTime: "18:00" }];
    const wk = 7 * 86400000, t0 = Date.UTC(2026, 7, 17), t1 = Date.UTC(2027, 0, 11);
    const fall = { dayOfWeek: "Mon", startTime: "09:00", lengthHours: 3, weekStartMs: t0, weekEndMs: t0 + 15 * wk };
    const spring = { dayOfWeek: "Mon", startTime: "09:00", lengthHours: 2, weekStartMs: t1, weekEndMs: t1 + 15 * wk };
    expect(weeklyUtilization(spans, [fall, spring]).booked).toBe(3);
    expect(weeklyUtilization(spans, [fall, { ...fall, lengthHours: 4 }]).booked).toBe(7);
    expect(weeklyUtilization(spans, [{ dayOfWeek: "Mon", startTime: "09:00", lengthHours: 5 }]).booked).toBe(5); // no window: every week
  });
  it("an asset is secured for a job family by that family's agreement, not the employer umbrella", () => {
    const a = { id: "a", externalId: null, employerId: "e", facilityName: "F", settingCode: "AMB", setting: "Ambulatory", assetType: "Room", assetNumber: 1, operatingRule: "Weekday Day", days: "Mon", shiftBlocks: "Day", hoursPerShift: 8, serves: null, learnersPerShift: 1, preceptorsPerShift: 1, dataSource: "VERIFIED", status: "active", agreementStatus: "secured", agreementByFamily: { rad: "secured", surg: "asked" } } as AssetLite;
    expect(forFamily([a], "surg")[0].agreementStatus).toBe("asked");
    expect(forFamily([a], "rad")[0].agreementStatus).toBe("secured");
    expect(forFamily([a], "other")[0].agreementStatus).toBe("secured"); // no family row: the umbrella stands in
    expect(forFamily([a], null)[0]).toBe(a);
  });
});
