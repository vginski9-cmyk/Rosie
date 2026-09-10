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
export type LoadDim = "site" | "system" | "county" | "ring" | "facilityType" | "setting" | "program" | "cohort" | "term" | "month" | "week";
export const DIM_LABEL: Record<LoadDim, string> = { site: "Site", system: "Health system", county: "County", ring: "Drive ring", facilityType: "Facility type", setting: "Setting", program: "Program", cohort: "Cohort", term: "Term", month: "Month", week: "Week" };

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
    case "cohort": return r.cohort;
    case "term": return r.term;
    case "month": return r.date ? r.date.slice(0, 7) : "undated";
    case "week": return r.date ? mondayOf(r.date) : "undated";
  }
};
const labelOf = (r: LoadRow, dim: LoadDim): string => (dim === "site" ? r.site : keyOf(r, dim));

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
  return dim === "month" || dim === "week" || dim === "term" ? out.sort((a, b) => a.key.localeCompare(b.key)) : out.sort((a, b) => b.studentDays - a.studentDays || a.label.localeCompare(b.label));
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
