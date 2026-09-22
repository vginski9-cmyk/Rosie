// A GRADUATED CLASS'S OUTCOMES — how many of its seats ended where, from the class's own talent-pipeline
// rates, so a class that has finished carries the same chain the goal page planned it by: enrolled →
// completing → licensed → placed → productive. Pure; the seed and any "record a graduated class"
// action read it. Counts are whole people, the chain never rises, and a pinned withdrawal count
// (the partner's own number) overrides the rate for the first step.

import type { LadderRates } from "./northstar";

export type OutcomeRates = Pick<LadderRates, "completionRate" | "licensureRate" | "placementRate" | "productivityRate">;
/** Exclusive terminal buckets: a person is counted once, at the furthest stage they reached. */
export interface OutcomeMix { withdrawn: number; completed: number; licensed: number; placed: number; productive: number }
export type TerminalStatus = "withdrawn" | "completed" | "licensed" | "placed" | "productive";
/** The funnel stage a terminal status stands for (the record's `stageKey`). */
export const TERMINAL_STAGE: Record<TerminalStatus, string> = { withdrawn: "withdrawn", completed: "completing", licensed: "licensed", placed: "placed", productive: "productive" };

const clampRound = (v: number, hi: number) => Math.max(0, Math.min(hi, Math.round(v)));

export function outcomeMix(seats: number, rates: OutcomeRates, pin?: { withdrawn: number }): OutcomeMix {
  const n = Math.max(0, Math.round(seats));
  const completers = pin ? Math.max(0, n - Math.max(0, Math.round(pin.withdrawn))) : clampRound(n * rates.completionRate, n);
  const licensed = clampRound(completers * rates.licensureRate, completers);
  const placed = clampRound(licensed * rates.placementRate, licensed);
  const productive = clampRound(placed * rates.productivityRate, placed);
  return { withdrawn: n - completers, completed: completers - licensed, licensed: licensed - placed, placed: placed - productive, productive };
}

/** Deal the buckets across seats 0..seats−1 by a deterministic rank: the highest ranks withdraw (the same rule the
 *  seed uses for a pinned roster), and the rest fill productive → placed → licensed → completed in ascending rank. */
export function assignOutcomes(seats: number, mix: OutcomeMix, rankOf: (seat: number) => number): { status: TerminalStatus; stageKey: string }[] {
  const n = Math.max(0, Math.round(seats));
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => rankOf(b) - rankOf(a) || a - b);
  const out: TerminalStatus[] = new Array(n);
  let k = 0;
  const take = (count: number, status: TerminalStatus) => { for (let i = 0; i < count && k < n; i++) out[order[k++]] = status; };
  take(mix.withdrawn, "withdrawn");
  const rest = order.slice(k).reverse(); k = 0; // ascending rank for the survivors
  const takeRest = (count: number, status: TerminalStatus) => { for (let i = 0; i < count && k < rest.length; i++) out[rest[k++]] = status; };
  takeRest(mix.productive, "productive"); takeRest(mix.placed, "placed"); takeRest(mix.licensed, "licensed"); takeRest(mix.completed, "completed");
  while (k < rest.length) out[rest[k++]] = "completed"; // rounding slack never leaves a seat unlabelled
  return out.map((status) => ({ status, stageKey: TERMINAL_STAGE[status] }));
}

/** The demo grade bank: letter, points on the 4.0 scale, and its weight in the draw. */
export const GRADE_BANK = [
  { grade: "A", points: 4.0, w: 3 }, { grade: "A-", points: 3.7, w: 3 }, { grade: "B+", points: 3.3, w: 4 }, { grade: "B", points: 3.0, w: 4 },
  { grade: "B-", points: 2.7, w: 2 }, { grade: "C+", points: 2.3, w: 2 }, { grade: "C", points: 2.0, w: 1 },
] as const;
const BANK_TOTAL = GRADE_BANK.reduce((s, g) => s + g.w, 0);
/** A weighted draw from the bank by a number in 0..999 (deterministic for the same input). */
export function pickGrade(x: number): { grade: string; points: number } {
  let r = ((((x % 1000) + 1000) % 1000) / 1000) * BANK_TOTAL;
  for (const g of GRADE_BANK) { r -= g.w; if (r < 0) return { grade: g.grade, points: g.points }; }
  const last = GRADE_BANK[GRADE_BANK.length - 1]; return { grade: last.grade, points: last.points };
}
/** Grade-point average to two decimals; null with nothing graded. */
export function gpaOf(points: number[]): number | null {
  if (!points.length) return null;
  return Math.round((points.reduce((a, b) => a + b, 0) / points.length) * 100) / 100;
}
