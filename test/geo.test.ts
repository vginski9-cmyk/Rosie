import { describe, it, expect } from "vitest";
import { haversineMiles, driveMinutes, ringOf, distanceFrom, geocodeOffline } from "../src/lib/geo";

const campus = { lat: 35.216, lng: -79.436 }; // Sandhills CC, Airport Rd, Pinehurst
describe("site geography", () => {
  it("measures great-circle miles", () => {
    expect(haversineMiles(campus, campus)).toBe(0);
    const fay = geocodeOffline({ city: "Fayetteville", state: "NC" })!;
    expect(haversineMiles(campus, fay)).toBeGreaterThan(30); expect(haversineMiles(campus, fay)).toBeLessThan(40);
  });
  it("bands drive time into rings from the campus", () => {
    expect(ringOf(20)).toBe("Core"); expect(ringOf(45)).toBe("Ring 1"); expect(ringOf(75)).toBe("Ring 2"); expect(ringOf(120)).toBe("Ring 3");
    expect(ringOf(45, { coreMinutes: 45, oneMinutes: 60, twoMinutes: 90 })).toBe("Core");
    expect(distanceFrom(campus, geocodeOffline({ city: "Southern Pines" })!).ring).toBe("Core");
    expect(distanceFrom(campus, geocodeOffline({ city: "Fayetteville" })!).ring).toBe("Ring 1");
    expect(distanceFrom(campus, geocodeOffline({ city: "Charlotte" })!).ring).toBe("Ring 3");
  });
  it("estimates a drive as road miles at rural speeds plus a walk-in", () => {
    expect(driveMinutes(0)).toBe(4);
    expect(Math.round(driveMinutes(10))).toBe(23); // 12.5 road miles at 40 mph + 4
  });
  it("two centroids in the same town are a short in-town drive, not zero", () => {
    const pinehurst = geocodeOffline({ city: "Pinehurst" })!;
    const d = distanceFrom(pinehurst, pinehurst);
    expect(d.sameTown).toBe(true); expect(d.miles).toBe(2); expect(d.ring).toBe("Core"); expect(d.minutes).toBeGreaterThan(4);
    expect(distanceFrom(campus, campus).sameTown).toBe(false); // exact coordinates: no floor
  });
  it("the gazetteer knows the region's towns in their own state and refuses a town in the wrong one", () => {
    expect(geocodeOffline({ city: "Raeford", state: "NC" })?.source).toBe("gazetteer");
    expect(geocodeOffline({ city: "Raeford", state: "SC" })).toBeNull();
    expect(geocodeOffline({ city: "Nowhere" })).toBeNull();
    expect(geocodeOffline({ city: "Loris", state: "SC" })?.label).toBe("Loris, SC centroid (built-in gazetteer)");
    expect(geocodeOffline({ city: "Loris", state: "NC" })).toBeNull();
    expect(geocodeOffline({ city: "Loris", state: "VA" })).toBeNull();
  });
  it("Southeastern's 45-minute core band from Whiteville holds the Columbus County towns; Loris sits at its edge by the centroid estimate", () => {
    const whiteville = geocodeOffline({ city: "Whiteville", state: "NC" })!;
    const bands = { coreMinutes: 45, oneMinutes: 60, twoMinutes: 90 };
    for (const [city, state] of [["Tabor City", "NC"], ["Lake Waccamaw", "NC"], ["Chadbourn", "NC"], ["Fair Bluff", "NC"]]) expect(distanceFrom(whiteville, geocodeOffline({ city, state })!, bands).ring, city).toBe("Core");
    // Loris, SC: 25 road miles (about 36 minutes by road); the town-centroid estimate reads a minute or two over the band.
    const loris = distanceFrom(whiteville, geocodeOffline({ city: "Loris", state: "SC" })!, bands);
    expect(loris.minutes).toBeGreaterThan(44); expect(loris.minutes).toBeLessThan(48); expect(loris.ring).toBe("Ring 1");
    expect(distanceFrom(whiteville, geocodeOffline({ city: "Bolivia", state: "NC" })!, bands).ring).not.toBe("Core");
  });
});
