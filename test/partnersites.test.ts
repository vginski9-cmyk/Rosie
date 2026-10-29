import { describe, it, expect } from "vitest";
import { PARTNER_SITES } from "../prisma/seed-partner-sites";
import { inGazetteer } from "../src/lib/geo";
import { SETTING_KITS } from "../prisma/seed-kits";

// The clinical partners seeded for Lenoir, Carteret and Roanoke-Chowan follow each program's own
// placement model: instructor-led nursing-hall groups for Nurse Aide I, 1:1 precepted externship
// slots for Medical Assisting; Southeastern's RN sites carry the settings an RN program rotates
// through. These checks keep the data honest as sites are added.

describe("partner sites", () => {
  it("every site is unique, in a town the offline gazetteer can place in its state, at a college that exists in the seed", () => {
    const ids = PARTNER_SITES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const names = PARTNER_SITES.map((s) => `${s.institution}|${s.name}`);
    expect(new Set(names).size).toBe(names.length);
    for (const s of PARTNER_SITES) expect(inGazetteer(s.city, s.state ?? "NC"), `${s.city}, ${s.state ?? "NC"} missing from the gazetteer`).toBe(true);
    expect(new Set(PARTNER_SITES.map((s) => s.institution))).toEqual(new Set(["Lenoir Community College", "Carteret Community College", "Roanoke-Chowan Community College", "Southeastern Community College", "University of North Carolina Wilmington", "Craven Community College"]));
  });
  it("the three earlier colleges' rows are untouched by the RN kits; Southeastern's sites carry every RN setting within 45 minutes, all prospects", () => {
    for (const s of PARTNER_SITES.filter((s) => !/Southeastern|Wilmington/.test(s.institution))) { expect(s.kits).toBeUndefined(); expect(s.state).toBeUndefined(); }
    // Craven's Nurse Aide sites follow the CNA shape (snf / ach / hospital, no kits), all prospects until the college names its partners.
    const crv = PARTNER_SITES.filter((s) => s.institution === "Craven Community College");
    expect(crv.length).toBeGreaterThanOrEqual(15);
    expect(crv.every((s) => ["snf", "ach", "hospital"].includes(s.kind) && s.agreement === "prospect" && s.lookedUp === undefined)).toBe(true);
    expect(crv.filter((s) => s.kind === "snf").length).toBeGreaterThanOrEqual(7);
    const scc = PARTNER_SITES.filter((s) => s.institution === "Southeastern Community College");
    expect(scc.length).toBeGreaterThanOrEqual(30);
    expect(scc.every((s) => s.agreement === "prospect" && s.lookedUp === "Oct 2026")).toBe(true);
    for (const s of scc) for (const k of s.kits ?? []) expect(SETTING_KITS[k.code], `${s.id} ${k.code}`).toBeDefined();
    const hospitals = scc.filter((s) => s.kind === "hospital");
    expect(hospitals.map((s) => s.city).sort()).toEqual(["Elizabethtown", "Little River", "Loris", "Lumberton", "Whiteville"]);
    // Every Southeastern hospital carries an emergency-department kit (the program's rotate-out day, 2026-10-28); three carry med-surg, ICU and OB.
    expect(hospitals.every((s) => (s.kits ?? []).some((k) => k.code === "ED"))).toBe(true);
    expect(hospitals.filter((s) => ["BEDS", "ICU", "OB"].every((c) => (s.kits ?? []).some((k) => k.code === c))).length).toBe(3);
    expect(scc.filter((s) => s.kind === "snf").length).toBeGreaterThanOrEqual(10);
    for (const kind of ["hospice", "home-health", "dialysis", "health-dept", "fqhc", "office", "behavioral", "ach"]) expect(scc.some((s) => s.kind === kind), kind).toBe(true);
    expect(scc.find((s) => s.id === "SCC-H01")!.note).toMatch(/clinical-instructor partnership/);
    expect([...new Set(scc.map((s) => s.county))].sort()).toEqual(["Bladen", "Columbus", "Horry", "Robeson"]);
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
    expect(counties(/Southeastern/).has("Columbus")).toBe(true);
    expect(counties(/Wilmington/).has("New Hanover")).toBe(true);
    expect([...counties(/Craven/)].sort()).toEqual(["Carteret", "Craven", "Pamlico"]);
  });
});
