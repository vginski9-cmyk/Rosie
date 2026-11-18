import { describe, expect, it } from "vitest";
import { semesterOfWeek, weeksBySemester } from "../src/lib/weeksemester";

// A calendar week belongs to one semester for every class on the staffing chart (2026-11-18): the college's coded
// start whose week it falls in, else the anchor pattern — never the season of the class's own term.
const mondays = (from: string, n: number) => Array.from({ length: n }, (_, i) => new Date(new Date(from + "T00:00:00Z").getTime() + i * 7 * 86400000).toISOString().slice(0, 10));
const rowsOf = (cohortId: string, from: string, n: number) => mondays(from, n).map((mondayIso) => ({ cohortId, mondayIso }));
// Carteret's anchors and coded term starts (its 2026–27 calendar: Spring 2027 opens Wednesday, January 6; Summer June 1).
const CARTERET = { springStart: "01-06", summerStart: "06-01", fallStart: "08-13", knownStarts: ["2026-08-17", "2027-01-06", "2027-06-01"] };

describe("the semester a calendar week belongs to", () => {
  it("a January class that runs twenty weeks and a May class share the same May weeks under Spring, then Summer from the college's summer start week — every Monday drawn once", () => {
    const rows = [...rowsOf("jan-20wk", "2027-01-11", 20), ...rowsOf("may-6wk", "2027-05-10", 6)];
    const bands = weeksBySemester(rows, () => CARTERET);
    expect(bands.map((b) => `${b.sem} ${b.year}`)).toEqual(["Spring 2027", "Summer 2027"]);
    const seen = new Map<string, number>();
    for (const b of bands) for (const w of b.weeks.keys()) seen.set(w, (seen.get(w) ?? 0) + 1);
    expect([...seen.values()].every((n) => n === 1)).toBe(true);
    const spring = bands[0].weeks, summer = bands[1].weeks;
    expect([...spring.keys()]).toEqual(mondays("2027-01-11", 20));
    expect([...summer.keys()]).toEqual(["2027-05-31", "2027-06-07", "2027-06-14"]);
    // Both classes sit in the May weeks of Spring and in the Summer weeks alike.
    expect(spring.get("2027-05-10")!.map((r) => r.cohortId).sort()).toEqual(["jan-20wk", "may-6wk"]);
    expect(spring.get("2027-05-24")!.map((r) => r.cohortId).sort()).toEqual(["jan-20wk", "may-6wk"]);
    expect(summer.get("2027-05-31")!.map((r) => r.cohortId).sort()).toEqual(["may-6wk"]);
  });
  it("a Friday-opening semester takes its first week from the coded start's week (Roanoke-Chowan's Spring 2027, Friday January 8)", () => {
    const rc = { springStart: "01-08", summerStart: "05-15", fallStart: "08-15", knownStarts: ["2026-08-17", "2027-01-08", "2027-05-17"] };
    expect(semesterOfWeek("2027-01-04", rc)).toEqual({ year: "2027", sem: "Spring" });
    expect(semesterOfWeek("2026-12-28", rc)).toEqual({ year: "2026", sem: "Fall" });
    expect(semesterOfWeek("2027-05-17", rc)).toEqual({ year: "2027", sem: "Summer" });
    expect(semesterOfWeek("2027-05-10", rc)).toEqual({ year: "2027", sem: "Spring" });
  });
  it("a November class has Fall weeks and Spring weeks (a Lenoir evening class, November to March)", () => {
    const lenoir = { springStart: "01-06", summerStart: "05-15", fallStart: "08-15", knownStarts: ["2026-08-17", "2027-01-06", "2027-05-17"] };
    const bands = weeksBySemester(rowsOf("nov-20wk", "2026-11-02", 20), () => lenoir);
    expect(bands.map((b) => [`${b.sem} ${b.year}`, b.weeks.size])).toEqual([["Fall 2026", 9], ["Spring 2027", 11]]);
    expect([...bands[1].weeks.keys()][0]).toBe("2027-01-04"); // the week of the coded Wednesday start
  });
  it("orders bands by year, then Spring, Summer, Fall, and skips undated rows", () => {
    const rows = [...rowsOf("a", "2027-09-06", 2), ...rowsOf("b", "2027-06-07", 1), ...rowsOf("c", "2028-01-10", 1), ...rowsOf("d", "2027-02-01", 1), { cohortId: "e", mondayIso: null }];
    expect(weeksBySemester(rows, () => CARTERET).map((b) => `${b.sem} ${b.year}`)).toEqual(["Spring 2027", "Summer 2027", "Fall 2027", "Spring 2028"]);
  });
});
