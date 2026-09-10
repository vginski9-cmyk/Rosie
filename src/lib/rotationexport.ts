// THE CLINICAL ROTATION SCHEDULE AS A WORKBOOK — for one offering (cohort), or one clinical
// course of it. Three sheets: every student-shift as a row (the log), the week-by-week grid
// (students × weeks, the site and setting each is at), and the site load by week. Pure: takes
// the rows the query built and returns sheets as arrays of arrays, so it can be tested and
// written as .xlsx or .csv.

export interface RotationRow {
  student: string; seat: number; cohort: string; program: string;
  course: string; courseName: string; term: string;
  week: number | null; date: string | null; weekday: string | null; start: string | null; hours: number;
  session: string; setting: string | null; area: string | null; site: string | null; asset: string | null;
  preceptor: string | null; status: string; hoursLogged: number | null; pinned: boolean; note: string | null;
}

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fmt = (iso: string | null) => (iso ? `${DAY[new Date(iso + "T00:00:00Z").getUTCDay()]} ${iso}` : "undated");
/** Monday of the ISO date's week. */
export function mondayOf(iso: string): string { const d = new Date(iso + "T00:00:00Z"); const dow = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dow); return d.toISOString().slice(0, 10); }

export function rotationSheets(rows: RotationRow[]): Record<string, (string | number | null)[][]> {
  const sorted = [...rows].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999") || (a.start ?? "").localeCompare(b.start ?? "") || a.course.localeCompare(b.course) || a.seat - b.seat || a.student.localeCompare(b.student));
  const log: (string | number | null)[][] = [[
    "Student", "Seat", "Cohort", "Program", "Course", "Course title", "Term", "Week", "Date", "Day", "Start", "Hours", "Session", "Setting", "Service area", "Site", "Asset", "Preceptor", "Status", "Hours logged", "Pinned", "Note",
  ]];
  for (const r of sorted) log.push([r.student, r.seat, r.cohort, r.program, r.course, r.courseName, r.term, r.week, r.date, r.weekday, r.start, r.hours, r.session, r.setting, r.area, r.site, r.asset, r.preceptor, r.status, r.hoursLogged, r.pinned ? "yes" : "", r.note]);

  // Week grid: one row per student (per course when several), one column per week Monday; cell = site · setting, days on site.
  const weeks = [...new Set(rows.filter((r) => r.date).map((r) => mondayOf(r.date!)))].sort();
  const courses = [...new Set(rows.map((r) => r.course))].sort();
  const students = [...new Map(rows.map((r) => [r.student, r.seat])).entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  const grid: (string | number | null)[][] = [["Student", "Seat", ...(courses.length > 1 ? ["Course"] : []), ...weeks.map((w) => `Week of ${w}`), "Shifts", "Hours"]];
  for (const [student, seat] of students) for (const course of courses) {
    const mine = rows.filter((r) => r.student === student && r.course === course);
    if (!mine.length) continue;
    const cells = weeks.map((w) => {
      const inWeek = mine.filter((r) => r.date && mondayOf(r.date) === w);
      if (!inWeek.length) return "";
      const bySite = new Map<string, number>();
      for (const r of inWeek) { const k = `${r.site ?? "site TBD"}${r.setting ? ` · ${r.setting}` : ""}`; bySite.set(k, (bySite.get(k) ?? 0) + 1); }
      return [...bySite.entries()].map(([k, n]) => `${k} (${n}d)`).join(" / ");
    });
    grid.push([student, seat, ...(courses.length > 1 ? [course] : []), ...cells, mine.length, mine.reduce((n, r) => n + r.hours, 0)]);
  }

  // Site load: site × setting per week — students on site that week and student-days.
  const siteKeys = [...new Set(rows.map((r) => `${r.site ?? "site TBD"}|${r.setting ?? ""}`))].sort();
  const load: (string | number | null)[][] = [["Site", "Setting", ...weeks.map((w) => `Week of ${w}`), "Student-days", "Students"]];
  for (const k of siteKeys) {
    const [site, setting] = k.split("|");
    const mine = rows.filter((r) => (r.site ?? "site TBD") === site && (r.setting ?? "") === setting);
    const cells = weeks.map((w) => { const inWeek = mine.filter((r) => r.date && mondayOf(r.date) === w); if (!inWeek.length) return ""; const st = new Set(inWeek.map((r) => r.student)).size; return `${st} students · ${inWeek.length}d`; });
    load.push([site, setting, ...cells, mine.length, new Set(mine.map((r) => r.student)).size]);
  }
  return { "Rotation log": log, "Week by week": grid, "Site load": load };
}

/** RFC 4180 CSV of one sheet. */
export function sheetToCsv(rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function describeRows(rows: RotationRow[]): string {
  return `${fmt(rows.find((r) => r.date)?.date ?? null)} → ${fmt([...rows].reverse().find((r) => r.date)?.date ?? null)}`;
}
