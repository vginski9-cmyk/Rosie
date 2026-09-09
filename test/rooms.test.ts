import { describe, it, expect } from "vitest";
import { openHoursOn, weeklyOpenHours, hoursLabel, withinHours, weeklyUtilization, parseHoursText, HOURS_PRESETS } from "../src/lib/rooms";

describe("rooms", () => {
  const spans = HOURS_PRESETS.find((p) => p.key === "weekday-extended-sat")!.spans;
  it("computes open hours per day, week and label", () => {
    expect(openHoursOn(spans, [], "2026-09-09")).toBe(14); // Wed 7:30–21:30
    expect(openHoursOn(spans, [], "2026-09-12")).toBe(6);  // Sat
    expect(openHoursOn(spans, [], "2026-09-13")).toBe(0);  // Sun
    expect(openHoursOn(spans, [{ date: "2026-09-09", openTime: null, closeTime: null, note: "closed" }], "2026-09-09")).toBe(0);
    expect(openHoursOn(spans, [{ date: "2026-09-09", openTime: "10:00", closeTime: "12:00" }], "2026-09-09")).toBe(2);
    expect(weeklyOpenHours(spans)).toBe(76);
    expect(hoursLabel(spans)).toBe("Mon–Fri 07:30–21:30 · Sat 08:00–14:00");
  });
  it("checks meetings against hours and computes utilization", () => {
    expect(withinHours(spans, "Mon", "18:00", 3)).toBe(true);
    expect(withinHours(spans, "Mon", "20:00", 3)).toBe(false);
    expect(withinHours(spans, "Sun", "09:00", 1)).toBe(false);
    const u = weeklyUtilization(spans, [{ dayOfWeek: "Mon", startTime: "09:00", lengthHours: 2 }, { dayOfWeek: "Tue", startTime: "20:00", lengthHours: 3 }]);
    expect(u.open).toBe(76); expect(u.booked).toBe(5); expect(u.utilization).toBeCloseTo(5 / 76, 10); expect(u.outsideHours).toBe(1);
  });
  it("parses legacy hours text", () => {
    expect(parseHoursText("Mon–Fri 7:30a–9:30p · Sat 8a–2p")).toEqual(spans);
    expect(parseHoursText("Mon-Thu 8:00-17:00")).toHaveLength(4);
    expect(parseHoursText(null)).toEqual([]);
  });
});
