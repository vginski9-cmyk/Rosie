// Asset supply explorer — query the physical clinical supply any way a
// coordinator thinks about it: by asset, site, setting or period (day, week,
// month, semester, year), for any weekdays and shift blocks, and see how many
// shifts and hours each block offers, how many learner seats, how many are
// booked, and what is left. Pure functions over the asset map.

import { blocksOn, overrideIndex, overrideKey, shiftHours, shiftStart, isoRange, type AssetLite, type AssetDayOverride, type AssetBookingLite } from "./assetmap";
import { weekdayOfIso, type ShiftBlock, type Weekday } from "./clinicalsupply";
import { seasonOfDate } from "./term";

export type GroupBy = "asset" | "site" | "setting" | "day" | "week" | "month" | "semester" | "year";

export interface ExplorerFilters {
  from: string; to: string;
  employerIds?: string[]; settingCodes?: string[]; assetIds?: string[];
  weekdays?: Weekday[]; blocks?: ShiftBlock[];
  /** secured | asked | prospect | none — sites' agreement status */
  agreement?: string[];
  onlyActive?: boolean;
}

export interface BlockStat { shifts: number; hours: number; seats: number; booked: number; available: number }
export interface ExplorerRow {
  key: string; label: string; sub: string | null;
  assets: number; days: number;
  Day: BlockStat; Evening: BlockStat; Night: BlockStat;
  total: BlockStat;
  /** booked learner-shifts ÷ seats */
  utilization: number;
  /** per-asset ids in this row (for drill-in) */
  assetIds: string[];
}

const empty = (): BlockStat => ({ shifts: 0, hours: 0, seats: 0, booked: 0, available: 0 });
const add = (a: BlockStat, b: BlockStat) => { a.shifts += b.shifts; a.hours += b.hours; a.seats += b.seats; a.booked += b.booked; a.available += b.available; };
const mondayOf = (iso: string) => { const d = new Date(iso + "T00:00:00Z"); return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10); };

/** One asset × one date × one block: the atom the explorer aggregates. */
export interface ShiftAtom { asset: AssetLite; iso: string; weekday: Weekday; block: ShiftBlock; hours: number; start: string; seats: number; booked: number }

export function shiftAtoms(assets: AssetLite[], overrides: AssetDayOverride[], bookings: AssetBookingLite[], f: ExplorerFilters): ShiftAtom[] {
  const ov = overrideIndex(overrides);
  const booked = new Map<string, number>();
  for (const b of bookings) { const k = `${b.assetId}|${b.date}|${b.block}`; booked.set(k, (booked.get(k) ?? 0) + b.students); }
  const emp = f.employerIds?.length ? new Set(f.employerIds) : null;
  const set = f.settingCodes?.length ? new Set(f.settingCodes) : null;
  const ids = f.assetIds?.length ? new Set(f.assetIds) : null;
  const wds = f.weekdays?.length ? new Set(f.weekdays) : null;
  const blks = f.blocks?.length ? new Set(f.blocks) : null;
  const agr = f.agreement?.length ? new Set(f.agreement) : null;
  const out: ShiftAtom[] = [];
  for (const a of assets) {
    if (f.onlyActive !== false && (a.status === "archived" || a.facilityStatus === "archived")) continue;
    if (emp && !emp.has(a.employerId)) continue;
    if (set && !set.has(a.settingCode)) continue;
    if (ids && !ids.has(a.id)) continue;
    if (agr && !agr.has(a.agreementStatus ?? "none")) continue;
    for (const iso of isoRange(f.from, f.to)) {
      const wd = weekdayOfIso(iso);
      if (wds && !wds.has(wd)) continue;
      for (const block of blocksOn(a, iso, ov.get(overrideKey(a.id, iso)))) {
        if (blks && !blks.has(block)) continue;
        const bk = booked.get(`${a.id}|${iso}|${block}`) ?? 0;
        out.push({ asset: a, iso, weekday: wd, block, hours: shiftHours(a, block), start: shiftStart(a, block), seats: a.learnersPerShift, booked: bk });
      }
    }
  }
  return out;
}

const keyOf = (g: GroupBy, x: ShiftAtom): { key: string; label: string; sub: string | null } => {
  switch (g) {
    case "asset": return { key: x.asset.id, label: `${x.asset.facilityName} · ${x.asset.setting} #${x.asset.assetNumber}`, sub: `${x.asset.assetType}${x.asset.externalId ? ` · ${x.asset.externalId}` : ""}` };
    case "site": return { key: x.asset.employerId, label: x.asset.facilityName, sub: [x.asset.facilityType, x.asset.county, x.asset.ring].filter(Boolean).join(" · ") || null };
    case "setting": return { key: x.asset.settingCode, label: x.asset.setting, sub: x.asset.settingCode };
    case "day": return { key: x.iso, label: x.iso, sub: x.weekday };
    case "week": { const m = mondayOf(x.iso); return { key: m, label: `week of ${m}`, sub: null }; }
    case "month": return { key: x.iso.slice(0, 7), label: x.iso.slice(0, 7), sub: null };
    case "semester": { const d = new Date(x.iso + "T00:00:00Z"); const s = `${seasonOfDate(d)} ${d.getUTCFullYear()}`; return { key: `${d.getUTCFullYear()}-${["Spring", "Summer", "Fall"].indexOf(seasonOfDate(d))}`, label: s, sub: null }; }
    case "year": return { key: x.iso.slice(0, 4), label: x.iso.slice(0, 4), sub: null };
  }
};

/** Aggregate the atoms by the chosen dimension. Every row carries shifts, hours, seats, booked and available per block and in total. */
export function explore(atoms: ShiftAtom[], groupBy: GroupBy): ExplorerRow[] {
  const rows = new Map<string, ExplorerRow & { _assets: Set<string>; _days: Set<string> }>();
  for (const x of atoms) {
    const k = keyOf(groupBy, x);
    const r = rows.get(k.key) ?? { key: k.key, label: k.label, sub: k.sub, assets: 0, days: 0, Day: empty(), Evening: empty(), Night: empty(), total: empty(), utilization: 0, assetIds: [], _assets: new Set<string>(), _days: new Set<string>() };
    const stat: BlockStat = { shifts: 1, hours: x.hours, seats: x.seats, booked: Math.min(x.booked, x.seats), available: Math.max(0, x.seats - x.booked) };
    add(r[x.block], stat); add(r.total, stat);
    r._assets.add(x.asset.id); r._days.add(x.iso);
    rows.set(k.key, r);
  }
  return [...rows.values()].map(({ _assets, _days, ...r }) => ({ ...r, assets: _assets.size, days: _days.size, assetIds: [..._assets], utilization: r.total.seats > 0 ? r.total.booked / r.total.seats : 0 })).sort((a, b) => a.key.localeCompare(b.key));
}

/** Grand total across all atoms. */
export function totals(atoms: ShiftAtom[]) {
  const t = { Day: empty(), Evening: empty(), Night: empty(), total: empty(), assets: new Set<string>(), sites: new Set<string>(), days: new Set<string>() };
  for (const x of atoms) { const stat: BlockStat = { shifts: 1, hours: x.hours, seats: x.seats, booked: Math.min(x.booked, x.seats), available: Math.max(0, x.seats - x.booked) }; add(t[x.block], stat); add(t.total, stat); t.assets.add(x.asset.id); t.sites.add(x.asset.employerId); t.days.add(x.iso); }
  return { Day: t.Day, Evening: t.Evening, Night: t.Night, total: t.total, assets: t.assets.size, sites: t.sites.size, days: t.days.size, utilization: t.total.seats > 0 ? t.total.booked / t.total.seats : 0 };
}

/** Weekday × block heat: seats offered and booked. */
export function weekdayGrid(atoms: ShiftAtom[]) {
  const g: Record<string, Record<string, BlockStat>> = {};
  for (const x of atoms) { g[x.weekday] ??= {}; g[x.weekday][x.block] ??= empty(); add(g[x.weekday][x.block], { shifts: 1, hours: x.hours, seats: x.seats, booked: Math.min(x.booked, x.seats), available: Math.max(0, x.seats - x.booked) }); }
  return g;
}

/** Preset date windows. */
export function presetWindow(preset: string, today: string, semesterStarts: { iso: string; endIso: string | null; season: string | null }[] = []): { from: string; to: string; label: string } {
  const d = new Date(today + "T00:00:00Z");
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  const addD = (x: Date, n: number) => new Date(x.getTime() + n * 86400000);
  const monday = addD(d, -((d.getUTCDay() + 6) % 7));
  switch (preset) {
    case "today": return { from: today, to: today, label: today };
    case "week": return { from: iso(monday), to: iso(addD(monday, 6)), label: `week of ${iso(monday)}` };
    case "next-week": return { from: iso(addD(monday, 7)), to: iso(addD(monday, 13)), label: `week of ${iso(addD(monday, 7))}` };
    case "month": { const f = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)); return { from: iso(f), to: iso(t), label: today.slice(0, 7) }; }
    case "quarter": { const q = Math.floor(d.getUTCMonth() / 3); const f = new Date(Date.UTC(d.getUTCFullYear(), q * 3, 1)); const t = new Date(Date.UTC(d.getUTCFullYear(), q * 3 + 3, 0)); return { from: iso(f), to: iso(t), label: `Q${q + 1} ${d.getUTCFullYear()}` }; }
    case "year": return { from: `${d.getUTCFullYear()}-01-01`, to: `${d.getUTCFullYear()}-12-31`, label: String(d.getUTCFullYear()) };
    case "next-year": return { from: `${d.getUTCFullYear() + 1}-01-01`, to: `${d.getUTCFullYear() + 1}-12-31`, label: String(d.getUTCFullYear() + 1) };
    case "semester": {
      // The coded semester in session today, else the next one, else the season by month.
      const sorted = [...semesterStarts].sort((a, b) => a.iso.localeCompare(b.iso));
      const cur = sorted.find((s) => s.iso <= today && (s.endIso ?? "9999") >= today) ?? sorted.find((s) => s.iso > today);
      if (cur) return { from: cur.iso, to: cur.endIso ?? iso(addD(new Date(cur.iso + "T00:00:00Z"), 16 * 7 - 3)), label: `${cur.season ?? seasonOfDate(new Date(cur.iso + "T00:00:00Z"))} ${cur.iso.slice(0, 4)}` };
      const season = seasonOfDate(d); const y = d.getUTCFullYear();
      const r = season === "Spring" ? [`${y}-01-01`, `${y}-04-30`] : season === "Summer" ? [`${y}-05-01`, `${y}-07-31`] : [`${y}-08-01`, `${y}-12-31`];
      return { from: r[0], to: r[1], label: `${season} ${y} (by month)` };
    }
    default: return { from: iso(monday), to: iso(addD(monday, 6)), label: `week of ${iso(monday)}` };
  }
}
