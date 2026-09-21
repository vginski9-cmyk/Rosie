// A year's goal allocations: the saved plan's delivery-model slices, plus every real offering
// delivering that year that the plan does not know about yet (an offering created on the program
// page or by the seed, never locked in from the goal page) as a locked slot of its model — so the
// total counts what actually runs. An offering the plan already references is never added twice.

import type { LadderRates } from "./northstar";

/** One planned run of a delivery model inside an allocation. */
export interface OfferingSlot {
  /** Planned first day (ISO date). Required to lock in. */
  startDate: string | null;
  /** THIS offering's share of the goal — fully-productive placements it covers. */
  goal?: number;
  /** THIS offering's per-term enrollment (index 0 = term 1); null = derived from its goal. */
  termOverrides?: (number | null)[];
  /** THIS offering's own health rates (only the keys that differ from the family defaults). */
  rates?: Partial<LadderRates>;
  /** Where this run meets (a campus of the college), chosen before lock-in. */
  campusId?: string | null;
  /** Locked in: the real cohort this run became. */
  locked?: boolean;
  cohortId?: string | null;
  cohortName?: string | null;
}

/** One slice of a year's goal, assigned to a delivery model. */
export interface Alloc {
  programId: string;
  /** Fully-productive workers this model is responsible for — the SUM of its offerings' goals (kept in sync). */
  goal: number;
  /** Legacy model-level per-term overrides — migrated onto the offerings. */
  termOverrides?: (number | null)[];
  /** User-chosen number of offerings — overrides the suggested count. */
  offeringCount?: number;
  /** The runs of this model that deliver the share — one per needed offering. */
  offerings?: OfferingSlot[];
  /** Legacy single-offering fields (migrated into offerings[0]). */
  startDate?: string | null;
  locked?: boolean;
  cohortId?: string | null;
  cohortName?: string | null;
}

export interface OfferingLite { id: string; name: string; programId: string; goalProductive: number; pipelineRates?: string | null; /** ISO first day, when the offering is dated. */ startDate?: string | null }

/** The goal an offering carries: its saved pipeline plan's goal, else its productive target. */
export function offeringGoal(c: Pick<OfferingLite, "goalProductive" | "pipelineRates">): number {
  try { const saved = c.pipelineRates ? (JSON.parse(c.pipelineRates) as { goal?: number }) : null; if (saved?.goal != null) return saved.goal; } catch { /* productive target */ }
  return c.goalProductive;
}

/** The year's allocations with every unreferenced real offering folded in as a locked slot. */
export function yearAllocations(saved: Alloc[], offerings: OfferingLite[]): Alloc[] {
  const known = new Set(saved.flatMap((a) => [a.cohortId, ...(a.offerings ?? []).map((o) => o.cohortId)]).filter((id): id is string => !!id));
  const orphans = offerings.filter((c) => !known.has(c.id));
  if (!orphans.length) return saved;
  const out = saved.map((a) => ({ ...a, offerings: a.offerings ? [...a.offerings] : a.offerings }));
  for (const c of orphans) {
    const goal = offeringGoal(c);
    const slot: OfferingSlot = { startDate: c.startDate ?? null, goal, termOverrides: [], locked: true, cohortId: c.id, cohortName: c.name };
    const a = out.find((x) => x.programId === c.programId);
    if (a) {
      const legacy: OfferingSlot[] = a.startDate != null || a.locked ? [{ startDate: a.startDate ?? null, locked: a.locked, cohortId: a.cohortId, cohortName: a.cohortName }] : [];
      a.offerings = [...(a.offerings ?? legacy), slot]; a.goal += goal;
    } else out.push({ programId: c.programId, goal, offerings: [slot] });
  }
  return out;
}

/** What the allocations add up to, reading each slot the way its card does. */
export function allocatedTotal(allocs: Alloc[], slotGoal: (a: Alloc, o: OfferingSlot) => number, slotsOf: (a: Alloc) => OfferingSlot[]): number {
  return allocs.reduce((n, a) => n + slotsOf(a).reduce((m, o) => m + slotGoal(a, o), 0), 0);
}

/** A goal split evenly over n offerings in whole workers: 30 over 4 → 8, 8, 7, 7. */
export function spreadGoal(total: number, n: number): number[] {
  const count = Math.max(1, Math.floor(n));
  const whole = Math.max(0, Math.round(total));
  const base = Math.floor(whole / count), extra = whole - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

/** How many offerings a goal takes when each seats at most `maxCapacity` in term 1. */
export function offeringsNeeded(seatsNeeded: number, maxCapacity: number | null | undefined): number {
  return maxCapacity != null && maxCapacity > 0 ? Math.max(1, Math.ceil(seatsNeeded / maxCapacity - 1e-9)) : 1;
}

/** Sections a session runs as for an enrollment, by kind: the smallest session of each kind sets it. */
export function sectionsFor(seats: number, sessionMax: Partial<Record<"CLASS" | "LAB" | "CLINICAL", number>> | undefined): { kind: "CLASS" | "LAB" | "CLINICAL"; sections: number; max: number }[] {
  if (!sessionMax) return [];
  return (["CLASS", "LAB", "CLINICAL"] as const).filter((k) => sessionMax[k] != null && sessionMax[k]! > 0).map((k) => ({ kind: k, max: sessionMax[k]!, sections: Math.max(1, Math.ceil(seats / sessionMax[k]! - 1e-9)) }));
}
