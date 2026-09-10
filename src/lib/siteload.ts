// CLINICAL SITE LOAD — which sites carry the students. One row per student-shift (a student at a
// site on a date, in a setting, for so many hours); from those rows: a leaderboard of sites with
// their share of the load, the students and programs they carry, how full they run against the
// seats they offer, and the same load grouped by system, county, ring, facility type, setting,
// program, cohort, term or month. Pure — the query builds the rows, the page reads the summary.

export interface LoadRow {
  studentId: string; student: string;
  cohortId: string; cohort: string; programId: string; program: string; familyId: string | null; family: string | null;
  course: string; term: string;
  date: string | null; hours: number; status: string;
  /** Derived from the date: calendar year, semester (Fall / Spring / Summer) and weekday. */
  year: number | null; semester: string | null; dayOfWeek: string | null;
  employerId: string | null; site: string; system: string | null; county: string | null; ring: string | null; facilityType: string | null; driveMinutes: number | null;
  setting: string | null; preceptorId: string | null; preceptor: string | null;
  /** The program's agreement with the site (none | prospect | asked | secured | declined). */
  agreement: string;
}
export interface SiteSeats { employerId: string; /** Learner seats per day in the family's settings (day shift). */ seatsPerDay: number; preceptorsOnRecord: number }

export interface Slice { key: string; label: string; studentDays: number; students: number; hours: number; sites: number; share: number; programs: string[] }
export interface SiteStat {
  employerId: string | null; site: string; system: string | null; county: string | null; ring: string | null; facilityType: string | null; driveMinutes: number | null; agreement: string;
  studentDays: number; students: number; hours: number; share: number;
  programs: { name: string; studentDays: number; students: number }[];
  settings: { code: string; studentDays: number }[];
  cohorts: string[];
  weeksActive: number; firstDate: string | null; lastDate: string | null;
  peakDayStudents: number; avgStudentsPerActiveDay: number;
  seatsPerDay: number | null; utilization: number | null;
  preceptorsUsed: number; preceptorsOnRecord: number | null; studentDaysPerPreceptor: number | null;
  completedDays: number; absentDays: number;
}
export type LoadDim = "site" | "system" | "county" | "ring" | "facilityType" | "setting" | "program" | "cohort" | "course" | "term" | "semester" | "year" | "month" | "week" | "day" | "dayOfWeek" | "student" | "preceptor" | "status" | "agreement";
export type LoadMeasure = "studentDays" | "students" | "hours" | "sites" | "preceptors";
export const MEASURE_LABEL: Record<LoadMeasure, string> = { studentDays: "Student-days", students: "Students", hours: "Student-hours", sites: "Sites", preceptors: "Preceptors" };
export const DIM_LABEL: Record<LoadDim, string> = { site: "Site", system: "Health system", county: "County", ring: "Drive ring", facilityType: "Facility type", setting: "Setting", program: "Program", cohort: "Cohort", course: "Class", term: "Term", semester: "Semester", year: "Year", month: "Month", week: "Week", day: "Date", dayOfWeek: "Day of week", student: "Student", preceptor: "Preceptor", status: "Status", agreement: "Agreement" };
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SEM = ["Spring", "Summer", "Fall"];

export const mondayOf = (iso: string) => { const d = new Date(iso + "T00:00:00Z"); const back = (d.getUTCDay() + 6) % 7; return new Date(d.getTime() - back * 86400000).toISOString().slice(0, 10); };
const keyOf = (r: LoadRow, dim: LoadDim): string => {
  switch (dim) {
    case "site": return r.employerId ?? "—";
    case "system": return r.system ?? r.site;
    case "county": return r.county ?? "unknown";
    case "ring": return r.ring ?? "not located";
    case "facilityType": return r.facilityType ?? "unknown";
    case "setting": return r.setting ?? "(no setting)";
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
  return keyOf(r, dim);
};
export const valueOf = (r: LoadRow, m: LoadMeasure, acc: { students: Set<string>; sites: Set<string>; preceptors: Set<string>; days: number; hours: number }): number => m === "studentDays" ? acc.days : m === "students" ? acc.students.size : m === "hours" ? acc.hours : m === "sites" ? acc.sites.size : acc.preceptors.size;

/** The filter a query bar produces: every field is a set of allowed values (empty = any), plus a date window. */
export interface LoadFilter {
  program?: Set<string>; cohort?: Set<string>; course?: Set<string>; term?: Set<string>; semester?: Set<string>; year?: Set<string>; dayOfWeek?: Set<string>;
  site?: Set<string>; system?: Set<string>; county?: Set<string>; ring?: Set<string>; facilityType?: Set<string>; setting?: Set<string>; agreement?: Set<string>; status?: Set<string>; student?: Set<string>; preceptor?: Set<string>;
  from?: string | null; to?: string | null;
}
const FILTER_DIMS: (keyof LoadFilter & LoadDim)[] = ["program", "cohort", "course", "term", "semester", "year", "dayOfWeek", "site", "system", "county", "ring", "facilityType", "setting", "agreement", "status", "student", "preceptor"];
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
  const head = ["Date", "Day", "Year", "Semester", "Week of", "Term", "Program", "Cohort", "Class", "Student", "Site", "Health system", "County", "Ring", "Facility type", "Drive min", "Setting", "Hours", "Status", "Preceptor", "Agreement"];
  const cell = (v: string | number | null | undefined) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = rows.map((r) => [r.date, r.dayOfWeek, r.year, r.semester, r.date ? mondayOf(r.date) : null, r.term, r.program, r.cohort, r.course, r.student, r.site, r.system, r.county, r.ring, r.facilityType, r.driveMinutes != null ? Math.round(r.driveMinutes) : null, r.setting, r.hours, r.status, r.preceptor, r.agreement].map(cell).join(","));
  return [head.join(","), ...lines].join("\r\n") + "\r\n";
}
export function pivotToCsv(p: ReturnType<typeof pivot>, rowLabel: string): string {
  const cell = (v: string | number | null | undefined) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
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

/** The leaderboard: every site with what it carries and how full it runs. */
export function siteStats(rows: LoadRow[], seats: SiteSeats[] = []): SiteStat[] {
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
    const preceptors = new Set<string>();
    for (const r of list) {
      const p = byProgram.get(r.program) ?? { days: 0, students: new Set() }; p.days++; p.students.add(r.studentId); byProgram.set(r.program, p);
      bySetting.set(r.setting ?? "(no setting)", (bySetting.get(r.setting ?? "(no setting)") ?? 0) + 1);
      if (r.date) { const d = byDay.get(r.date) ?? new Set(); d.add(r.studentId); byDay.set(r.date, d); }
      if (r.preceptorId) preceptors.add(r.preceptorId);
    }
    const dates = [...byDay.keys()].sort();
    const dayCounts = [...byDay.values()].map((s) => s.size);
    const peak = Math.max(0, ...dayCounts);
    const avg = dayCounts.length ? dayCounts.reduce((n, v) => n + v, 0) / dayCounts.length : 0;
    const seat = r0.employerId ? seatBy.get(r0.employerId) : undefined;
    const seatsPerDay = seat?.seatsPerDay ?? null;
    return {
      employerId: r0.employerId, site: r0.site, system: r0.system, county: r0.county, ring: r0.ring, facilityType: r0.facilityType, driveMinutes: r0.driveMinutes, agreement: r0.agreement,
      studentDays: list.length, students: students.size, hours: list.reduce((n, r) => n + r.hours, 0), share: list.length / total,
      programs: [...byProgram.entries()].map(([name, v]) => ({ name, studentDays: v.days, students: v.students.size })).sort((a, b) => b.studentDays - a.studentDays),
      settings: [...bySetting.entries()].map(([code, studentDays]) => ({ code, studentDays })).sort((a, b) => b.studentDays - a.studentDays),
      cohorts: [...new Set(list.map((r) => r.cohort))].sort(),
      weeksActive: new Set(dates.map(mondayOf)).size, firstDate: dates[0] ?? null, lastDate: dates[dates.length - 1] ?? null,
      peakDayStudents: peak, avgStudentsPerActiveDay: avg,
      seatsPerDay, utilization: seatsPerDay && seatsPerDay > 0 ? avg / seatsPerDay : null,
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
