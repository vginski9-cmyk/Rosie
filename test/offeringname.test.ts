import { describe, it, expect } from "vitest";
import { offeringName, shortTermProgram, campusLabel, runDetail } from "../src/lib/offeringname";

describe("offering names", () => {
  it("a class-a-year program names by the year the last term ends, numbered when repeated", () => {
    expect(offeringName({ shortTerm: false, startIso: "2026-08-17", endIso: "2028-05-11", existing: [] })).toBe("Class of 2028");
    expect(offeringName({ shortTerm: false, startIso: "2026-08-17", endIso: "2028-05-11", existing: ["Class of 2028"] })).toBe("Class of 2028 (2)");
  });
  it("a short-term program names by its start month and where it meets", () => {
    expect(offeringName({ shortTerm: true, startIso: "2026-01-05", endIso: "2026-06-08", campus: "Greene County Center", existing: [] })).toBe("Jan 2026 · Greene County Center");
    expect(offeringName({ shortTerm: true, startIso: "2026-01-05", endIso: "2026-06-08", campus: null, existing: [] })).toBe("Jan 2026");
  });
  it("two runs in the same month and place are told apart by their days and time, then by a number", () => {
    const existing = ["Mar 2025 · La Grange Center"];
    expect(offeringName({ shortTerm: true, startIso: "2025-03-25", endIso: "2025-07-24", campus: "La Grange Center", detail: "Tue & Thu evening", existing })).toBe("Mar 2025 · La Grange Center · Tue & Thu evening");
    expect(offeringName({ shortTerm: true, startIso: "2025-03-25", endIso: "2025-07-24", campus: "La Grange Center", detail: "Tue & Thu evening", existing: [...existing, "Mar 2025 · La Grange Center · Tue & Thu evening"] })).toBe("Mar 2025 · La Grange Center · Tue & Thu evening (2)");
  });
  it("which programs are short-term", () => {
    expect(shortTermProgram({ launchCadence: "MULTI_PER_YEAR", spanWeeks: 80 })).toBe(true);
    expect(shortTermProgram({ launchCadence: "ANNUAL", spanWeeks: 28 })).toBe(false); // Medical Assisting's two 14-week parts, once a year: a class year
    expect(shortTermProgram({ launchCadence: "ANNUAL", spanWeeks: 16 })).toBe(true);
    expect(shortTermProgram({ launchCadence: "ANNUAL", spanWeeks: 80 })).toBe(false);
  });
  it("campus labels and run details", () => {
    expect(campusLabel({ name: "Main Campus", city: "Kinston", isMain: true })).toBe("Kinston");
    expect(campusLabel({ name: "Greene County Center", city: "Snow Hill", isMain: false })).toBe("Greene County Center");
    expect(campusLabel(null)).toBeNull();
    expect(runDetail(["Mon", "Wed"], "17:30")).toBe("Mon & Wed evening");
    expect(runDetail(["Tue", "Thu"], "08:00")).toBe("Tue & Thu daytime");
    expect(runDetail(["Tue", "Thu"], null)).toBe("Tue & Thu");
  });
});
