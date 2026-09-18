import { describe, expect, it } from "vitest";
import { fmt } from "../src/lib/format";

// Phase 1: required-pipeline counts round UP and may read "at least 83"; the unrounded
// calculation is available on hover only; every other figure keeps its own rule.
describe("required counts (Phase 1)", () => {
  it("reads 'at least 83' for a fractional requirement and a plain figure for a whole one", () => {
    expect(fmt.atLeastPhrase(82.2140822)).toBe("at least 83");
    expect(fmt.atLeastPhrase(29)).toBe("29");
    expect(fmt.atLeastPhrase(35.409035)).toBe("at least 36");
    expect(fmt.atLeastPhrase(null)).toBe("—");
  });
  it("puts the unrounded calculation in the hover title, never in the figure", () => {
    expect(fmt.calcTitle(82.2140822, "at least 83")).toBe("calculated 82.214082 · shown as at least 83");
    expect(fmt.calcTitle(29, "29")).toBe("exactly 29");
    expect(fmt.calcTitle(null, "—")).toBe("");
    expect(fmt.exact(82.2140822)).toBe("82.214082");
  });
  it("signs a change and keeps one decimal at most", () => {
    expect(fmt.pctSigned(0.125)).toBe("+12.5%");
    expect(fmt.pctSigned(-0.03)).toBe("−3%");
    expect(fmt.pctSigned(0)).toBe("0%");
  });
  it("formats drive minutes and timestamps through the module", () => {
    expect(fmt.minutes(17.4)).toBe("17 min");
    expect(fmt.minutes(null)).toBe("—");
    expect(fmt.dateTime(new Date("2026-09-18T15:05:00Z"))).toBe("Sep 18, 3:05 PM UTC");
  });
});
