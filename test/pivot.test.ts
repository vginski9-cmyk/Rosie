import { describe, it, expect } from "vitest";
import { pivot, applyFilters, distinct, type Fact } from "../src/lib/pivot";

const f = (o: Partial<Fact>): Fact => ({
  institution: "Sandhills", family: "Radiography", program: "Radiography", programType: "Traditional",
  cohort: "Class of 2029", metricGroup: "Pipeline", metric: "Enrolled", year: 2029, term: null, semester: "Fall",
  value: 0, target: null, actual: null, ...o,
});

const facts: Fact[] = [
  f({ program: "Radiography", metric: "Enrolled", year: 2029, value: 15, actual: 15, target: 41 }),
  f({ program: "Radiography", metric: "Completing", year: 2029, value: 13, actual: 13, target: 36 }),
  f({ program: "Evening", metric: "Enrolled", year: 2029, value: 16, actual: 16, target: 20 }),
  f({ program: "Radiography", metric: "Enrolled", year: 2030, value: 33, actual: 33, target: 41 }),
];

describe("pivot", () => {
  it("aggregates measure by row × col with totals", () => {
    const p = pivot(facts, "program", "year", "value");
    expect(p.rowKeys).toEqual(["Evening", "Radiography"]);
    expect(p.colKeys).toEqual(["2029", "2030"]);
    expect(p.get("Radiography", "2029")).toBe(15 + 13);
    expect(p.get("Evening", "2029")).toBe(16);
    expect(p.rowTotals["Radiography"]).toBe(15 + 13 + 33);
    expect(p.colTotals["2029"]).toBe(15 + 13 + 16);
    expect(p.grand).toBe(15 + 13 + 16 + 33);
  });
  it("supports target vs actual measures", () => {
    const t = pivot(facts, "program", "metric", "target");
    expect(t.get("Radiography", "Enrolled")).toBe(41 + 41); // both rad enrolled targets
  });
  it("applies dimension filters", () => {
    const filtered = applyFilters(facts, { metric: new Set(["Enrolled"]) });
    expect(filtered).toHaveLength(3);
    const p = pivot(facts, "program", "year", "value", { year: new Set(["2029"]) });
    expect(p.colKeys).toEqual(["2029"]);
    expect(p.grand).toBe(15 + 13 + 16);
  });
  it("distinct lists sorted dimension values", () => {
    expect(distinct(facts, "year")).toEqual(["2029", "2030"]);
  });
  it("orders the metric dimension in funnel sequence, not alphabetically", () => {
    const m: Fact[] = [
      f({ metric: "Fully productive in region", value: 1 }),
      f({ metric: "Interested candidates", value: 1 }),
      f({ metric: "Enrolled (Term 1)", value: 1 }),
      f({ metric: "Qualified applicants", value: 1 }),
    ];
    const p = pivot(m, "program", "metric", "value");
    expect(p.colKeys).toEqual(["Interested candidates", "Qualified applicants", "Enrolled (Term 1)", "Fully productive in region"]);
    expect(distinct(m, "metric")[0]).toBe("Interested candidates");
  });
});
