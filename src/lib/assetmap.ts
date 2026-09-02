// The 365-day clinical asset map — the grain clinical partners actually report
// at: one PHYSICAL asset (a radiographic room, an ED room, a portable, a C-arm,
// a fluoro room …) × every calendar date × shift block. Pure functions:
//   • the map itself: operating rule + per-date exceptions → which blocks each
//     asset runs on each date (the physical ceiling)
//   • totals & reconciliation, the way the partner workbook reports them
//   • supply (assets × learners-per-shift) vs demand (dated clinical sections
//     mapped by rotation type → setting code) vs what is already booked
//   • parsing the partner workbook (ASSET_MAP + 365_SHIFT_MAP) and writing it back out

import type { DatedInstance } from "./capacitymodel";
import { shiftBlockOf, weekdayOfIso, type ShiftBlock, type Weekday } from "./clinicalsupply";

export const ASSET_BLOCKS: ShiftBlock[] = ["Day", "Evening", "Night"];
const ALL_DAYS = "Mon,Tue,Wed,Thu,Fri,Sat,Sun";

export interface AssetLite {
  id: string; externalId: string | null; employerId: string;
  facilityName: string; facilityExternalId?: string | null; county?: string | null; ring?: string | null; facilityType?: string | null;
  agreementStatus?: string; facilityStatus?: string;
  settingCode: string; setting: string; assetType: string; assetNumber: number;
  operatingRule: string; days: string; shiftBlocks: string; hoursPerShift: number;
  serves: string | null; learnersPerShift: number; preceptorsPerShift: number; dataSource: string; status: string;
}
export interface AssetDayOverride { assetId: string; date: string; shiftBlocks: string; note?: string | null }
export interface AssetBookingLite { id: string; assetId: string; cohortId: string; sessionId: string | null; sectionIndex: number; date: string; block: string; students: number; cohort?: string; program?: string; courseCode?: string | null }

const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
export const isoAdd = (iso: string, days: number) => new Date(new Date(iso + "T00:00:00Z").getTime() + days * 86400000).toISOString().slice(0, 10);
export function* isoRange(from: string, to: string) { for (let d = from; d <= to; d = isoAdd(d, 1)) yield d; }

/** Operating rule → (days, blocks). Custom rules keep what the asset row says. */
export function ruleDefaults(rule: string): { days: string; shiftBlocks: string } | null {
  const r = rule.trim().toLowerCase();
  if (r === "24x7" || r === "24/7") return { days: ALL_DAYS, shiftBlocks: "Day,Evening,Night" };
  if (r === "weekday day") return { days: "Mon,Tue,Wed,Thu,Fri", shiftBlocks: "Day" };
  if (r === "weekday day+evening" || r === "weekday day/evening") return { days: "Mon,Tue,Wed,Thu,Fri", shiftBlocks: "Day,Evening" };
  if (r === "7-day day") return { days: ALL_DAYS, shiftBlocks: "Day" };
  return null;
}

/** Shift blocks an asset operates on one date: its rule, unless an exception says otherwise. */
export function blocksOn(asset: AssetLite, iso: string, override?: AssetDayOverride | null): ShiftBlock[] {
  if (override) return csv(override.shiftBlocks) as ShiftBlock[];
  const wd: Weekday = weekdayOfIso(iso);
  if (!csv(asset.days).includes(wd)) return [];
  return csv(asset.shiftBlocks).filter((b): b is ShiftBlock => (ASSET_BLOCKS as string[]).includes(b));
}

export const overrideKey = (assetId: string, iso: string) => `${assetId}|${iso}`;
export function overrideIndex(overrides: AssetDayOverride[]): Map<string, AssetDayOverride> {
  return new Map(overrides.map((o) => [overrideKey(o.assetId, o.date), o]));
}

// ── Totals, the way the partner workbook reports them ─────────────────────────
export interface SettingTotal { settingCode: string; setting: string; assets: number; day: number; evening: number; night: number; total: number; hours: number }
export interface FacilityTotal { employerId: string; facility: string; settingCode: string; setting: string; assets: number; block: ShiftBlock; daysAvailable: number; assetShifts: number; hours: number }

/** Asset-shifts available across a date window, by setting and by facility × setting × block. */
export function assetTotals(assets: AssetLite[], overrides: AssetDayOverride[], from: string, to: string) {
  const ov = overrideIndex(overrides);
  const bySetting = new Map<string, SettingTotal>();
  const byFacility = new Map<string, FacilityTotal>();
  let days = 0;
  for (const _ of isoRange(from, to)) days++;
  for (const a of assets) {
    if (a.status === "archived") continue;
    const st = bySetting.get(a.settingCode) ?? { settingCode: a.settingCode, setting: a.setting, assets: 0, day: 0, evening: 0, night: 0, total: 0, hours: 0 };
    st.assets++;
    const perBlock: Record<ShiftBlock, number> = { Day: 0, Evening: 0, Night: 0 };
    for (const iso of isoRange(from, to)) for (const b of blocksOn(a, iso, ov.get(overrideKey(a.id, iso)))) perBlock[b]++;
    st.day += perBlock.Day; st.evening += perBlock.Evening; st.night += perBlock.Night;
    st.total += perBlock.Day + perBlock.Evening + perBlock.Night; st.hours += (perBlock.Day + perBlock.Evening + perBlock.Night) * a.hoursPerShift;
    bySetting.set(a.settingCode, st);
    for (const b of ASSET_BLOCKS) {
      const k = `${a.employerId}|${a.settingCode}|${b}`;
      const ft = byFacility.get(k) ?? { employerId: a.employerId, facility: a.facilityName, settingCode: a.settingCode, setting: a.setting, assets: 0, block: b, daysAvailable: 0, assetShifts: 0, hours: 0 };
      ft.assets++; ft.assetShifts += perBlock[b]; ft.daysAvailable = Math.max(ft.daysAvailable, perBlock[b]); ft.hours += perBlock[b] * a.hoursPerShift;
      byFacility.set(k, ft);
    }
  }
  const settings = [...bySetting.values()].sort((x, y) => y.assets - x.assets);
  const grand = settings.reduce((g, s) => ({ assets: g.assets + s.assets, day: g.day + s.day, evening: g.evening + s.evening, night: g.night + s.night, total: g.total + s.total, hours: g.hours + s.hours }), { assets: 0, day: 0, evening: 0, night: 0, total: 0, hours: 0 });
  return { days, settings, facilities: [...byFacility.values()].filter((f) => f.assetShifts > 0).sort((x, y) => x.facility.localeCompare(y.facility) || x.settingCode.localeCompare(y.settingCode)), grand };
}

// ── Supply vs demand vs booked, per date × block × setting ────────────────────
export interface AssetSupplyCell {
  iso: string; block: ShiftBlock; settingCode: string;
  /** Assets operating (physical ceiling) and the learner seats they carry. */
  assets: number; learners: number; securedAssets: number; securedLearners: number;
  assetIds: string[];
}
export function assetSupply(assets: AssetLite[], overrides: AssetDayOverride[], from: string, to: string): Map<string, AssetSupplyCell> {
  const ov = overrideIndex(overrides);
  const out = new Map<string, AssetSupplyCell>();
  for (const a of assets) {
    if (a.status === "archived" || a.facilityStatus === "archived") continue;
    const secured = a.agreementStatus === "secured";
    for (const iso of isoRange(from, to)) {
      for (const b of blocksOn(a, iso, ov.get(overrideKey(a.id, iso)))) {
        const k = `${iso}|${b}|${a.settingCode}`;
        const c = out.get(k) ?? { iso, block: b, settingCode: a.settingCode, assets: 0, learners: 0, securedAssets: 0, securedLearners: 0, assetIds: [] };
        c.assets++; c.learners += a.learnersPerShift; c.assetIds.push(a.id);
        if (secured) { c.securedAssets++; c.securedLearners += a.learnersPerShift; }
        out.set(k, c);
      }
    }
  }
  return out;
}

export interface RotationCode { rotationType: string; settingCode: string | null }
export interface AssetDemandPoint { iso: string; block: ShiftBlock; settingCode: string | null; rotationType: string; students: number; sections: number; cohortId: string; cohort: string; program: string; courseCode: string | null; sessionId: string; startTime: string | null }

/** Dated clinical demand mapped to setting codes (rotation type → code). */
export function assetDemand(rows: DatedInstance[], rotations: RotationCode[]): AssetDemandPoint[] {
  const map = new Map(rotations.map((r) => [r.rotationType.toLowerCase(), r.settingCode]));
  const out: AssetDemandPoint[] = [];
  for (const r of rows) {
    if (r.session.kind !== "CLINICAL" || !r.dateIso) continue;
    const rt = r.session.rotationType ?? "(unspecified)";
    const Y = r.computed.Y ?? 0;
    out.push({ iso: r.dateIso, block: shiftBlockOf(r.session.startTime ?? null), settingCode: map.get(rt.toLowerCase()) ?? null, rotationType: rt,
      students: Math.min(r.computed.C, Y * (r.session.maxStudents ?? 0)), sections: Y, cohortId: r.cohortId, cohort: r.cohort, program: r.program, courseCode: r.courseCode, sessionId: r.session.id, startTime: r.session.startTime ?? null });
  }
  return out;
}

export interface AssetMatchCell extends AssetSupplyCell {
  demand: number; booked: number; shortPhysical: number; shortSecured: number; unbooked: number;
  rotationTypes: string[]; cohorts: string[];
}
/** Every date × block × setting with demand: physical seats, secured seats, demand, booked, shortfalls. */
export function assetMatch(demand: AssetDemandPoint[], supply: Map<string, AssetSupplyCell>, bookings: AssetBookingLite[], assetById: Map<string, AssetLite>): AssetMatchCell[] {
  const booked = new Map<string, number>();
  for (const b of bookings) { const a = assetById.get(b.assetId); if (!a) continue; const k = `${b.date}|${b.block}|${a.settingCode}`; booked.set(k, (booked.get(k) ?? 0) + b.students); }
  const acc = new Map<string, AssetMatchCell>();
  for (const d of demand) {
    if (!d.settingCode) continue;
    const k = `${d.iso}|${d.block}|${d.settingCode}`;
    const s = supply.get(k);
    const c = acc.get(k) ?? { iso: d.iso, block: d.block, settingCode: d.settingCode, assets: s?.assets ?? 0, learners: s?.learners ?? 0, securedAssets: s?.securedAssets ?? 0, securedLearners: s?.securedLearners ?? 0, assetIds: s?.assetIds ?? [], demand: 0, booked: booked.get(k) ?? 0, shortPhysical: 0, shortSecured: 0, unbooked: 0, rotationTypes: [], cohorts: [] };
    c.demand += d.students;
    if (!c.rotationTypes.includes(d.rotationType)) c.rotationTypes.push(d.rotationType);
    if (!c.cohorts.includes(d.cohort)) c.cohorts.push(d.cohort);
    acc.set(k, c);
  }
  const out = [...acc.values()];
  for (const c of out) { c.shortPhysical = Math.max(0, c.demand - c.learners); c.shortSecured = Math.max(0, c.demand - c.securedLearners); c.unbooked = Math.max(0, c.demand - c.booked); }
  return out.sort((a, b) => a.iso.localeCompare(b.iso) || ASSET_BLOCKS.indexOf(a.block) - ASSET_BLOCKS.indexOf(b.block) || a.settingCode.localeCompare(b.settingCode));
}

export interface SettingVerdict { settingCode: string; setting: string; rotationTypes: string[]; demandShifts: number; hostedPhysical: number; hostedSecured: number; booked: number; shortDays: number; peak: AssetMatchCell | null; assetsPhysical: number; assetsSecured: number }
export function settingVerdicts(cells: AssetMatchCell[], assets: AssetLite[]): SettingVerdict[] {
  const codes = [...new Set(cells.map((c) => c.settingCode))].sort();
  return codes.map((code) => {
    const cs = cells.filter((c) => c.settingCode === code);
    const as = assets.filter((a) => a.settingCode === code && a.status !== "archived");
    return {
      settingCode: code, setting: as[0]?.setting ?? code, rotationTypes: [...new Set(cs.flatMap((c) => c.rotationTypes))],
      demandShifts: cs.reduce((n, c) => n + c.demand, 0), hostedPhysical: cs.reduce((n, c) => n + Math.min(c.demand, c.learners), 0), hostedSecured: cs.reduce((n, c) => n + Math.min(c.demand, c.securedLearners), 0),
      booked: cs.reduce((n, c) => n + Math.min(c.demand, c.booked), 0), shortDays: cs.filter((c) => c.shortSecured > 0).length,
      peak: cs.reduce<AssetMatchCell | null>((b, c) => (c.demand > (b?.demand ?? -1) ? c : b), null),
      assetsPhysical: as.length, assetsSecured: as.filter((a) => a.agreementStatus === "secured").length,
    };
  });
}

/** For one date × block × setting: each operating asset, its learner seats, and what is booked on it. */
export function assetsAvailable(assets: AssetLite[], overrides: AssetDayOverride[], bookings: AssetBookingLite[], iso: string, block: ShiftBlock, settingCode: string | null) {
  const ov = overrideIndex(overrides);
  return assets
    .filter((a) => a.status !== "archived" && (!settingCode || a.settingCode === settingCode) && blocksOn(a, iso, ov.get(overrideKey(a.id, iso))).includes(block))
    .map((a) => { const bs = bookings.filter((b) => b.assetId === a.id && b.date === iso && b.block === block); const used = bs.reduce((n, b) => n + b.students, 0); return { asset: a, booked: used, free: Math.max(0, a.learnersPerShift - used), bookings: bs }; })
    .sort((x, y) => Number(y.asset.agreementStatus === "secured") - Number(x.asset.agreementStatus === "secured") || y.free - x.free || x.asset.facilityName.localeCompare(y.asset.facilityName));
}

// ── The partner workbook: read it in, write it out ───────────────────────────
export interface ParsedAsset { externalId: string; facilityExternalId: string; facilityName: string; county: string | null; ring: string | null; facilityType: string | null; settingCode: string; setting: string; assetType: string; assetNumber: number; operatingRule: string; days: string; shiftBlocks: string; hoursPerShift: number; serves: string | null }
export interface ParsedAssetMap { assets: ParsedAsset[]; exceptions: AssetDayOverride[]; mapDates: { from: string; to: string } | null; issues: string[] }

const norm = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
function headerRow(rows: unknown[][], need: string[]): { idx: number; map: Record<string, number> } | null {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cells = (rows[i] ?? []).map(norm);
    const map: Record<string, number> = {};
    cells.forEach((c, j) => { if (c && !(c in map)) map[c] = j; });
    if (need.every((n) => n in map)) return { idx: i, map };
  }
  return null;
}
const toIso = (v: unknown): string | null => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v ?? "").trim(); const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const m2 = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s); if (m2) return `${m2[3]}-${m2[1].padStart(2, "0")}-${m2[2].padStart(2, "0")}`;
  return null;
};

/** Parse the ASSET_MAP sheet (required) and the 365_SHIFT_MAP sheet (optional —
 *  dates that differ from the asset's rule become exceptions). */
export function parseAssetMapWorkbook(sheets: Record<string, unknown[][]>): ParsedAssetMap {
  const issues: string[] = [];
  const findSheet = (pred: (rows: unknown[][]) => boolean) => Object.entries(sheets).find(([, rows]) => pred(rows))?.[1] ?? null;
  const assetRows = findSheet((rows) => !!headerRow(rows, ["asset_id", "facility_id", "setting", "asset_type"]));
  if (!assetRows) return { assets: [], exceptions: [], mapDates: null, issues: ["No ASSET_MAP sheet found (needs asset_id, facility_id, setting, asset_type columns)."] };
  const h = headerRow(assetRows, ["asset_id", "facility_id", "setting", "asset_type"])!;
  const g = (r: unknown[], k: string) => (h.map[k] == null ? null : r[h.map[k]]);
  const assets: ParsedAsset[] = [];
  for (let i = h.idx + 1; i < assetRows.length; i++) {
    const r = assetRows[i] ?? []; const id = String(g(r, "asset_id") ?? "").trim(); if (!id) continue;
    const rule = String(g(r, "operating_rule") ?? "24x7").trim() || "24x7";
    const d = ruleDefaults(rule);
    const dayShifts = Number(g(r, "day_shifts") ?? 0), eveShifts = Number(g(r, "evening_shifts") ?? 0), nightShifts = Number(g(r, "night_shifts") ?? 0);
    const blocksFromCounts = [dayShifts > 0 ? "Day" : null, eveShifts > 0 ? "Evening" : null, nightShifts > 0 ? "Night" : null].filter(Boolean).join(",");
    assets.push({
      externalId: id, facilityExternalId: String(g(r, "facility_id") ?? "").trim(), facilityName: String(g(r, "facility_name") ?? "").trim(),
      county: (g(r, "county") as string | null) ?? null, ring: (g(r, "ring") as string | null) ?? null, facilityType: (g(r, "facility_type") as string | null) ?? null,
      settingCode: String(g(r, "setting_code") ?? "").trim() || String(g(r, "setting") ?? "").trim().slice(0, 6).toUpperCase(), setting: String(g(r, "setting") ?? "").trim(),
      assetType: String(g(r, "asset_type") ?? "").trim(), assetNumber: Number(g(r, "asset_number") ?? 1) || 1, operatingRule: rule,
      days: d?.days ?? (dayShifts >= 300 ? ALL_DAYS : "Mon,Tue,Wed,Thu,Fri"), shiftBlocks: d?.shiftBlocks ?? (blocksFromCounts || "Day"),
      hoursPerShift: Number(g(r, "hours_per_shift") ?? 8) || 8, serves: (g(r, "serves") as string | null) ?? null,
    });
  }
  const exceptions: AssetDayOverride[] = [];
  let mapDates: { from: string; to: string } | null = null;
  const mapRows = findSheet((rows) => !!headerRow(rows, ["asset_id", "date", "day_shift"]));
  if (mapRows) {
    const hm = headerRow(mapRows, ["asset_id", "date", "day_shift"])!;
    const gm = (r: unknown[], k: string) => (hm.map[k] == null ? null : r[hm.map[k]]);
    const byId = new Map(assets.map((a) => [a.externalId, a]));
    let lo = "", hi = "";
    for (let i = hm.idx + 1; i < mapRows.length; i++) {
      const r = mapRows[i] ?? []; const id = String(gm(r, "asset_id") ?? "").trim(); const iso = toIso(gm(r, "date")); if (!id || !iso) continue;
      if (!lo || iso < lo) lo = iso; if (!hi || iso > hi) hi = iso;
      const a = byId.get(id); if (!a) { issues.push(`365 map row for unknown asset ${id}`); continue; }
      const got = [Number(gm(r, "day_shift")) ? "Day" : null, Number(gm(r, "evening_shift")) ? "Evening" : null, Number(gm(r, "night_shift")) ? "Night" : null].filter(Boolean) as string[];
      const lite: AssetLite = { id, externalId: id, employerId: "", facilityName: a.facilityName, settingCode: a.settingCode, setting: a.setting, assetType: a.assetType, assetNumber: a.assetNumber, operatingRule: a.operatingRule, days: a.days, shiftBlocks: a.shiftBlocks, hoursPerShift: a.hoursPerShift, serves: a.serves, learnersPerShift: 1, preceptorsPerShift: 1, dataSource: "VERIFIED", status: "active" };
      const expect = blocksOn(lite, iso);
      if (expect.join(",") !== got.join(",")) exceptions.push({ assetId: id, date: iso, shiftBlocks: got.join(",") });
    }
    if (lo && hi) mapDates = { from: lo, to: hi };
  }
  return { assets, exceptions, mapDates, issues };
}

/** The workbook, sheet by sheet, as arrays — TOTALS · ASSET_MAP · 365_SHIFT_MAP · FACILITY_TOTALS. */
export function assetMapWorkbook(assets: AssetLite[], overrides: AssetDayOverride[], from: string, to: string): Record<string, unknown[][]> {
  const t = assetTotals(assets, overrides, from, to);
  const ov = overrideIndex(overrides);
  const TOTALS: unknown[][] = [
    [`Clinical asset map — ${from} → ${to}`], ["Physical ceiling only; learner and staffing rules are layered in Rosie."], [],
    ["Physical assets", t.grand.assets, "Available asset-shifts", t.grand.total, "Day shifts", t.grand.day, "Evening shifts", t.grand.evening, "Night shifts", t.grand.night, "Calendar days", t.days], [],
    ["Setting", "Physical assets", "Day shifts", "Evening shifts", "Night shifts", "Total shifts", "Asset hours"],
    ...t.settings.map((s) => [s.setting, s.assets, s.day, s.evening, s.night, s.total, s.hours]),
  ];
  const ASSET_MAP: unknown[][] = [["Clinical asset map"], ["One row per physical asset."], [],
    ["asset_id", "facility_id", "facility_name", "county", "ring", "facility_type", "setting_code", "setting", "asset_type", "asset_number", "operating_rule", "serves", "day_shifts", "evening_shifts", "night_shifts", "total_annual_shifts", "annual_asset_hours", "learners_per_shift", "preceptors_per_shift", "agreement_status", "data_source"]];
  const SHIFT_MAP: unknown[][] = [["365-day shift map"], ["One row per asset × date."], [],
    ["asset_day_id", "date", "day_of_week", "asset_id", "facility_id", "facility_name", "setting_code", "setting", "asset_type", "asset_number", "day_shift", "evening_shift", "night_shift", "total_shifts", "total_hours", "serves"]];
  const DOW: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
  for (const a of assets) {
    if (a.status === "archived") continue;
    const per: Record<ShiftBlock, number> = { Day: 0, Evening: 0, Night: 0 };
    for (const iso of isoRange(from, to)) {
      const bl = blocksOn(a, iso, ov.get(overrideKey(a.id, iso)));
      for (const b of bl) per[b]++;
      if (bl.length) SHIFT_MAP.push([`${a.externalId ?? a.id}-${iso}`, iso, DOW[weekdayOfIso(iso)], a.externalId ?? a.id, a.facilityExternalId ?? "", a.facilityName, a.settingCode, a.setting, a.assetType, a.assetNumber, bl.includes("Day") ? 1 : 0, bl.includes("Evening") ? 1 : 0, bl.includes("Night") ? 1 : 0, bl.length, bl.length * a.hoursPerShift, a.serves ?? ""]);
    }
    const total = per.Day + per.Evening + per.Night;
    ASSET_MAP.push([a.externalId ?? a.id, a.facilityExternalId ?? "", a.facilityName, a.county ?? "", a.ring ?? "", a.facilityType ?? "", a.settingCode, a.setting, a.assetType, a.assetNumber, a.operatingRule, a.serves ?? "", per.Day, per.Evening, per.Night, total, total * a.hoursPerShift, a.learnersPerShift, a.preceptorsPerShift, a.agreementStatus ?? "", a.dataSource]);
  }
  const FACILITY_TOTALS: unknown[][] = [["Facility × setting × shift totals"], [], [],
    ["facility_id", "facility_name", "setting_code", "setting", "physical_assets", "shift", "days_available", "asset_shifts", "hours_per_shift", "asset_hours"],
    ...t.facilities.map((f) => [assets.find((a) => a.employerId === f.employerId)?.facilityExternalId ?? "", f.facility, f.settingCode, f.setting, f.assets, f.block, f.daysAvailable, f.assetShifts, assets.find((a) => a.employerId === f.employerId && a.settingCode === f.settingCode)?.hoursPerShift ?? 8, f.hours])];
  return { TOTALS, ASSET_MAP, "365_SHIFT_MAP": SHIFT_MAP, FACILITY_TOTALS };
}
