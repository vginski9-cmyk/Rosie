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
    expect(f.completionRate).toBeCloseTo(0.5, 10); expect(f.avgAge).toBe(26); expect(f.share).toBeCloseTo(0.75, 10);
    expect(m.completionRate).toBe(1); expect(m.avgAge).toBe(36); expect(m.avgGpa).toBeCloseTo(3.8, 10);
    expect(pivot([L({ firstGeneration: null })], "firstGeneration", "2026-09-09")[0].value).toBe("unknown");
    expect(pivot([L({ dob: "1975-01-01" })], "ageBand", "2026-09-09")[0].value).toBe("45–54");
  });
  it("cross-tabs two dimensions", () => {
    const ct = crosstab([L({ id: "1" }), L({ id: "2", sex: "Male" }), L({ id: "3", raceEthnicity: "Asian" })], "raceEthnicity", "sex", "2026-09-09");
    expect(ct.cols).toEqual(["Female", "Male"]);
    expect(ct.rows[0]).toEqual({ value: "White", cells: [1, 1], n: 2 });
  });
});
