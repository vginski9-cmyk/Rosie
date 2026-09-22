import { describe, it, expect } from "vitest";
import { ageOn, ageBand, pivot, crosstab, outcomeOf, type LearnerLite } from "../src/lib/learners";

const L = (o: Partial<LearnerLite>): LearnerLite => ({ id: "x", name: "x", status: "enrolled", stageKey: null, entryYear: 2026, institution: "Sandhills", program: "Radiography", cohort: "Class of 2028", dob: "2000-06-15", sex: "Female", raceEthnicity: "White", county: "Moore", city: null, zip: null, residency: "in-district", priorEducation: "HS diploma", employmentStatus: "part-time", firstGeneration: true, veteran: false, pellEligible: null, disability: null, withdrawalReason: null, gpa: 3.2, ...o });

describe("learners", () => {
  it("computes age and bands", () => {
    expect(ageOn("2000-06-15", "2026-06-14")).toBe(25);
    expect(ageOn("2000-06-15", "2026-06-15")).toBe(26);
    expect(ageBand(19)).toBe("<20"); expect(ageBand(24)).toBe("20–24"); expect(ageBand(57)).toBe("55+"); expect(ageBand(null)).toBe("unknown");
  });
  it("buckets outcomes", () => {
    expect(outcomeOf("licensed")).toBe("completed"); expect(outcomeOf("withdrawn")).toBe("withdrawn"); expect(outcomeOf("enrolled")).toBe("in progress"); expect(outcomeOf("applicant")).toBe("pre-enrollment");
  });
  it("pivots by a dimension with completion rate, average age and GPA", () => {
    const rows = pivot([
      L({ id: "1", status: "completed" }), L({ id: "2", status: "withdrawn", withdrawalReason: "financial" }), L({ id: "3" }),
      L({ id: "4", sex: "Male", dob: "1990-01-01", status: "completed", gpa: 3.8 }),
    ], "sex", "2026-09-09");
    const f = rows.find((r) => r.value === "Female")!; const m = rows.find((r) => r.value === "Male")!;
    expect(f.n).toBe(3); expect(f.completed).toBe(1); expect(f.withdrawn).toBe(1); expect(f.inProgress).toBe(1);
    // Rates are of entrants (everyone who started): 3 women started — but three is a small cell, so no rate is shown (Phase 6);
    // the counts still are. test/phase6.test.ts covers the rate math on cells of five or more.
    expect(f.entrants).toBe(3); expect(f.smallCell).toBe(true); expect(f.completionRate).toBeNull(); expect(f.withdrawalRate).toBeNull(); expect(f.avgAge).toBe(26); expect(f.share).toBeCloseTo(0.75, 10);
    expect(m.smallCell).toBe(true); expect(m.avgAge).toBe(36); expect(m.avgGpa).toBeCloseTo(3.8, 10);
    expect(pivot([L({ firstGeneration: null })], "firstGeneration", "2026-09-09")[0].value).toBe("unknown");
    expect(pivot([L({ dob: "1975-01-01" })], "ageBand", "2026-09-09")[0].value).toBe("45–54");
  });
  it("cross-tabs two dimensions", () => {
    const ct = crosstab([L({ id: "1" }), L({ id: "2", sex: "Male" }), L({ id: "3", raceEthnicity: "Asian" })], "raceEthnicity", "sex", "2026-09-09");
    expect(ct.cols).toEqual(["Female", "Male"]);
    expect(ct.rows[0]).toEqual({ value: "White", cells: [1, 1], n: 2 });
  });
});

describe("graduated classes in the analytics", () => {
  const co = (id: string, name: string, status: string, programId = "p1", program = "Radiography") => ({ id, name, status, gradYear: name.match(/(20\d{2})/) ? Number(name.match(/(20\d{2})/)![1]) : null, programId, program, institutionId: "i1", institution: "Sandhills", cohortEnds: null });
  it("the pickers come from the offerings: a class with no students is listed and says so, graduated ones first", async () => {
    const { analyticsOptions } = await import("../src/lib/learners");
    const cohorts = [co("a", "Class of 2028", "active"), co("b", "Class of 2026", "completed"), co("c", "Class of 2030", "planned", "p2", "Surgical Technology")];
    const learners = [{ cohortId: "a", gradYear: 2028, entryYear: 2026 }, { cohortId: "a", gradYear: 2028, entryYear: 2026 }, { cohortId: "b", gradYear: 2026, entryYear: 2024 }];
    const o = analyticsOptions(cohorts, learners, {});
    expect(o.institutions).toEqual([["i1", "Sandhills"]]);
    expect(o.programs.map(([, n]) => n)).toEqual(["Radiography", "Surgical Technology"]);
    expect(o.cohorts.map((c) => `${c.name}:${c.n}:${c.status}`)).toEqual(["Class of 2030:0:planned", "Class of 2028:2:active", "Class of 2026:1:completed"]);
    expect(o.gradYears).toEqual([2030, 2028, 2026]); expect(o.entryYears).toEqual([2026, 2024]);
    expect(analyticsOptions(cohorts, learners, { prog: "p2" }).cohorts.map((c) => c.name)).toEqual(["Class of 2030"]);
  });
  it("time to complete is the median months from first day to completion date over completers that carry both", async () => {
    const { timeToComplete } = await import("../src/lib/learners");
    expect(timeToComplete([])).toEqual({ medianMonths: null, n: 0 });
    const t = timeToComplete([
      { status: "productive", startDate: "2024-08-19", completionDate: "2026-05-01" },
      { status: "completed", startDate: "2024-08-19", completionDate: "2026-05-01" },
      { status: "withdrawn", startDate: "2024-08-19", completionDate: null },
      { status: "licensed", startDate: null, completionDate: "2026-05-01" },
    ]);
    expect(t.n).toBe(2); expect(t.medianMonths).toBeCloseTo(20.3, 0);
  });
  it("the class-year dimension reads the year in the class name", async () => {
    const { dimensionValue } = await import("../src/lib/learners");
    expect(dimensionValue(L({ gradYear: 2026 }), "gradYear", "2026-09-22")).toBe("2026");
    expect(dimensionValue(L({}), "gradYear", "2026-09-22")).toBe("unknown");
  });
});
