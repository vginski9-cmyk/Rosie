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
import { CYCLE, deliveryOrdinals, ordinalOfCalendar, termFromOrdinal, type AcademicTerm, type TermCode } from "./calendar";

/** Default per-program-term retention (Term 1 = 1.0), gentle decline. */
export const DEFAULT_ATTRITION = [1.0, 0.94, 0.88, 0.82, 0.76, 0.7, 0.66, 0.62, 0.6, 0.58, 0.56, 0.54];

export interface CohortSeed {
  id: string;
  label: string;
  /** Absolute academic-term ordinal at which this cohort starts Term 1. */
  entryOrdinal: number;
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
  /** Calendar slots the program delivers in; inactive slots are skipped. */
  activeCodes?: TermCode[];
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
  const activeCodes = opts.activeCodes ?? CYCLE;
  const ordered = [...programTerms].sort((a, b) => a.index - b.index);

  // Map academic-term ordinal → active segments (a cohort sitting in a program-term).
  // Program-terms are placed on the program's DELIVERY calendar, skipping any
  // calendar slots the program doesn't run in.
  const byOrdinal = new Map<number, ActiveSegment[]>();
  for (const cohort of cohorts) {
    const ords = deliveryOrdinals(cohort.entryOrdinal, ordered.length, activeCodes);
    ordered.forEach((pt, i) => {
      const ordinal = ords[i];
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

export type LaunchCadence = "ANNUAL" | "BIENNIAL" | "MULTI_PER_YEAR" | "ON_DEMAND";

export interface LaunchConfig {
  cadence: LaunchCadence;
  /** Term codes a cohort launches in (one for annual/biennial, several for multi). */
  launchTerms: TermCode[];
  /** Years between launch cycles (2 = biennial). */
  intervalYears: number;
  startYear: number; // calendar year
  endYear: number;
  /** Planned Term-1 seats by calendar year (falls back to defaultSeats). */
  seatsByYear: Record<number, number>;
  defaultSeats: number;
}

export interface ExplicitCohort {
  id: string;
  label: string;
  entryCode: TermCode;
  entryCalendarYear: number;
  seats: number;
}

const capTerm = (c: TermCode) => c.charAt(0) + c.slice(1).toLowerCase();

/**
 * Generate the cohort series from a launch cadence. Supports annual, biennial
 * (intervalYears > 1), multiple-per-year (several launchTerms), and on-demand
 * (explicit cohorts only). The result is many concurrent cohorts for long
 * programs / frequent launches.
 */
export function generateCohortSeries(cfg: LaunchConfig, explicit: ExplicitCohort[] = []): CohortSeed[] {
  const toSeed = (e: ExplicitCohort): CohortSeed => ({
    id: e.id,
    label: e.label,
    entryOrdinal: ordinalOfCalendar(e.entryCode, e.entryCalendarYear),
    termOneSeats: Math.round(e.seats),
  });

  if (cfg.cadence === "ON_DEMAND") return explicit.filter((e) => e.seats > 0).map(toSeed);

  const interval = Math.max(1, cfg.cadence === "BIENNIAL" ? Math.max(2, cfg.intervalYears) : cfg.intervalYears || 1);
  const terms = cfg.launchTerms.length ? cfg.launchTerms : (["FALL"] as TermCode[]);
  const series: CohortSeed[] = [];
  for (let year = cfg.startYear; year <= cfg.endYear; year += interval) {
    for (const code of terms) {
      const seats = cfg.seatsByYear[year] ?? cfg.defaultSeats;
      if (seats > 0) {
        series.push({
          id: `c-${year}-${code}`,
          label: `${capTerm(code)} ${year}`,
          entryOrdinal: ordinalOfCalendar(code, year),
          termOneSeats: Math.round(seats),
        });
      }
    }
  }
  // Explicit cohorts can augment a generated cadence (e.g. an extra ad-hoc start).
  return [...series, ...explicit.filter((e) => e.seats > 0).map(toSeed)];
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
