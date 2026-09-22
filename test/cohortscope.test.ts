import { describe, it, expect } from "vitest";
import { gradYearOf, cohortStatusOn, cohortSpan, cohortsOverlapping, academicYearStart, plannedWindow, NOT_ARCHIVED } from "../src/lib/cohortscope";

const co = (id: string, starts: (string | null)[], ends?: (string | null)[]) => ({ id, termStartByIndex: Object.fromEntries(starts.map((s, i) => [i + 1, s])), termEndByIndex: ends ? Object.fromEntries(ends.map((e, i) => [i + 1, e])) : undefined });

describe("which cohorts count — one rule", () => {
  it("the class year is read from the name, never guessed", () => {
    expect(gradYearOf("Class of 2026")).toBe(2026); expect(gradYearOf("Class of 2028 · 2nd class")).toBe(2028);
    expect(gradYearOf("Aug 2026 · Kinston")).toBe(2026); expect(gradYearOf("Cohort 39")).toBeNull(); expect(gradYearOf(null)).toBeNull();
  });
  it("status follows the dates: graduated once the last day has passed, running once the first has, else planned", () => {
    expect(cohortStatusOn("2024-08-19", "2026-05-01", "2026-09-22")).toBe("completed");
    expect(cohortStatusOn("2025-08-18", "2027-05-11", "2026-09-22")).toBe("active");
    expect(cohortStatusOn("2027-08-16", "2029-05-10", "2026-09-22")).toBe("planned");
    expect(cohortStatusOn("2026-09-22", "2026-09-22", "2026-09-22")).toBe("active"); // last day is still a day in program
    expect(cohortStatusOn(null, null, "2026-09-22")).toBe("planned");
  });
  it("a span is the first dated start to the last dated end (or last start when ends are unknown)", () => {
    expect(cohortSpan(co("a", ["2024-08-19", "2025-01-13"], ["2024-12-13", "2026-05-01"]))).toEqual({ from: "2024-08-19", to: "2026-05-01" });
    expect(cohortSpan(co("b", ["2027-08-16", null]))).toEqual({ from: "2027-08-16", to: "2027-08-16" });
    expect(cohortSpan(co("c", [null]))).toEqual({ from: null, to: null });
  });
  it("overlap keeps a class whose terms touch the window, drops one that ended before it, and keeps an undated one", () => {
    const grad = co("grad", ["2024-08-19"], ["2026-05-01"]), running = co("run", ["2025-08-18"], ["2027-05-11"]), ahead = co("ahead", ["2028-08-21"], ["2030-05-10"]), undated = co("u", [null]);
    expect(cohortsOverlapping([grad, running, ahead, undated], "2026-08-17", "2027-12-31").map((c) => c.id)).toEqual(["run", "u"]);
    expect(cohortsOverlapping([grad, running, ahead, undated], "2026-08-17", null).map((c) => c.id)).toEqual(["run", "ahead", "u"]);
    expect(cohortsOverlapping([grad, running, ahead], "2024-01-01", "2024-12-31").map((c) => c.id)).toEqual(["grad"]);
  });
  it("the academic year starts at the most recent fall anchor", () => {
    expect(academicYearStart("2026-09-22", "08-15")).toBe("2026-08-15");
    expect(academicYearStart("2026-03-01", "08-15")).toBe("2025-08-15");
    expect(academicYearStart("2026-08-15", "08-15")).toBe("2026-08-15");
  });
  it("the planned window opens on the first term start of the current academic year, not on 2024 history", () => {
    const cohorts = [{ ...co("grad", ["2024-08-19", "2025-01-13", "2025-05-19", "2025-08-18", "2026-01-12"]), anchors: { fallStart: "08-15" } }, co("run", ["2025-08-18", "2026-01-12", "2026-05-18", "2026-08-17", "2027-01-11"]), co("ahead", ["2028-08-21", "2029-01-08"])];
    const w = plannedWindow(cohorts, new Date("2026-09-22T12:00:00Z"));
    expect(w.from).toBe("2026-08-17");
    expect(w.to).toBe("2029-05-28"); // 20 weeks past the last start
    expect(plannedWindow([], new Date("2026-09-22T12:00:00Z"))).toEqual({ from: "2026-09-22", to: "2027-02-09" }); // nothing dated: today, 20 weeks ahead
  });
  it("the shared where-fragment excludes only archived offerings", () => { expect(NOT_ARCHIVED).toEqual({ status: { not: "archived" } }); });
});
