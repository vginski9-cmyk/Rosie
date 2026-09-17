import { describe, expect, it } from "vitest";
import { LENOIR_COHORTS, parseDays, parseTime, parseLocation } from "../prisma/seed-lenoir";

describe("Lenoir's Nurse Aide I cohort sheet", () => {
  it("holds all 38 cohorts, each ending after it starts, on the days it meets", () => {
    expect(LENOIR_COHORTS).toHaveLength(38);
    const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    for (const r of LENOIR_COHORTS) expect(r.end > r.start, `${r.cohort} ends before it starts`).toBe(true);
    // The two corrected rows were moved to a date the cohort actually meets on.
    const fixed = LENOIR_COHORTS.filter((r) => r.given);
    expect(fixed.map((r) => r.cohort)).toEqual(["Cohort 6 - 78901", "Cohort 26 - 76811"]);
    for (const r of fixed) expect(parseDays(r.days)).toContain(DOW[new Date(r.start + "T00:00:00Z").getUTCDay()]);
  });
  it("reads the sheet's days, times and places", () => {
    expect(parseDays("Tue, Thur, Fri")).toEqual(["Tue", "Thu", "Fri"]);
    expect(parseDays("Mon, Sat")).toEqual(["Mon", "Sat"]);
    expect(parseTime("5:30pm-9:30pm")).toEqual({ start: "17:30", end: "21:30", hours: 4 });
    expect(parseTime("08:00am-2:30pm")).toEqual({ start: "08:00", end: "14:30", hours: 6.5 });
    expect(parseTime("12:05pm-2:50pm")).toEqual({ start: "12:05", end: "14:50", hours: 2.75 });
    expect(parseLocation("Main Campus, Bullock Bldg, Rm 173")).toMatchObject({ campus: "Main Campus", building: "Bullock Building", room: "Bullock 173", roomNumber: "173" });
    expect(parseLocation("Main Campus, Bullokck, Rm 177").room).toBe("Bullock 177");
    expect(parseLocation("Lagrange Center")).toMatchObject({ campus: "La Grange Center", city: "La Grange" });
    expect(parseLocation("Kinston High School, Lancer Academy").building).toBe("Kinston High School — Lancer Academy");
    // every row parses
    for (const r of LENOIR_COHORTS) { expect(parseDays(r.days).length).toBeGreaterThan(0); expect(parseTime(r.time).hours).toBeGreaterThan(0); }
  });
});
