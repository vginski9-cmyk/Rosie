import { describe, it, expect } from "vitest";
import { trackLabel, classYearNaming, offeringName, shortTermProgram, campusLabel, runDetail, programDetail } from "../src/lib/offeringname";

describe("offering names", () => {
  it("a class-a-year program names by the year the last term ends, numbered when repeated", () => {
    expect(offeringName({ shortTerm: false, startIso: "2026-08-17", endIso: "2028-05-11", existing: [] })).toBe("Class of 2028");
    expect(offeringName({ shortTerm: false, startIso: "2026-08-17", endIso: "2028-05-11", existing: ["Class of 2028"] })).toBe("Class of 2028 · 2nd class");
    expect(offeringName({ shortTerm: false, startIso: "2026-08-17", endIso: "2028-05-11", existing: ["Class of 2028", "Class of 2028 · 2nd class", "Class of 2028 · 3rd class"] })).toBe("Class of 2028 · 3rd class (2)");
    // A family with more than one class-year program (Albemarle's AAS and Diploma) names each class by its credential.
    expect(offeringName({ shortTerm: false, startIso: "2026-08-17", endIso: "2027-07-26", credential: "Diploma", existing: ["Class of 2027 · AAS", "Class of 2027 · AAS · 2nd class"] })).toBe("Class of 2027 · Diploma");
    expect(offeringName({ shortTerm: false, startIso: "2026-08-17", endIso: "2027-07-26", credential: "Diploma", existing: ["Class of 2027 · Diploma"] })).toBe("Class of 2027 · Diploma · 2nd class");
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
    expect(shortTermProgram({ launchCadence: "MULTI_PER_YEAR", spanWeeks: 72 })).toBe(false); // Radiography launches Fall and Spring, but is a two-year class
    expect(shortTermProgram({ launchCadence: "MULTI_PER_YEAR", spanWeeks: 20 })).toBe(true);
    expect(shortTermProgram({ launchCadence: "ON_DEMAND", spanWeeks: 40 })).toBe(true);
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
  it("a delivery model's label tells two programs' same-month runs apart", () => {
    expect(programDetail("Nurse Aide Level I — 11-week daytime offering")).toBe("11-week daytime");
    expect(programDetail("Nurse Aide Level I — Monday & Wednesday 20-week Offering")).toBe("Monday & Wednesday 20-week");
    expect(programDetail("Radiography")).toBeNull();
    expect(offeringName({ shortTerm: true, startIso: "2026-08-17", endIso: "2026-11-10", campus: "Morehead City", detail: "11-week daytime", existing: ["Aug 2026 · Morehead City"] })).toBe("Aug 2026 · Morehead City · 11-week daytime");
  });
});

describe("class-year siblings that share a credential are told apart by track", () => {
  it("trackLabel drops a trailing code and reads the dash as a space", () => {
    expect(trackLabel("LPN-to-ADN Transition (A45110T)")).toBe("LPN-to-ADN Transition");
    expect(trackLabel("ADN — Fall Entry")).toBe("ADN Fall Entry");
    expect(trackLabel("Nursing Transition")).toBe("Nursing Transition");
    expect(trackLabel("Associate Degree Nursing (A45110)")).toBe("Associate Degree Nursing");
  });
  it("classYearNaming: credential when a sibling's differs, track when a sibling shares it, nothing when the siblings are short-term", () => {
    expect(classYearNaming({ credential: "AAS", name: "Medical Office Administration AAS (A25310MO, hybrid)" }, [{ credential: "Diploma", shortTerm: false }, { credential: "Certificate", shortTerm: true }])).toEqual({ credential: "AAS", track: null });
    expect(classYearNaming({ credential: "AAS", name: "Nursing Transition" }, [{ credential: "AAS", shortTerm: false }, { credential: "AAS", shortTerm: false }])).toEqual({ credential: null, track: "Nursing Transition" });
    expect(classYearNaming({ credential: "AAS", name: "ADN — Fall Entry" }, [{ credential: "AAS", shortTerm: false }, { credential: "Diploma", shortTerm: false }])).toEqual({ credential: "AAS", track: "ADN Fall Entry" });
    expect(classYearNaming({ credential: "Diploma", name: "Nurse Aide Level I — 6-week offering" }, [{ credential: "Diploma", shortTerm: true }])).toEqual({ credential: null, track: null });
  });
  it("names Cape Fear's four AAS nursing classes of 2028 by track", () => {
    const existing: string[] = [];
    for (const track of ["ADN Fall Entry", "Nursing Transition", "ADN Spring Entry", "LPN-to-ADN"]) existing.push(offeringName({ shortTerm: false, startIso: "2026-08-17", endIso: "2028-05-05", track, existing }));
    expect(existing).toEqual(["Class of 2028 · ADN Fall Entry", "Class of 2028 · Nursing Transition", "Class of 2028 · ADN Spring Entry", "Class of 2028 · LPN-to-ADN"]);
    expect(offeringName({ shortTerm: false, startIso: "2026-08-17", endIso: "2028-05-05", track: "ADN Fall Entry", existing })).toBe("Class of 2028 · ADN Fall Entry · 2nd class");
  });
});
