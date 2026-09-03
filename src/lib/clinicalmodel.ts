// A program family's CLINICAL MODEL — hours-based (set hours per student in
// each service area, per course) or competency-based — matched week by week
// against three layers of supply in the settings that serve each area:
//   physical  = every asset's operating rule (the 365-day map) × learners/shift
//   offered   = shifts a site has allocated to THIS family (SettingAllocation)
//   booked    = learners actually booked onto assets
// All by setting, by week, and by region (county / ring). Pure functions.

import { assetSupply, isoRange, isoAdd, type AssetLite, type AssetDayOverride, type AssetBookingLite } from "./assetmap";
import type { ShiftBlock } from "./clinicalsupply";

export interface ServiceAreaLite { id: string; code: string; name: string; settingCodes: string[]; sortOrder: number }
export interface RequirementLite { courseId: string; serviceAreaId: string; hoursPerStudent: number; casesPerStudent?: number | null }
/** One course of one offering with its real window and enrolled students. */
export interface CourseWindow { cohortId: string; cohort: string; programId: string; program: string; courseId: string; courseCode: string | null; courseName: string; termIndex: number; students: number; startIso: string | null; weeks: number }
export interface AllocationLite { employerId: string; facilityName?: string; county?: string | null; ring?: string | null; settingCode: string; block: string; shiftsPerWeek: number; hoursPerShift: number; learnersPerShift: number; from: string | null; to: string | null }

export const mondayOf = (iso: string) => isoAdd(iso, -((new Date(iso + "T00:00:00Z").getUTCDay() + 6) % 7));

// ── Demand: hours per week, per service area, from each offering's courses ────
export interface DemandWeek { weekIso: string; areaId: string; hours: number; students: number; courses: string[] }
export function weeklyDemand(windows: CourseWindow[], reqs: RequirementLite[]): DemandWeek[] {
  const byCourse = new Map<string, RequirementLite[]>();
  for (const r of reqs) { const l = byCourse.get(r.courseId) ?? []; l.push(r); byCourse.set(r.courseId, l); }
  const acc = new Map<string, DemandWeek>();
  for (const w of windows) {
    if (!w.startIso || w.weeks <= 0 || w.students <= 0) continue;
    const rs = byCourse.get(w.courseId) ?? [];
    let monday = mondayOf(w.startIso);
    for (let i = 0; i < w.weeks; i++, monday = isoAdd(monday, 7)) {
      for (const r of rs) {
        if (r.hoursPerStudent <= 0) continue;
        const k = `${monday}|${r.serviceAreaId}`;
        const d = acc.get(k) ?? { weekIso: monday, areaId: r.serviceAreaId, hours: 0, students: 0, courses: [] };
        d.hours += (w.students * r.hoursPerStudent) / w.weeks; d.students += w.students;
        const label = `${w.courseCode ?? w.courseName} · ${w.cohort}`; if (!d.courses.includes(label)) d.courses.push(label);
        acc.set(k, d);
      }
    }
  }
  return [...acc.values()].sort((a, b) => a.weekIso.localeCompare(b.weekIso) || a.areaId.localeCompare(b.areaId));
}

/** Demand hours per week per SETTING: an area's hours split evenly across the settings that serve it. */
export function demandBySetting(demand: DemandWeek[], areas: ServiceAreaLite[]): Map<string, number> {
  const areaById = new Map(areas.map((a) => [a.id, a]));
  const out = new Map<string, number>();
  for (const d of demand) {
    const a = areaById.get(d.areaId); const codes = a?.settingCodes.length ? a.settingCodes : ["(unmapped)"];
    for (const c of codes) { const k = `${d.weekIso}|${c}`; out.set(k, (out.get(k) ?? 0) + d.hours / codes.length); }
  }
  return out;
}

// ── Supply: hours per week, per setting, three layers, with region splits ────
export interface SupplyWeek {
  weekIso: string; settingCode: string;
  physicalHours: number; physicalShifts: number; offeredHours: number; offeredShifts: number; bookedHours: number; bookedShifts: number;
  /** Physical / offered hours by region key ("county:Moore", "ring:Core"). */
  byRegion: Record<string, { physical: number; offered: number }>;
}
export function weeklySupply(assets: AssetLite[], overrides: AssetDayOverride[], allocations: AllocationLite[], bookings: AssetBookingLite[], from: string, to: string): SupplyWeek[] {
  const start = mondayOf(from), end = isoAdd(mondayOf(to), 6);
  const cells = assetSupply(assets, overrides, start, end);
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const acc = new Map<string, SupplyWeek>();
  const get = (weekIso: string, code: string) => { const k = `${weekIso}|${code}`; let s = acc.get(k); if (!s) { s = { weekIso, settingCode: code, physicalHours: 0, physicalShifts: 0, offeredHours: 0, offeredShifts: 0, bookedHours: 0, bookedShifts: 0, byRegion: {} }; acc.set(k, s); } return s; };
  const region = (s: SupplyWeek, keys: string[], physical: number, offered: number) => { for (const k of keys) { const r = s.byRegion[k] ?? { physical: 0, offered: 0 }; r.physical += physical; r.offered += offered; s.byRegion[k] = r; } };
  for (const c of cells.values()) {
    const s = get(mondayOf(c.iso), c.settingCode);
    for (const id of c.assetIds) {
      const a = assetById.get(id)!; const h = a.hoursPerShift * a.learnersPerShift;
      s.physicalHours += h; s.physicalShifts += a.learnersPerShift;
      region(s, [`county:${a.county ?? "?"}`, `ring:${a.ring ?? "?"}`], h, 0);
    }
  }
  for (let monday = start; monday <= end; monday = isoAdd(monday, 7)) {
    for (const al of allocations) {
      if (al.from && isoAdd(monday, 6) < al.from) continue;
      if (al.to && monday > al.to) continue;
      const s = get(monday, al.settingCode);
      const h = al.shiftsPerWeek * al.hoursPerShift * al.learnersPerShift;
      s.offeredHours += h; s.offeredShifts += al.shiftsPerWeek * al.learnersPerShift;
      region(s, [`county:${al.county ?? "?"}`, `ring:${al.ring ?? "?"}`], 0, h);
    }
  }
  for (const b of bookings) {
    const a = assetById.get(b.assetId); if (!a) continue;
    const s = get(mondayOf(b.date), a.settingCode);
    s.bookedHours += b.students * a.hoursPerShift; s.bookedShifts += b.students;
  }
  return [...acc.values()].sort((a, b) => a.weekIso.localeCompare(b.weekIso) || a.settingCode.localeCompare(b.settingCode));
}

// ── The match: per week × setting, and rolled up ──────────────────────────────
export interface MatchWeek extends SupplyWeek { demandHours: number; shortPhysical: number; shortOffered: number; unbooked: number }
export function matchWeekly(demand: DemandWeek[], areas: ServiceAreaLite[], supply: SupplyWeek[]): MatchWeek[] {
  const dem = demandBySetting(demand, areas);
  const bySupply = new Map(supply.map((s) => [`${s.weekIso}|${s.settingCode}`, s]));
  const keys = new Set([...dem.keys(), ...bySupply.keys()]);
  const out: MatchWeek[] = [];
  for (const k of keys) {
    const [weekIso, settingCode] = k.split("|");
    const s = bySupply.get(k) ?? { weekIso, settingCode, physicalHours: 0, physicalShifts: 0, offeredHours: 0, offeredShifts: 0, bookedHours: 0, bookedShifts: 0, byRegion: {} };
    const d = dem.get(k) ?? 0;
    if (d === 0 && s.physicalHours === 0) continue;
    out.push({ ...s, demandHours: d, shortPhysical: Math.max(0, d - s.physicalHours), shortOffered: Math.max(0, d - s.offeredHours), unbooked: Math.max(0, d - s.bookedHours) });
  }
  return out.sort((a, b) => a.weekIso.localeCompare(b.weekIso) || a.settingCode.localeCompare(b.settingCode));
}

export interface SettingSummary { settingCode: string; weeks: number; weeksWithDemand: number; demandHours: number; physicalHours: number; offeredHours: number; bookedHours: number; shortOfferedWeeks: number; shortPhysicalWeeks: number; peak: MatchWeek | null; peakOfferedShare: number }
export function settingSummaries(rows: MatchWeek[]): SettingSummary[] {
  const codes = [...new Set(rows.map((r) => r.settingCode))].sort();
  return codes.map((code) => {
    const rs = rows.filter((r) => r.settingCode === code);
    const withD = rs.filter((r) => r.demandHours > 0);
    const peak = withD.reduce<MatchWeek | null>((b, r) => (r.demandHours > (b?.demandHours ?? -1) ? r : b), null);
    const sum = (f: (r: MatchWeek) => number) => rs.reduce((n, r) => n + f(r), 0);
    return { settingCode: code, weeks: rs.length, weeksWithDemand: withD.length, demandHours: sum((r) => r.demandHours), physicalHours: sum((r) => r.physicalHours), offeredHours: sum((r) => r.offeredHours), bookedHours: sum((r) => r.bookedHours),
      shortOfferedWeeks: withD.filter((r) => r.shortOffered > 0).length, shortPhysicalWeeks: withD.filter((r) => r.shortPhysical > 0).length, peak, peakOfferedShare: peak && peak.demandHours > 0 ? peak.offeredHours / peak.demandHours : 0 };
  });
}

/** Demand and supply hours in the window by region key — where the hours can come from vs where the college sits. */
export function regionRollup(rows: MatchWeek[]): { key: string; physical: number; offered: number }[] {
  const acc = new Map<string, { physical: number; offered: number }>();
  for (const r of rows) for (const [k, v] of Object.entries(r.byRegion)) { const a = acc.get(k) ?? { physical: 0, offered: 0 }; a.physical += v.physical; a.offered += v.offered; acc.set(k, a); }
  return [...acc.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => a.key.localeCompare(b.key));
}

/** Per-student and per-course totals of the requirement grid — the workbook's totals row. */
export function requirementTotals(reqs: RequirementLite[], courses: { id: string; weeks: number }[]) {
  const perStudent = reqs.reduce((n, r) => n + r.hoursPerStudent, 0);
  const byCourse = new Map<string, number>();
  for (const r of reqs) byCourse.set(r.courseId, (byCourse.get(r.courseId) ?? 0) + r.hoursPerStudent);
  const weeklyPerStudent = courses.reduce((n, c) => n + (byCourse.get(c.id) ?? 0) / Math.max(1, c.weeks), 0);
  return { perStudent, byCourse, weeklyPerStudent };
}

/** Spread a week's demand across its clinical days (Mon–Fri by default) — for the date-level board. */
export function dailyFromWeekly(hours: number, days = 5): number { return days > 0 ? hours / days : 0; }
export const SUPPLY_BLOCKS: ShiftBlock[] = ["Day", "Evening", "Night"];
export { isoRange };
