// THE CLINICAL ROTATION SCHEDULE AS A WORKBOOK — for one offering (cohort), or one clinical
// course of it. Three sheets: every student-shift as a row (the log), the week-by-week grid
// (students × weeks, the site and setting each is at), and the site load by week. Pure: takes
// the rows the query built and returns sheets as arrays of arrays, so it can be tested and
// written as .xlsx or .csv.

import { csvCell } from "./csvsafe";

export interface RotationRow {
  student: string; seat: number; cohort: string; program: string;
  course: string; courseName: string; term: string;
  week: number | null; date: string | null; weekday: string | null; start: string | null; hours: number;
  session: string; setting: string | null; area: string | null; site: string | null; asset: string | null;
  preceptor: string | null; status: string; hoursLogged: number | null; pinned: boolean; note: string | null;
  /** Supervision on the shift (lib/supervision supervisionOnShift): the college instructor, the model, the learners on the
   *  shift and this student's share of each role's hours. Optional so older callers' rows still export; blank when absent. */
  instructor?: string | null; supervision?: string | null; learnersOnShift?: number | null; instructorHours?: number | null; preceptorHours?: number | null;
}

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fmt = (iso: string | null) => (iso ? `${DAY[new Date(iso + "T00:00:00Z").getUTCDay()]} ${iso}` : "undated");
/** Monday of the ISO date's week. */
export function mondayOf(iso: string): string { const d = new Date(iso + "T00:00:00Z"); const dow = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dow); return d.toISOString().slice(0, 10); }

/** The setting rule each rotation type in the export means, as the evaluation service read it — so the workbook says what it was judged against. */
export interface RotationRuleSheetRow { rotationType: string; rule: string; wording: string | null; status: string; mixing: string; continuity: string; questions: string[] }

export function rotationSheets(rows: RotationRow[], rules: RotationRuleSheetRow[] = [], assumptions: string[] = []): Record<string, (string | number | null)[][]> {
  const sorted = [...rows].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999") || (a.start ?? "").localeCompare(b.start ?? "") || a.course.localeCompare(b.course) || a.seat - b.seat || a.student.localeCompare(b.student));
  const log: (string | number | null)[][] = [[
    "Student", "Seat", "Cohort", "Program", "Course", "Course title", "Term", "Week", "Date", "Day", "Start", "Hours", "Session", "Setting", "Service area", "Site", "Asset", "Preceptor", "Instructor", "Supervision", "Learners on shift", "Instructor hours (student's share)", "Preceptor hours (student's share)", "Status", "Hours logged", "Pinned", "Note",
  ]];
  const hrs = (x: number | null | undefined) => (x == null ? null : Math.round(x * 100) / 100);
  for (const r of sorted) log.push([r.student, r.seat, r.cohort, r.program, r.course, r.courseName, r.term, r.week, r.date, r.weekday, r.start, r.hours, r.session, r.setting, r.area, r.site, r.asset, r.preceptor, r.instructor ?? null, r.supervision ?? null, r.learnersOnShift ?? null, hrs(r.instructorHours), hrs(r.preceptorHours), r.status, r.hoursLogged, r.pinned ? "yes" : "", r.note]);

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
  const sheets: Record<string, (string | number | null)[][]> = { "Rotation log": log, "Week by week": grid, "Site load": load };
  // Rules & assumptions: what each rotation type was judged against, its review status, and the assumptions the reader must see.
  // An unreviewed rule is written as such — the export never presents a proposed interpretation as settled.
  if (rules.length || assumptions.length) {
    const ra: (string | number | null)[][] = [["Rotation type", "Setting rule", "Program wording", "Interpretation status", "Hours may be mixed", "Continuity", "Open questions"]];
    for (const r of rules) ra.push([r.rotationType, r.rule, r.wording, r.status === "reviewed" ? "reviewed" : `${r.status} — not reviewed; placements under it are conditional`, r.mixing, r.continuity, r.questions.join(" | ")]);
    if (assumptions.length) { ra.push([]); ra.push(["Assumptions"]); for (const a of assumptions) ra.push([a]); }
    sheets["Rules & assumptions"] = ra;
  }
  return sheets;
}

/** RFC 4180 CSV of one sheet. */
export function sheetToCsv(rows: (string | number | null)[][]): string {
  const cell = csvCell;
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function describeRows(rows: RotationRow[]): string {
  return `${fmt(rows.find((r) => r.date)?.date ?? null)} → ${fmt([...rows].reverse().find((r) => r.date)?.date ?? null)}`;
}
