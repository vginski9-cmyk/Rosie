import { describe, it, expect } from "vitest";
import { outcomeMix, assignOutcomes, pickGrade, gpaOf, GRADE_BANK, TERMINAL_STAGE, type OutcomeMix } from "../src/lib/cohorthistory";

const RAD = { completionRate: 0.87, licensureRate: 0.9, placementRate: 0.91, productivityRate: 1 };
const SMALL = { completionRate: 0.75, licensureRate: 1, placementRate: 1, productivityRate: 1 };
const sum = (m: OutcomeMix) => Object.values(m).reduce((a, b) => a + b, 0);

describe("a graduated class's outcomes from its own rates", () => {
  it("Radiography Class of 2026: 21 seats → 18 completers → 16 licensed → 15 placed → 15 productive (its goal)", () => {
    const m = outcomeMix(21, RAD);
    expect(m).toEqual({ withdrawn: 3, completed: 2, licensed: 1, placed: 0, productive: 15 });
    expect(sum(m)).toBe(21);
  });
  it("a pinned withdrawal count overrides the completion rate; everyone after that is retained at 100%", () => {
    expect(outcomeMix(8, SMALL, { withdrawn: 2 })).toEqual({ withdrawn: 2, completed: 0, licensed: 0, placed: 0, productive: 6 });
  });
  it("the chain never rises and the buckets always add up to the seats", () => {
    for (const seats of [0, 1, 4, 10, 19, 23, 40]) for (const r of [RAD, SMALL, { completionRate: 1, licensureRate: 0.5, placementRate: 1.4, productivityRate: 0 }]) {
      const m = outcomeMix(seats, r);
      expect(sum(m)).toBe(seats);
      for (const v of Object.values(m)) expect(v).toBeGreaterThanOrEqual(0);
    }
  });
  it("outcomes are dealt deterministically: the highest-ranked seats withdraw, the rest fill from productive down", () => {
    const m = outcomeMix(8, SMALL, { withdrawn: 2 });
    const rank = (i: number) => [5, 900, 20, 40, 950, 60, 70, 80][i];
    const a = assignOutcomes(8, m, rank);
    expect(a.map((x) => x.status)).toEqual(["productive", "withdrawn", "productive", "productive", "withdrawn", "productive", "productive", "productive"]);
    expect(a[1].stageKey).toBe("withdrawn"); expect(a[0].stageKey).toBe("productive");
    expect(assignOutcomes(8, m, rank)).toEqual(a);
    const rad = assignOutcomes(21, outcomeMix(21, RAD), (i) => (i * 37) % 101);
    const counts: Record<string, number> = {}; for (const x of rad) counts[x.status] = (counts[x.status] ?? 0) + 1;
    expect(counts).toEqual({ withdrawn: 3, completed: 2, licensed: 1, productive: 15 });
    expect(rad.every((x) => x.stageKey === TERMINAL_STAGE[x.status])).toBe(true);
  });
  it("grades come from the bank, deterministically, and the GPA is their mean to two decimals", () => {
    const letters = new Set<string>(GRADE_BANK.map((g) => g.grade));
    for (const x of [0, 1, 250, 500, 999, 1234, -7]) { const g = pickGrade(x); expect(letters.has(g.grade)).toBe(true); expect(pickGrade(x)).toEqual(g); }
    expect(pickGrade(0).grade).toBe("A"); expect(pickGrade(999).grade).toBe("C");
    expect(gpaOf([4, 3, 3.3])).toBe(3.43); expect(gpaOf([])).toBeNull();
  });
});
