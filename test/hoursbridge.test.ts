import { describe, expect, it } from "vitest";
import { programHoursBridge } from "../src/lib/hoursbridge";
import { outcomeStats } from "../src/lib/learners";

describe("clinical hours, two ways (audit §1.9)", () => {
  it("names the course whose session hours and coded hours differ, and the unassigned hours", () => {
    const b = programHoursBridge("p", "Radiography", [
      { course: "RAD-151", sessionHours: 96, codedHours: 96 },
      { course: "RAD-161", sessionHours: 240, codedHours: 240 },
      { course: "RAD-171", sessionHours: 144, codedHours: 90 },
      { course: "RAD-251", sessionHours: 336, codedHours: 336 },
      { course: "RAD-261", sessionHours: 336, codedHours: 336 },
      { course: "RAD-110", sessionHours: 0, codedHours: 0 },
    ]);
    expect(b.sessionHours).toBe(1152);
    expect(b.codedHours).toBe(1098);
    expect(b.unmapped).toEqual([{ course: "RAD-171", sessionHours: 144, codedHours: 90, gap: 54 }]);
  });
  it("is empty when every course agrees, and flags hours coded beyond the sessions as a negative gap", () => {
    expect(programHoursBridge("p", "P", [{ course: "A", sessionHours: 40, codedHours: 40 }]).unmapped).toEqual([]);
    expect(programHoursBridge("p", "P", [{ course: "A", sessionHours: 30, codedHours: 40 }]).unmapped[0].gap).toBe(-10);
  });
});

describe("withdrawal rate (audit §3)", () => {
  const learners = [
    ...Array.from({ length: 51 }, () => ({ status: "enrolled" })),
    ...Array.from({ length: 9 }, () => ({ status: "withdrawn" })),
    ...Array.from({ length: 40 }, () => ({ status: "prospect" })),
    ...Array.from({ length: 12 }, () => ({ status: "applicant" })),
    { status: "admitted" },
  ];
  it("divides by everyone who started, not by every learner record and not by 'decided'", () => {
    const o = outcomeStats(learners);
    expect(o.entrants).toBe(60);
    expect(o.withdrawn).toBe(9);
    expect(o.withdrawalRate).toBeCloseTo(0.15, 6);
    expect(o.completed).toBe(0);
    expect(o.completionRate).toBe(0);
  });
  it("is null, not 100 %, when nobody has started", () => {
    expect(outcomeStats([{ status: "prospect" }, { status: "applicant" }]).withdrawalRate).toBeNull();
  });
});
