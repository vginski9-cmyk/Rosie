// Clinical SUPPLY vs DEMAND at the grain clinical coordinators actually schedule
// on: unit category × weekday × shift block (Day / Evening / Night), on real
// dates. Supply follows the asset map (Unit_Config → Day_Grid): a functional
// unit hosts `studentsPerShift` students on each shift block it runs, on each
// weekday it is open. Demand is every dated clinical section from the capacity
// model, mapped from its rotation type to a unit category.

import type { DatedInstance } from "./capacitymodel";

export type ShiftBlock = "Day" | "Evening" | "Night";
export const SHIFT_BLOCKS: ShiftBlock[] = ["Day", "Evening", "Night"];
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface SupplyUnit {
  id: string; unitType: string; unitCategory: string; unitName: string | null;
  capacityCount: number | null; uom: string | null; dataSource: string;
  shiftsPerDay: number; shiftLengthHrs: number; shiftBlocks: string; days: string;
  studentsPerShift: number; studentsPerPreceptor: number; preceptorsPerShift: number;
}
export interface SupplySite {
  id: string; name: string; organization: string | null; facilityType: string | null; county: string | null; ring: string | null; city: string | null;
  status: string; agreementStatus: string;
  licensedBeds: number | null; nursingHomeBeds: number | null; adultCareBeds: number | null; operatingRooms: number | null; wblSlots: number | null;
  units: SupplyUnit[];
}
export interface RotationMap { rotationType: string; unitCategory: string; unitType: string | null; patientsPerStudent: number | null }

/** Which shift block a start time falls in (Day 07–15 · Evening 15–23 · Night 23–07). */
export function shiftBlockOf(startTime: string | null): ShiftBlock {
  if (!startTime) return "Day";
  const h = Number(startTime.split(":")[0]);
  if (h >= 7 && h < 15) return "Day";
  if (h >= 15 && h < 23) return "Evening";
  return "Night";
}
export const weekdayOfIso = (iso: string): Weekday => WEEKDAYS[(new Date(iso + "T00:00:00Z").getUTCDay() + 6) % 7];

const has = (csv: string, v: string) => csv.split(",").map((x) => x.trim()).includes(v);

/** Students a set of units can host on one weekday × block (and preceptors on hand). */
export function capacityAt(units: SupplyUnit[], category: string | null, weekday: Weekday, block: ShiftBlock) {
  let students = 0, preceptors = 0, unitsOpen = 0;
  for (const u of units) {
    if (category && u.unitCategory !== category) continue;
    if (!has(u.days, weekday) || !has(u.shiftBlocks, block)) continue;
    students += u.studentsPerShift; preceptors += u.preceptorsPerShift; unitsOpen += 1;
  }
  return { students, preceptors, unitsOpen };
}

export interface GridCell { students: number; preceptors: number; unitsOpen: number }
export type DayGrid = Record<string, Record<ShiftBlock, Record<Weekday, GridCell>>>; // category → block → weekday

/** The Day_Grid: students accommodatable + preceptors, per category × block × weekday. */
export function dayGrid(sites: SupplySite[], onlySecured = false): DayGrid {
  const units = sites.filter((s) => s.status !== "archived" && (!onlySecured || s.agreementStatus === "secured")).flatMap((s) => s.units);
  const cats = [...new Set(units.map((u) => u.unitCategory))].sort();
  const grid: DayGrid = {};
  for (const c of cats) {
    grid[c] = { Day: {} as Record<Weekday, GridCell>, Evening: {} as Record<Weekday, GridCell>, Night: {} as Record<Weekday, GridCell> };
    for (const b of SHIFT_BLOCKS) for (const w of WEEKDAYS) grid[c][b][w] = capacityAt(units, c, w, b);
  }
  return grid;
}

export interface DemandPoint {
  dateIso: string; weekday: Weekday; block: ShiftBlock;
  rotationType: string; category: string | null;
  students: number; sections: number; preceptors: number;
  cohort: string; program: string; courseCode: string | null; startTime: string | null;
}

/** Dated clinical demand, mapped to unit categories via the rotation settings. */
export function clinicalDemand(rows: DatedInstance[], rotations: RotationMap[]): DemandPoint[] {
  const map = new Map(rotations.map((r) => [r.rotationType.toLowerCase(), r]));
  const out: DemandPoint[] = [];
  for (const r of rows) {
    if (r.session.kind !== "CLINICAL" || !r.dateIso) continue;
    const rt = r.session.rotationType ?? "(unspecified)";
    const m = map.get(rt.toLowerCase()) ?? null;
    const Y = r.computed.Y ?? 0;
    out.push({
      dateIso: r.dateIso, weekday: weekdayOfIso(r.dateIso), block: shiftBlockOf(r.session.startTime ?? null),
      rotationType: rt, category: m?.unitCategory ?? null,
      students: Math.min(r.computed.C, Y * (r.session.maxStudents ?? 0)), sections: Y, preceptors: Y * (r.session.preceptorsNeeded ?? 0),
      cohort: r.cohort, program: r.program, courseCode: r.courseCode, startTime: r.session.startTime ?? null,
    });
  }
  return out;
}

export interface DateGap {
  dateIso: string; weekday: Weekday; block: ShiftBlock; category: string;
  demand: number; physical: number; secured: number;
  shortPhysical: number; shortSecured: number;
  rotationTypes: string[]; cohorts: string[];
}

/** Match demand to supply date by date: each (date, block, category) → students vs what sites can host. */
export function matchByDate(demand: DemandPoint[], physical: DayGrid, secured: DayGrid): DateGap[] {
  const acc = new Map<string, DateGap>();
  for (const d of demand) {
    if (!d.category) continue;
    const key = `${d.dateIso}|${d.block}|${d.category}`;
    const g = acc.get(key) ?? {
      dateIso: d.dateIso, weekday: d.weekday, block: d.block, category: d.category, demand: 0,
      physical: physical[d.category]?.[d.block]?.[d.weekday]?.students ?? 0,
      secured: secured[d.category]?.[d.block]?.[d.weekday]?.students ?? 0,
      shortPhysical: 0, shortSecured: 0, rotationTypes: [], cohorts: [],
    };
    g.demand += d.students;
    if (!g.rotationTypes.includes(d.rotationType)) g.rotationTypes.push(d.rotationType);
    if (!g.cohorts.includes(d.cohort)) g.cohorts.push(d.cohort);
    acc.set(key, g);
  }
  const out = [...acc.values()];
  for (const g of out) { g.shortPhysical = Math.max(0, g.demand - g.physical); g.shortSecured = Math.max(0, g.demand - g.secured); }
  return out.sort((a, b) => a.dateIso.localeCompare(b.dateIso) || a.block.localeCompare(b.block) || a.category.localeCompare(b.category));
}

export interface CategoryVerdict {
  category: string; rotationTypes: string[];
  peakDemand: number; peakDateIso: string | null; peakBlock: ShiftBlock | null;
  physicalAtPeak: number; securedAtPeak: number;
  studentDays: number; hostedPhysical: number; hostedSecured: number; shortDaysSecured: number;
  sitesPhysical: number; sitesSecured: number;
}

/** Per category: the verdict a coordinator needs — is there enough physical room, and enough SECURED room? */
export function categoryVerdicts(gaps: DateGap[], sites: SupplySite[]): CategoryVerdict[] {
  const cats = [...new Set(gaps.map((g) => g.category))].sort();
  return cats.map((category) => {
    const gs = gaps.filter((g) => g.category === category);
    const peak = gs.reduce((b, g) => (g.demand > (b?.demand ?? -1) ? g : b), null as DateGap | null);
    const withUnits = (secured: boolean) => sites.filter((s) => s.status !== "archived" && (!secured || s.agreementStatus === "secured") && s.units.some((u) => u.unitCategory === category)).length;
    return {
      category, rotationTypes: [...new Set(gs.flatMap((g) => g.rotationTypes))],
      peakDemand: peak?.demand ?? 0, peakDateIso: peak?.dateIso ?? null, peakBlock: peak?.block ?? null,
      physicalAtPeak: peak?.physical ?? 0, securedAtPeak: peak?.secured ?? 0,
      studentDays: gs.reduce((n, g) => n + g.demand, 0),
      hostedPhysical: gs.reduce((n, g) => n + Math.min(g.demand, g.physical), 0),
      hostedSecured: gs.reduce((n, g) => n + Math.min(g.demand, g.secured), 0),
      shortDaysSecured: gs.filter((g) => g.shortSecured > 0).length,
      sitesPhysical: withUnits(false), sitesSecured: withUnits(true),
    };
  });
}
