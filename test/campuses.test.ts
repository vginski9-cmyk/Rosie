import { describe, expect, it } from "vitest";
import { OTHER_CAMPUSES } from "../prisma/seed-campuses";
import { geocodeOffline } from "../src/lib/geo";

describe("the other places a college's classes meet", () => {
  it("Carteret's Nurse Aide I also meets at East Carteret High School and Carteret Health Care, each with its address and a place on the map", () => {
    const places = OTHER_CAMPUSES["Carteret Community College"];
    expect(places.map((p) => [p.name, p.address, p.city, p.zip])).toEqual([
      ["East Carteret High School (ECHS)", "3263 US-70 East", "Beaufort", "28516"],
      ["Carteret Health Care (CHC)", "3500 Arendell St", "Morehead City", "28557"],
    ]);
    for (const p of places) expect(geocodeOffline({ city: p.city, state: p.state }), p.name).not.toBeNull();
  });
});
