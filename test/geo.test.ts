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
  it("the gazetteer knows the region's towns and refuses other states", () => {
    expect(geocodeOffline({ city: "Raeford", state: "NC" })?.source).toBe("gazetteer");
    expect(geocodeOffline({ city: "Raeford", state: "SC" })).toBeNull();
    expect(geocodeOffline({ city: "Nowhere" })).toBeNull();
  });
});
