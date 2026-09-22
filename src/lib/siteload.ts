// CLINICAL SITE LOAD — which sites carry the students, seat by seat. One row per student-shift (a
// student at a site on a date, on a shift block, in the seat the roster put them on — an asset:
// a unit, room or suite at the site — for so many hours); from those rows: a leaderboard of sites
// with their share of the load, the students and programs they carry, how full each shift runs
// against the seats the site's assets offer (never averaged across a day: a Day shift is measured
// against Day seats, a Night shift against Night seats), the same per asset, and the load grouped by
// system, county, drive-time band, facility type, setting, asset, shift, program, cohort, term or
// month. Pure — the query builds the rows, the page reads the summary.
//
// The rows are the placements the scheduler wrote (lib/planwrite): the seat, the shift block and the
// date come from the booking, so this page and the scheduler describe the same calendar. A shift the
// plan could not seat has no asset: it is counted as "no seat yet", never as load on a site's seats.

import { csvCell } from "./csvsafe";
import { driveBandLabel, RING_ORDER } from "./geo";

export interface LoadRow {
  studentId: string; student: string;
  cohortId: string; cohort: string; programId: string; program: string; familyId: string | null; family: string | null;
  course: string; term: string;
  date: string | null; hours: number; status: string;
  /** Derived from the date: calendar year, semester (Fall / Spring / Summer) and weekday. */
  year: number | null; semester: string | null; dayOfWeek: string | null;
  employerId: string | null; site: string; system: string | null; county: string | null; ring: string | null; facilityType: string | null; driveMinutes: number | null;
  setting: string | null; preceptorId: string | null; preceptor: string | null;
  /** The seat: the asset the roster booked for this shift and its shift block. Null when the shift has no booked seat yet
   *  (the site is then the section's pattern site, or "site TBD"); such a row is never load on a site's seats. */
  assetId: string | null; asset: string | null; block: string | null;
  /** Learner seats per shift on that asset (null when unplaced). */
  seatsPerShift: number | null;
  /** The program's agreement with the site (none | prospect | asked | secured | declined). */
  agreement: string;
  /** The student's lifecycle status today, and whether their future assignments are deliberately kept (Phase 4). */
  studentStatus: string; keepAssignments: boolean;
  /** Preceptors the session needs (0 = instructor-led) — the exception queue reads an unnamed preceptor as a gap only when one is needed (Phase 7). */
  preceptorsNeeded?: number;
}

/** Withdrawn students leave FUTURE operational demand unless explicitly kept (Phase 4): their past shifts stay
 *  (they happened), their undated or future shifts are dropped and counted so the page can say so. */
export function withdrawnRule(rows: LoadRow[], todayIso: string): { rows: LoadRow[]; excluded: number; kept: number; students: number } {
  const keep: LoadRow[] = []; let excluded = 0, kept = 0; const who = new Set<string>();
  for (const r of rows) {
    const future = r.date == null || r.date > todayIso;
    if (r.studentStatus === "withdrawn" && future) {
      if (r.keepAssignments) { kept++; keep.push(r); } else { excluded++; who.add(r.studentId); }
      continue;
    }
    keep.push(r);
  }
  return { rows: keep, excluded, kept, students: who.size };
}

/** One asset at a site as the seat ledger sees it: what it is, which shift blocks it runs and how many learners it takes per shift. */
export interface SiteAssetSeats { assetId: string; name: string; settingCode: string; learnersPerShift: number; blocks: string[] }
/** A site's seats: its active assets, and the preceptors it has on record. */
export interface SiteSeats { employerId: string; assets: SiteAssetSeats[]; preceptorsOnRecord: number }

export interface Slice { key: string; label: string; studentDays: number; students: number; hours: number; sites: number; share: number; programs: string[] }
export interface AssetStat { assetId: string; name: string; settingCode: string; seatsPerShift: number; studentShifts: number; shiftsUsed: number; peakStudents: number; /** Σ students ÷ Σ seats over the shifts it hosted. */ fill: number }
export interface SiteStat {
  employerId: string | null; site: string; system: string | null; county: string | null; ring: string | null; facilityType: string | null; driveMinutes: number | null; agreement: string;
  studentDays: number; students: number; hours: number; share: number;
  programs: { name: string; studentDays: number; students: number }[];
  settings: { code: string; studentDays: number }[];
  cohorts: string[];
  weeksActive: number; firstDate: string | null; lastDate: string | null;
  peakDayStudents: number; avgStudentsPerActiveDay: number;
  /** Seated load: student-shifts on a booked seat, and the ones with no seat yet (never load on the site's seats). */
  placed: number; unplaced: number;
  /** Shifts (date × block) the site hosted, the students on the fullest one and the average. */
  shiftsUsed: number; peakShiftStudents: number; avgStudentsPerShift: number;
  /** Learner seats per Day shift in the settings the site hosts for these programs (the "Seats" column); null when the site has no assets on record. */
  seatsPerShift: number | null;
  /** How full the site runs on the shifts it hosts: Σ students ÷ Σ seats open that shift (in the programs' settings). Null without assets. */
  utilization: number | null;
  /** The fullest single shift: students ÷ seats. */
  peakShare: number | null;
  /** The same ledger per asset — the seat-level view behind the site number. */
  assets: AssetStat[];
  preceptorsUsed: number; preceptorsOnRecord: number | null; studentDaysPerPreceptor: number | null;
  completedDays: number; absentDays: number;
}
export type LoadDim = "site" | "system" | "county" | "ring" | "facilityType" | "setting" | "asset" | "block" | "seat" | "program" | "cohort" | "course" | "term" | "semester" | "year" | "month" | "week" | "day" | "dayOfWeek" | "student" | "preceptor" | "status" | "agreement";
export type LoadMeasure = "studentDays" | "students" | "hours" | "sites" | "preceptors";
export const MEASURE_LABEL: Record<LoadMeasure, string> = { studentDays: "Student-shifts", students: "Students", hours: "Student-hours", sites: "Sites", preceptors: "Preceptors" };
export const DIM_LABEL: Record<LoadDim, string> = { site: "Site", system: "Health system", county: "County", ring: "Drive time from campus", facilityType: "Facility type", setting: "Setting", asset: "Asset (unit / room)", block: "Shift", seat: "Seat", program: "Program", cohort: "Cohort", course: "Class", term: "Term", semester: "Semester", year: "Year", month: "Month", week: "Week", day: "Date", dayOfWeek: "Day of week", student: "Student", preceptor: "Preceptor", status: "Status", agreement: "Agreement" };
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SEM = ["Spring", "Summer", "Fall"];
const BLOCKS = ["Day", "Evening", "Night"];
export const NO_SEAT = "no seat yet";

export const mondayOf = (iso: string) => { const d = new Date(iso + "T00:00:00Z"); const back = (d.getUTCDay() + 6) % 7; return new Date(d.getTime() - back * 86400000).toISOString().slice(0, 10); };
/** A drive-time band as it reads on screen ("≤ 30 min", "30–60 min"); the ring name itself never shows. */
const bandOf = (ring: string | null) => driveBandLabel(ring) ?? "not located";
const keyOf = (r: LoadRow, dim: LoadDim): string => {
  switch (dim) {
    case "site": return r.employerId ?? "—";
    case "system": return r.system ?? r.site;
    case "county": return r.county ?? "unknown";
    case "ring": { const i = r.ring ? RING_ORDER.indexOf(r.ring as (typeof RING_ORDER)[number]) : -1; return `${i < 0 ? 9 : i} ${bandOf(r.ring)}`; }
    case "facilityType": return r.facilityType ?? "unknown";
    case "setting": return r.setting ?? "(no setting)";
    case "asset": return r.assetId ?? NO_SEAT;
    case "block": return r.block ? `${BLOCKS.indexOf(r.block)} ${r.block}` : `9 ${NO_SEAT}`;
    case "seat": return r.assetId ? "booked seat" : NO_SEAT;
    case "program": return r.program;
    case "cohort": return r.cohortId;
    case "term": return r.term;
    case "course": return r.course;
    case "month": return r.date ? r.date.slice(0, 7) : "undated";
    case "week": return r.date ? mondayOf(r.date) : "undated";
    case "day": return r.date ?? "undated";
    case "year": return r.year != null ? String(r.year) : "undated";
    case "semester": return r.semester && r.year != null ? `${r.year} ${String(SEM.indexOf(r.semester)).padStart(1, "0")} ${r.semester}` : "undated";
    case "dayOfWeek": return r.dayOfWeek ? `${DOW.indexOf(r.dayOfWeek)} ${r.dayOfWeek}` : "undated";
    case "student": return r.studentId;
    case "preceptor": return r.preceptorId ?? "(none named)";
    case "status": return r.status;
    case "agreement": return r.agreement;
  }
};
const TIME_DIMS: LoadDim[] = ["term", "semester", "year", "month", "week", "day", "dayOfWeek"];
export const isTimeDim = (d: LoadDim) => TIME_DIMS.includes(d);
const labelOf = (r: LoadRow, dim: LoadDim): string => {
  if (dim === "site") return r.site;
  if (dim === "student") return r.student;
  // Two programs can both run a "Class of 2028": the label carries the program so they stay apart.
  if (dim === "cohort") return `${r.program} · ${r.cohort}`;
  if (dim === "preceptor") return r.preceptor ?? "(none named)";
  if (dim === "semester") return r.semester && r.year != null ? `${r.semester} ${r.year}` : "undated";
  if (dim === "dayOfWeek") return r.dayOfWeek ?? "undated";
  if (dim === "ring") return bandOf(r.ring);
  if (dim === "asset") return r.asset ? `${r.asset} — ${r.site}` : NO_SEAT;
  if (dim === "block") return r.block ?? NO_SEAT;
  return keyOf(r, dim);
};
export const valueOf = (r: LoadRow, m: LoadMeasure, acc: { students: Set<string>; sites: Set<string>; preceptors: Set<string>; days: number; hours: number }): number => m === "studentDays" ? acc.days : m === "students" ? acc.students.size : m === "hours" ? acc.hours : m === "sites" ? acc.sites.size : acc.preceptors.size;

/** The filter a query bar produces: every field is a set of allowed values (empty = any), plus a date window. */
export interface LoadFilter {
  program?: Set<string>; cohort?: Set<string>; course?: Set<string>; term?: Set<string>; semester?: Set<string>; year?: Set<string>; dayOfWeek?: Set<string>;
  site?: Set<string>; system?: Set<string>; county?: Set<string>; ring?: Set<string>; facilityType?: Set<string>; setting?: Set<string>; asset?: Set<string>; block?: Set<string>; seat?: Set<string>; agreement?: Set<string>; status?: Set<string>; student?: Set<string>; preceptor?: Set<string>;
  from?: string | null; to?: string | null;
}
const FILTER_DIMS: (keyof LoadFilter & LoadDim)[] = ["program", "cohort", "course", "term", "semester", "year", "dayOfWeek", "site", "system", "county", "ring", "facilityType", "setting", "asset", "block", "seat", "agreement", "status", "student", "preceptor"];
export function applyFilter(rows: LoadRow[], f: LoadFilter): LoadRow[] {
  return rows.filter((r) => {
    if (f.from && (!r.date || r.date < f.from)) return false;
    if (f.to && (!r.date || r.date > f.to)) return false;
    for (const d of FILTER_DIMS) { const set = f[d]; if (set && set.size && !set.has(labelOf(r, d))) return false; }
    return true;
  });
}
/** Every distinct value of a dimension in the rows, in display order — the options a query bar offers. */
export function optionsOf(rows: LoadRow[], dim: LoadDim): string[] {
  const m = new Map<string, string>();
  for (const r of rows) m.set(keyOf(r, dim), labelOf(r, dim));
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, l]) => l).filter((v, i, a) => a.indexOf(v) === i);
}

/** Any rows × any columns, any measure — the pivot behind the "query" view. */
export function pivot(rows: LoadRow[], rowDim: LoadDim, colDim: LoadDim | null, measure: LoadMeasure): { cols: { key: string; label: string }[]; rows: { key: string; label: string; cells: Record<string, number>; total: number }[]; colTotals: Record<string, number>; grand: number } {
  type Acc = { students: Set<string>; sites: Set<string>; preceptors: Set<string>; days: number; hours: number };
  const mk = (): Acc => ({ students: new Set(), sites: new Set(), preceptors: new Set(), days: 0, hours: 0 });
  const add = (a: Acc, r: LoadRow) => { a.days++; a.hours += r.hours; a.students.add(r.studentId); a.sites.add(r.employerId ?? r.site); if (r.preceptorId) a.preceptors.add(r.preceptorId); };
  const cols = new Map<string, string>(); const rowsM = new Map<string, { label: string; cells: Map<string, Acc>; all: Acc }>(); const colAcc = new Map<string, Acc>(); const grand = mk();
  for (const r of rows) {
    const rk = keyOf(r, rowDim); const ck = colDim ? keyOf(r, colDim) : "all";
    if (colDim) cols.set(ck, labelOf(r, colDim));
    const row = rowsM.get(rk) ?? { label: labelOf(r, rowDim), cells: new Map(), all: mk() };
    const cell = row.cells.get(ck) ?? mk(); add(cell, r); row.cells.set(ck, cell); add(row.all, r); rowsM.set(rk, row);
    const ca = colAcc.get(ck) ?? mk(); add(ca, r); colAcc.set(ck, ca); add(grand, r);
  }
  const colList = [...cols.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, label]) => ({ key, label }));
  const out = [...rowsM.entries()].map(([key, v]) => { const cells: Record<string, number> = {}; for (const [ck, a] of v.cells) cells[ck] = valueOf(null as unknown as LoadRow, measure, a); return { key, label: v.label, cells, total: valueOf(null as unknown as LoadRow, measure, v.all) }; });
  const sorted = isTimeDim(rowDim) ? out.sort((a, b) => a.key.localeCompare(b.key)) : out.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  const colTotals: Record<string, number> = {}; for (const [ck, a] of colAcc) colTotals[ck] = valueOf(null as unknown as LoadRow, measure, a);
  return { cols: colList, rows: sorted, colTotals, grand: valueOf(null as unknown as LoadRow, measure, grand) };
}

/** The filtered rows as CSV (RFC 4180). */
export function rowsToCsv(rows: LoadRow[]): string {
  const head = ["Date", "Day", "Year", "Semester", "Week of", "Term", "Program", "Cohort", "Class", "Student", "Site", "Health system", "County", "Drive time", "Facility type", "Drive min", "Setting", "Asset", "Shift", "Seats per shift", "Hours", "Status", "Preceptor", "Agreement"];
  const cell = csvCell;
  const lines = rows.map((r) => [r.date, r.dayOfWeek, r.year, r.semester, r.date ? mondayOf(r.date) : null, r.term, r.program, r.cohort, r.course, r.student, r.site, r.system, r.county, r.ring ? bandOf(r.ring) : null, r.facilityType, r.driveMinutes != null ? Math.round(r.driveMinutes) : null, r.setting, r.asset ?? NO_SEAT, r.block, r.seatsPerShift, r.hours, r.status, r.preceptor, r.agreement].map(cell).join(","));
  return [head.join(","), ...lines].join("\r\n") + "\r\n";
}
export function pivotToCsv(p: ReturnType<typeof pivot>, rowLabel: string): string {
  const cell = csvCell;
  const head = [rowLabel, ...p.cols.map((c) => c.label), "Total"];
  const lines = p.rows.map((r) => [r.label, ...p.cols.map((c) => r.cells[c.key] ?? 0), r.total].map(cell).join(","));
  lines.push(["Total", ...p.cols.map((c) => p.colTotals[c.key] ?? 0), p.grand].map(cell).join(","));
  return [head.join(","), ...lines].join("\r\n") + "\r\n";
}

/** The load grouped one way. */
export function sliceBy(rows: LoadRow[], dim: LoadDim): Slice[] {
  const m = new Map<string, { label: string; days: number; students: Set<string>; hours: number; sites: Set<string>; programs: Set<string> }>();
  for (const r of rows) {
    const k = keyOf(r, dim);
    const e = m.get(k) ?? { label: labelOf(r, dim), days: 0, students: new Set(), hours: 0, sites: new Set(), programs: new Set() };
    e.days += 1; e.students.add(r.studentId); e.hours += r.hours; e.sites.add(r.employerId ?? r.site); e.programs.add(r.program);
    m.set(k, e);
  }
  const total = rows.length || 1;
  const out = [...m.entries()].map(([key, e]) => ({ key, label: e.label, studentDays: e.days, students: e.students.size, hours: e.hours, sites: e.sites.size, share: e.days / total, programs: [...e.programs].sort() }));
  return isTimeDim(dim) ? out.sort((a, b) => a.key.localeCompare(b.key)) : out.sort((a, b) => b.studentDays - a.studentDays || a.label.localeCompare(b.label));
}

/** The seats open on one shift (date × block) at a site for the programs present: every active asset
 *  running that block whose setting one of those programs' families uses — plus, always, the assets
 *  actually seated (a seat in use is open by definition). A family with no settings on record uses every asset. */
function seatsOpen(site: SiteSeats | undefined, block: string, families: Set<string | null>, familySettings: Record<string, string[]>, used: Set<string>): number {
  if (!site) return 0;
  const codes = new Set<string>(); let any = false;
  for (const f of families) { const list = f ? familySettings[f] : undefined; if (!list || list.length === 0) any = true; else for (const c of list) codes.add(c); }
  let n = 0;
  for (const a of site.assets) if (used.has(a.assetId) || ((any || codes.has(a.settingCode)) && a.blocks.includes(block))) n += Math.max(0, a.learnersPerShift);
  return n;
}

/** The leaderboard: every site with what it carries and how full it runs — shift by shift against the seats open that shift, and asset by asset. */
export function siteStats(rows: LoadRow[], seats: SiteSeats[] = [], familySettings: Record<string, string[]> = {}): SiteStat[] {
  const seatBy = new Map(seats.map((s) => [s.employerId, s]));
  const total = rows.length || 1;
  const bySite = new Map<string, LoadRow[]>();
  for (const r of rows) { const k = r.employerId ?? `?${r.site}`; const l = bySite.get(k) ?? []; l.push(r); bySite.set(k, l); }
  return [...bySite.entries()].map(([, list]) => {
    const r0 = list[0];
    const students = new Set(list.map((r) => r.studentId));
    const byProgram = new Map<string, { days: number; students: Set<string> }>();
    const bySetting = new Map<string, number>();
    const byDay = new Map<string, Set<string>>();
    // Seated rows only: the shift ledger (date × block) and the asset ledger (asset × date × block).
    const byShift = new Map<string, { students: Set<string>; families: Set<string | null>; assets: Set<string>; block: string }>();
    const byAsset = new Map<string, { name: string; settingCode: string; seatsPerShift: number; rows: number; shifts: Map<string, Set<string>> }>();
    const preceptors = new Set<string>();
    let placed = 0;
    for (const r of list) {
      const p = byProgram.get(r.program) ?? { days: 0, students: new Set() }; p.days++; p.students.add(r.studentId); byProgram.set(r.program, p);
      bySetting.set(r.setting ?? "(no setting)", (bySetting.get(r.setting ?? "(no setting)") ?? 0) + 1);
      if (r.date) { const d = byDay.get(r.date) ?? new Set(); d.add(r.studentId); byDay.set(r.date, d); }
      if (r.preceptorId) preceptors.add(r.preceptorId);
      if (r.assetId && r.date && r.block) {
        placed++;
        const sk = `${r.date}|${r.block}`;
        const s = byShift.get(sk) ?? { students: new Set(), families: new Set(), assets: new Set(), block: r.block }; s.students.add(r.studentId); s.families.add(r.familyId); s.assets.add(r.assetId); byShift.set(sk, s);
        const a = byAsset.get(r.assetId) ?? { name: r.asset ?? r.assetId, settingCode: r.setting ?? "", seatsPerShift: r.seatsPerShift ?? 0, rows: 0, shifts: new Map() };
        a.rows++; const st = a.shifts.get(sk) ?? new Set(); st.add(r.studentId); a.shifts.set(sk, st); byAsset.set(r.assetId, a);
      }
    }
    const dates = [...byDay.keys()].sort();
    const dayCounts = [...byDay.values()].map((s) => s.size);
    const peak = Math.max(0, ...dayCounts);
    const avg = dayCounts.length ? dayCounts.reduce((n, v) => n + v, 0) / dayCounts.length : 0;
    const seat = r0.employerId ? seatBy.get(r0.employerId) : undefined;
    // Shift by shift: students on the shift against the seats open that shift.
    let used = 0, open = 0, peakShare: number | null = null, peakShift = 0;
    for (const s of byShift.values()) {
      const seatsHere = seatsOpen(seat, s.block, s.families, familySettings, s.assets);
      used += s.students.size; open += seatsHere;
      peakShift = Math.max(peakShift, s.students.size);
      if (seatsHere > 0) peakShare = Math.max(peakShare ?? 0, s.students.size / seatsHere);
    }
    const families = new Set(list.map((r) => r.familyId));
    const seatsPerShift = seat ? seatsOpen(seat, "Day", families, familySettings, new Set()) : null;
    const assets: AssetStat[] = [...byAsset.entries()].map(([assetId, a]) => {
      const counts = [...a.shifts.values()].map((s) => s.size);
      const seatsTotal = a.seatsPerShift * counts.length;
      return { assetId, name: a.name, settingCode: a.settingCode, seatsPerShift: a.seatsPerShift, studentShifts: a.rows, shiftsUsed: counts.length, peakStudents: Math.max(0, ...counts), fill: seatsTotal > 0 ? counts.reduce((n, v) => n + v, 0) / seatsTotal : 0 };
    }).sort((x, y) => y.studentShifts - x.studentShifts || x.name.localeCompare(y.name));
    return {
      employerId: r0.employerId, site: r0.site, system: r0.system, county: r0.county, ring: r0.ring, facilityType: r0.facilityType, driveMinutes: r0.driveMinutes, agreement: r0.agreement,
      studentDays: list.length, students: students.size, hours: list.reduce((n, r) => n + r.hours, 0), share: list.length / total,
      programs: [...byProgram.entries()].map(([name, v]) => ({ name, studentDays: v.days, students: v.students.size })).sort((a, b) => b.studentDays - a.studentDays),
      settings: [...bySetting.entries()].map(([code, studentDays]) => ({ code, studentDays })).sort((a, b) => b.studentDays - a.studentDays),
      cohorts: [...new Set(list.map((r) => r.cohort))].sort(),
      weeksActive: new Set(dates.map(mondayOf)).size, firstDate: dates[0] ?? null, lastDate: dates[dates.length - 1] ?? null,
      peakDayStudents: peak, avgStudentsPerActiveDay: avg,
      placed, unplaced: list.length - placed,
      shiftsUsed: byShift.size, peakShiftStudents: peakShift, avgStudentsPerShift: byShift.size ? used / byShift.size : 0,
      seatsPerShift, utilization: seat && open > 0 ? used / open : null, peakShare: seat ? peakShare : null,
      assets,
      preceptorsUsed: preceptors.size, preceptorsOnRecord: seat?.preceptorsOnRecord ?? null, studentDaysPerPreceptor: preceptors.size ? list.length / preceptors.size : null,
      completedDays: list.filter((r) => r.status === "completed").length, absentDays: list.filter((r) => r.status === "absent").length,
    };
  }).sort((a, b) => b.studentDays - a.studentDays || a.site.localeCompare(b.site));
}

/** Site × period grid (students on site in each period) — the "over time" view. */
export function siteByPeriod(rows: LoadRow[], period: "week" | "month", topSites = 25): { periods: string[]; sites: { employerId: string | null; site: string; cells: Record<string, number>; total: number }[] } {
  const stats = siteStats(rows).slice(0, topSites);
  const keep = new Set(stats.map((s) => s.employerId ?? `?${s.site}`));
  const periods = [...new Set(rows.filter((r) => r.date).map((r) => (period === "week" ? mondayOf(r.date!) : r.date!.slice(0, 7))))].sort();
  const cells = new Map<string, Map<string, Set<string>>>();
  for (const r of rows) {
    if (!r.date) continue;
    const k = r.employerId ?? `?${r.site}`; if (!keep.has(k)) continue;
    const p = period === "week" ? mondayOf(r.date) : r.date.slice(0, 7);
    const m = cells.get(k) ?? new Map(); const s = m.get(p) ?? new Set(); s.add(r.studentId); m.set(p, s); cells.set(k, m);
  }
  return {
    periods,
    sites: stats.map((s) => { const k = s.employerId ?? `?${s.site}`; const m = cells.get(k) ?? new Map<string, Set<string>>(); const c: Record<string, number> = {}; for (const [p, set] of m) c[p] = set.size; return { employerId: s.employerId, site: s.site, cells: c, total: s.studentDays }; }),
  };
}

/** Concentration: how much of the load the top N carry (the "are we too dependent" number). */
export function concentration(stats: SiteStat[], n = 3): { topShare: number; top: string[] } {
  const top = stats.slice(0, n);
  return { topShare: top.reduce((s, x) => s + x.share, 0), top: top.map((x) => x.site) };
}
