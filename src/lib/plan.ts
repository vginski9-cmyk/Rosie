// Integrated planning engine — where everything meets.
//
// This is the hub the whole product feeds. It takes a program's authored
// structure (the one-student archetype) plus a SERIES of cohorts entering over
// time, overlays them on the academic calendar so that several cohorts are
// in-flight at once, sums the capacity DEMAND they create concurrently in each
// academic term, and reconciles that against SUPPLY (faculty FTE, preceptors,
// employer WBL slots) to surface bottlenecks.
//
//   demand → North Star → funnel → seats/cohort
//        → cohort series × calendar overlay → concurrent demand per term
//        → reconcile vs supply → bottlenecks
//
// Pure + testable; consumes the capacity engine.

import {
  termDemand,
  DEFAULT_CONFIG,
  type TermArchetype,
  type DemandTotals,
  type CapacityConfig,
} from "./capacity";
import { ordinalOf, termFromOrdinal, type AcademicTerm, type TermCode } from "./calendar";

/** Default per-program-term retention (Term 1 = 1.0), gentle decline. */
export const DEFAULT_ATTRITION = [1.0, 0.94, 0.88, 0.82, 0.76, 0.7, 0.66, 0.62];

export interface CohortSeed {
  id: string;
  label: string;
  entryCode: TermCode;
  entryFallYear: number;
  /** Planned students entering Term 1. */
  termOneSeats: number;
}

export interface Supply {
  /** Instructional FTE available each academic term. */
  facultyFte: number;
  /** Preceptor placements available each academic term. */
  preceptors: number;
  /** Employer-hosted clinical/WBL slots available each academic term. */
  wblSlots: number;
}

export interface ActiveSegment {
  cohortId: string;
  cohortLabel: string;
  programTermIndex: number;
  programTermName: string;
  enrollment: number;
}

export interface GapLine {
  demand: number;
  supply: number;
  /** supply − demand. Negative = bottleneck. */
  gap: number;
  utilization: number; // demand / supply (Infinity-safe → 0 when no supply & no demand)
}

export interface AcademicTermPlan {
  term: AcademicTerm;
  active: ActiveSegment[];
  demand: DemandTotals;
  supply: Supply;
  gaps: { clinicalSlots: GapLine; facultyFte: GapLine; preceptors: GapLine };
  bottlenecks: string[];
}

export interface AcademicPlan {
  terms: AcademicTermPlan[];
  peak: { facultyFte: number; clinicalSlots: number; preceptors: number };
  hasBottleneck: boolean;
  bottleneckCount: number;
}

const EMPTY_TOTALS: DemandTotals = {
  sections: 0, classSections: 0, labSections: 0, clinicalSections: 0, wblSlots: 0,
  facultyContactHours: 0, studentContactHours: 0, roomHours: 0, classRoomHours: 0,
  labRoomHours: 0, clinicalRoomHours: 0, preceptorInstances: 0, supportInstances: 0, facultyFTE: 0,
};

function addTotals(a: DemandTotals, b: DemandTotals): DemandTotals {
  const out = { ...a };
  (Object.keys(EMPTY_TOTALS) as (keyof DemandTotals)[]).forEach((k) => (out[k] = a[k] + b[k]));
  return out;
}

function gapLine(demand: number, supply: number): GapLine {
  return { demand, supply, gap: supply - demand, utilization: supply > 0 ? demand / supply : demand > 0 ? Infinity : 0 };
}

export interface PlanOptions {
  attrition?: number[];
  config?: CapacityConfig;
}

/**
 * Build the integrated multi-cohort academic plan for one program.
 */
export function buildAcademicPlan(
  programTerms: TermArchetype[],
  cohorts: CohortSeed[],
  supply: Supply,
  opts: PlanOptions = {},
): AcademicPlan {
  const attrition = opts.attrition ?? DEFAULT_ATTRITION;
  const cfg = opts.config ?? DEFAULT_CONFIG;
  const ordered = [...programTerms].sort((a, b) => a.index - b.index);

  // Map academic-term ordinal → active segments (a cohort sitting in a program-term).
  const byOrdinal = new Map<number, ActiveSegment[]>();
  for (const cohort of cohorts) {
    const start = ordinalOf(cohort.entryCode, cohort.entryFallYear);
    ordered.forEach((pt, i) => {
      const ordinal = start + i;
      const enrollment = Math.round(cohort.termOneSeats * (attrition[i] ?? attrition[attrition.length - 1]));
      if (enrollment <= 0) return;
      const seg: ActiveSegment = {
        cohortId: cohort.id,
        cohortLabel: cohort.label,
        programTermIndex: pt.index,
        programTermName: pt.name,
        enrollment,
      };
      if (!byOrdinal.has(ordinal)) byOrdinal.set(ordinal, []);
      byOrdinal.get(ordinal)!.push(seg);
    });
  }

  const ptByIndex = new Map(ordered.map((pt) => [pt.index, pt]));
  const ordinals = [...byOrdinal.keys()].sort((a, b) => a - b);

  const terms: AcademicTermPlan[] = ordinals.map((ordinal) => {
    const active = byOrdinal.get(ordinal)!;
    let demand: DemandTotals = { ...EMPTY_TOTALS };
    for (const seg of active) {
      const pt = ptByIndex.get(seg.programTermIndex);
      if (!pt) continue;
      demand = addTotals(demand, termDemand(pt, seg.enrollment, cfg).totals);
    }
    const gaps = {
      clinicalSlots: gapLine(demand.clinicalSections, supply.wblSlots),
      facultyFte: gapLine(demand.facultyFTE, supply.facultyFte),
      preceptors: gapLine(demand.preceptorInstances, supply.preceptors),
    };
    const bottlenecks: string[] = [];
    if (gaps.clinicalSlots.gap < 0) bottlenecks.push(`Clinical/WBL slots short by ${Math.ceil(-gaps.clinicalSlots.gap)}`);
    if (gaps.facultyFte.gap < 0) bottlenecks.push(`Faculty short by ${(-gaps.facultyFte.gap).toFixed(1)} FTE`);
    if (gaps.preceptors.gap < 0) bottlenecks.push(`Preceptors short by ${Math.ceil(-gaps.preceptors.gap)}`);

    return { term: termFromOrdinal(ordinal), active, demand, supply, gaps, bottlenecks };
  });

  const peak = {
    facultyFte: Math.max(0, ...terms.map((t) => t.demand.facultyFTE)),
    clinicalSlots: Math.max(0, ...terms.map((t) => t.demand.clinicalSections)),
    preceptors: Math.max(0, ...terms.map((t) => t.demand.preceptorInstances)),
  };
  const bottleneckCount = terms.reduce((n, t) => n + t.bottlenecks.length, 0);

  return { terms, peak, hasBottleneck: bottleneckCount > 0, bottleneckCount };
}

/**
 * Generate a cohort series from per-year planned seats (e.g. ProgramYearTarget
 * cohortCapacity). One cohort enters each Fall.
 */
export function cohortSeriesFromYearTargets(
  seatsByYear: { year: number; seats: number }[],
  entryCode: TermCode = "FALL",
): CohortSeed[] {
  return seatsByYear
    .filter((y) => y.seats > 0)
    .map((y) => ({ id: `cohort-${y.year}`, label: `Entering ${entryCode === "FALL" ? "Fall" : ""} ${y.year}`.trim(), entryCode, entryFallYear: y.year, termOneSeats: y.seats }));
}

/** Merge several program plans into one institution-level plan (sums demand). */
export function mergePlans(plans: AcademicPlan[], supply: Supply): AcademicPlan {
  const byOrdinal = new Map<number, AcademicTermPlan>();
  for (const plan of plans) {
    for (const tp of plan.terms) {
      const ord = tp.term.ordinal;
      const existing = byOrdinal.get(ord);
      if (!existing) {
        byOrdinal.set(ord, { ...tp, active: [...tp.active], demand: { ...tp.demand } });
      } else {
        existing.active.push(...tp.active);
        existing.demand = addTotals(existing.demand, tp.demand);
      }
    }
  }
  const terms = [...byOrdinal.values()].sort((a, b) => a.term.ordinal - b.term.ordinal).map((tp) => {
    const gaps = {
      clinicalSlots: gapLine(tp.demand.clinicalSections, supply.wblSlots),
      facultyFte: gapLine(tp.demand.facultyFTE, supply.facultyFte),
      preceptors: gapLine(tp.demand.preceptorInstances, supply.preceptors),
    };
    const bottlenecks: string[] = [];
    if (gaps.clinicalSlots.gap < 0) bottlenecks.push(`Clinical/WBL slots short by ${Math.ceil(-gaps.clinicalSlots.gap)}`);
    if (gaps.facultyFte.gap < 0) bottlenecks.push(`Faculty short by ${(-gaps.facultyFte.gap).toFixed(1)} FTE`);
    if (gaps.preceptors.gap < 0) bottlenecks.push(`Preceptors short by ${Math.ceil(-gaps.preceptors.gap)}`);
    return { ...tp, supply, gaps, bottlenecks };
  });
  const peak = {
    facultyFte: Math.max(0, ...terms.map((t) => t.demand.facultyFTE)),
    clinicalSlots: Math.max(0, ...terms.map((t) => t.demand.clinicalSections)),
    preceptors: Math.max(0, ...terms.map((t) => t.demand.preceptorInstances)),
  };
  const bottleneckCount = terms.reduce((n, t) => n + t.bottlenecks.length, 0);
  return { terms, peak, hasBottleneck: bottleneckCount > 0, bottleneckCount };
}
