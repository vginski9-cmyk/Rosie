import { describe, it, expect } from "vitest";
import { PARTNER_SITES } from "../prisma/seed-partner-sites";
import { NC_PLACES } from "../src/lib/geo";

// The clinical partners seeded for Lenoir, Carteret and Roanoke-Chowan follow each program's own
// placement model: instructor-led nursing-hall groups for Nurse Aide I, 1:1 precepted externship
// slots for Medical Assisting. These checks keep the data honest as sites are added.

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

describe("partner sites", () => {
  it("every site is unique, in a town the offline gazetteer can place, at a college that exists in the seed", () => {
    const ids = PARTNER_SITES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const names = PARTNER_SITES.map((s) => `${s.institution}|${s.name}`);
    expect(new Set(names).size).toBe(names.length);
    for (const s of PARTNER_SITES) expect(NC_PLACES[norm(s.city)], `${s.city} missing from the gazetteer`).toBeDefined();
    expect(new Set(PARTNER_SITES.map((s) => s.institution))).toEqual(new Set(["Lenoir Community College", "Carteret Community College", "Roanoke-Chowan Community College"]));
  });
  it("Nurse Aide colleges get nursing halls and an acute unit; the Medical Assisting college gets ambulatory externship sites", () => {
    const na = PARTNER_SITES.filter((s) => /Lenoir|Carteret/.test(s.institution));
    expect(na.every((s) => ["snf", "ach", "hospital"].includes(s.kind))).toBe(true);
    for (const college of ["Lenoir Community College", "Carteret Community College"]) {
      const mine = na.filter((s) => s.institution === college);
      expect(mine.some((s) => s.kind === "hospital" && s.agreement === "secured")).toBe(true);
      expect(mine.filter((s) => s.kind === "snf" && s.agreement === "secured").length).toBeGreaterThanOrEqual(2);
    }
    const ma = PARTNER_SITES.filter((s) => /Roanoke/.test(s.institution));
    expect(ma.every((s) => ["fqhc", "office", "outpatient", "cah", "health-dept"].includes(s.kind))).toBe(true);
    expect(ma.filter((s) => s.agreement === "secured").length).toBeGreaterThanOrEqual(2);
  });
  it("names an unconfirmed address as an estimate and never leaves a site without a source", () => {
    for (const s of PARTNER_SITES) {
      expect(s.source.length).toBeGreaterThan(3);
      if (!s.address) expect(s.est).toBe(true);
    }
  });
  it("covers each college's service area counties", () => {
    const counties = (inst: RegExp) => new Set(PARTNER_SITES.filter((s) => inst.test(s.institution)).map((s) => s.county));
    expect([...counties(/Lenoir/)].sort()).toEqual(["Greene", "Jones", "Lenoir"]);
    expect([...counties(/Carteret/)]).toEqual(["Carteret"]);
    expect([...counties(/Roanoke/)].sort()).toEqual(["Bertie", "Gates", "Hertford", "Northampton"]);
  });
});
