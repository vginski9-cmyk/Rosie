// Lenoir Community College's Nurse Aide I cohort schedule, as the college keeps it: every cohort
// with its dates, the days it meets, the time of day and where — on the Kinston campus (Bullock
// Building) or at the La Grange, Jones County and Greene County centers and Kinston High School's
// Lancer Academy. Each row becomes an offering of the workbook delivery model it matches (Monday &
// Wednesday or Tuesday & Thursday; 20-, 18- or 16-week — prisma/templates/cna-lenoir.json) with its
// own term dates and weekly class pattern in its room. The sheet carries no enrollment, so past
// cohorts have no students here; future and running ones get the dummy roster like every other
// planned offering.

import type { PrismaClient } from "@prisma/client";
import { deriveCohortTargets } from "../src/lib/pipeline";
import { BENCHMARK_RATES } from "../src/lib/northstar";
import { STAGES } from "../src/lib/funnel";
import { seasonOfDate } from "../src/lib/term";
import { holidayMap } from "../src/lib/academiccalendar";

interface Row { cohort: string; start: string; end: string; days: string; time: string; location: string; given?: string }

/** The sheet, row for row (M/D/YYYY dates as ISO). Two rows' dates as given cannot be right and are
 *  corrected to the day of week the cohort meets — `given` keeps what the sheet says. */
export const LENOIR_COHORTS: Row[] = [
  { cohort: "Cohort 1 - 78572", start: "2025-10-27", end: "2026-03-18", days: "Mon, Wed", time: "5:30pm-9:30pm", location: "Lagrange Center" },
  { cohort: "Cohort 2 - 79375", start: "2025-10-20", end: "2026-03-14", days: "Mon, Sat", time: "6:00pm-10:00pm", location: "Jones County Center" },
  { cohort: "Cohort 3 - 79771", start: "2026-01-05", end: "2026-06-08", days: "Mon, Tue", time: "6:00pm-10:00pm", location: "Greene County Center" },
  { cohort: "Cohort 4 - 79410", start: "2026-01-12", end: "2026-06-24", days: "Mon, Wed", time: "5:30pm-9:30pm", location: "Main Campus, Bullock Bldg, Rm 173" },
  { cohort: "Cohort 5 - 79974", start: "2026-03-03", end: "2026-06-25", days: "Tue, Thur", time: "6:00pm-10:00pm", location: "Greene County Center" },
  // Sheet: 10/7/2026 – 2/27/2026 (ends before it starts). 10/7/2025 is a Tuesday, the cohort's first day.
  { cohort: "Cohort 6 - 78901", start: "2025-10-07", end: "2026-02-27", days: "Tue, Thur", time: "6:00pm-10:00pm", location: "Greene County Center", given: "10/7/2026 – 2/27/2026" },
  { cohort: "Cohort 7 - 78496", start: "2025-08-26", end: "2026-02-07", days: "Tue, Thur", time: "5:30pm-9:30pm", location: "Main Campus, Bullock Bldg, Rm 173" },
  { cohort: "Cohort 8 - 79816", start: "2026-04-13", end: "2026-08-19", days: "Mon, Wed", time: "8:00am-2:30pm", location: "Main Campus, Bullock Bldg, Rm 175" },
  { cohort: "Cohort 9 - 80907", start: "2026-08-03", end: "2026-12-09", days: "Mon, Wed", time: "5:30pm-9:30pm", location: "Main Campus, Bullock Bldg, Rm 173" },
  { cohort: "Cohort 10 - 80918", start: "2026-06-02", end: "2026-10-01", days: "Tue, Thur", time: "08:00am-2:30pm", location: "Main Campus, Bullock Bldg, Rm 173" },
  { cohort: "Cohort 11 - 81127", start: "2026-08-24", end: "2026-12-17", days: "Tue, Wed, Thur", time: "12:05pm-2:50pm", location: "Kinston High School, Lancer Academy" },
  { cohort: "Cohort 12 - 78629", start: "2026-01-14", end: "2026-05-27", days: "Mon, Wed", time: "08:00am-2:30pm", location: "Main Campus, Bullock Bldg, Rm 173" },
  { cohort: "Cohort 13 - 79671", start: "2026-02-17", end: "2026-07-07", days: "Tue, Thur, Fri", time: "08:30am-12:30pm", location: "Main Campus, Bullock Bldg, Rm 175" },
  { cohort: "Cohort 14 - 79938", start: "2026-04-13", end: "2026-09-30", days: "Mon, Wed", time: "08:30am-12:30pm", location: "Main Campus, Bullock Bldg, Rm 177" },
  { cohort: "Cohort 15 - 79875", start: "2026-03-03", end: "2026-08-13", days: "Tue, Thur", time: "5:30pm-9:30pm", location: "Main Campus, Bullock Bldg, Rm 173" },
  { cohort: "Cohort 16 - 78498", start: "2025-09-09", end: "2026-01-30", days: "Tue, Thur, Fri", time: "08:30am-12:30pm", location: "Main Campus, Bullock Bldg, Rm 177" },
  { cohort: "Cohort 17 - 78750", start: "2025-11-05", end: "2026-03-30", days: "Mon, Wed", time: "8:00am-2:30pm", location: "Main Campus, Bullock Bldg, Rm 175" },
  { cohort: "Cohort 18 - 76997", start: "2025-03-25", end: "2025-07-24", days: "Tue, Thur", time: "6:00pm-10:00pm", location: "Lagrange Center" },
  { cohort: "Cohort 19 - 77882", start: "2025-03-24", end: "2025-08-20", days: "Mon, Wed", time: "6:00pm-10:00pm", location: "Jones County Center" },
  { cohort: "Cohort 20 - 77230", start: "2025-08-04", end: "2025-12-01", days: "Mon, Tue", time: "6:00pm-10:00pm", location: "Greene County Center" },
  { cohort: "Cohort 21 - 79934", start: "2026-03-30", end: "2026-08-15", days: "Mon, Wed", time: "6:00pm-10:00pm", location: "Jones County Center" },
  { cohort: "Cohort 22 - 76099", start: "2025-03-25", end: "2025-07-24", days: "Tue, Thur", time: "6:00pm-10:00pm", location: "Lagrange Center" },
  { cohort: "Cohort 23 - 76840", start: "2025-01-16", end: "2025-05-08", days: "Tue, Thur", time: "6:00pm-10:00pm", location: "Jones County Center" },
  { cohort: "Cohort 24 - 75933", start: "2024-09-16", end: "2025-02-24", days: "Mon, Sat", time: "6:00pm-10:00pm", location: "Jones County Center" },
  { cohort: "Cohort 25 - 77599", start: "2025-04-08", end: "2025-07-24", days: "Tue, Thur", time: "6:00pm-10:00pm", location: "Greene County Center" },
  // Sheet: 7/27/2025 – 6/9/2025 (ends before it starts; 7/27 is a Sunday). 1/27/2025 is a Monday, the cohort's first day.
  { cohort: "Cohort 26 - 76811", start: "2025-01-27", end: "2025-06-09", days: "Mon, Wed", time: "9:00am-3:00pm", location: "Greene County Center", given: "7/27/2025 – 6/9/2025" },
  { cohort: "Cohort 27 - 77142", start: "2025-03-03", end: "2025-07-02", days: "Mon, Tue", time: "6:00pm-10:00pm", location: "Greene County Center" },
  { cohort: "Cohort 28 - 77956", start: "2025-06-23", end: "2025-11-03", days: "Mon, Wed", time: "9:00am-3:00pm", location: "Greene County Center" },
  { cohort: "Cohort 29 - 78671", start: "2025-08-25", end: "2025-12-12", days: "Tue, Wed, Thur", time: "12:05pm-2:50pm", location: "Kinston High School, Lancer Academy" },
  { cohort: "Cohort 30 - 78217", start: "2025-06-18", end: "2025-10-27", days: "Mon, Wed", time: "8:00am-2:30pm", location: "Main Campus, Bullock Bldg, Rm 175" },
  { cohort: "Cohort 31 - 78195", start: "2025-05-20", end: "2025-09-25", days: "Tue, Thur", time: "8:30am-3:00pm", location: "Main Campus, Bullock, Rm 177" },
  { cohort: "Cohort 32 - 77998", start: "2025-05-05", end: "2025-10-22", days: "Mon, Thur, Sat", time: "5:30pm-9:30pm", location: "Main Campus, Bullock, Rm 173" },
  { cohort: "Cohort 33 - 76070", start: "2025-01-16", end: "2025-05-20", days: "Tue, Thur", time: "8:30am-3:00pm", location: "Main Campus, Bullock, Rm 173" },
  { cohort: "Cohort 34 - 76069", start: "2025-02-25", end: "2025-07-31", days: "Tue, Thur", time: "5:30pm-9:30pm", location: "Main Campus, Bullock, Rm 173" },
  { cohort: "Cohort 35 - 76068", start: "2025-01-07", end: "2025-05-08", days: "Tue, Thur", time: "8:30am-3:00pm", location: "Main Campus, Bullokck, Rm 177" },
  { cohort: "Cohort 36 - 76067", start: "2025-01-27", end: "2025-06-09", days: "Mon, Wed", time: "8:00am-2:30pm", location: "Main Campus, Bullock, Rm 175" },
  { cohort: "Cohort 37 - 76982", start: "2024-12-02", end: "2025-04-23", days: "Mon, Wed", time: "8:30am-3:00pm", location: "Main Campus, Bullock, Rm 173" },
  { cohort: "Cohort 38 - 75998", start: "2024-10-21", end: "2025-03-12", days: "Mon, Wed", time: "8:00am-2:30pm", location: "Main Campus, Bullock, Rm 175" },
];

const DAY: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
/** "Mon, Wed" / "Tue, Thur, Fri" / "Monday & Wednesday" → ["Mon", "Wed"] / ["Tue", "Thu", "Fri"] / ["Mon", "Wed"]. */
export const parseDays = (s: string): string[] => s.split(/[,/&]+/).map((d) => DAY[d.trim().toLowerCase().slice(0, 3)]).filter((d): d is string => !!d);
/** "5:30pm-9:30pm" / "08:00am-2:30pm" → { start: "17:30", hours: 4 }. */
export function parseTime(s: string): { start: string; end: string; hours: number } {
  const to24 = (t: string) => { const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap])m?$/i.exec(t.trim()); if (!m) throw new Error(`time: ${t}`); let h = Number(m[1]) % 12; if (m[3].toLowerCase() === "p") h += 12; return h * 60 + Number(m[2] ?? 0); };
  const [a, b] = s.split(/[-–]/); const st = to24(a), en = to24(b);
  const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
  return { start: hhmm(st), end: hhmm(en), hours: (en - st) / 60 };
}
/** Where a cohort meets, as a room in a building on a campus. Spelling variants in the sheet fold together. */
export function parseLocation(s: string): { campus: string; city: string; building: string; room: string; roomNumber: string | null } {
  const rm = /rm\s*(\d+)/i.exec(s)?.[1] ?? null;
  if (/main campus/i.test(s)) return { campus: "Main Campus", city: "Kinston", building: "Bullock Building", room: `Bullock ${rm ?? "classroom"}`, roomNumber: rm };
  if (/lagrange|la grange/i.test(s)) return { campus: "La Grange Center", city: "La Grange", building: "La Grange Center", room: "La Grange Center classroom", roomNumber: null };
  if (/jones county/i.test(s)) return { campus: "Jones County Center", city: "Trenton", building: "Jones County Center", room: "Jones County Center classroom", roomNumber: null };
  if (/greene county/i.test(s)) return { campus: "Greene County Center", city: "Snow Hill", building: "Greene County Center", room: "Greene County Center classroom", roomNumber: null };
  if (/kinston high/i.test(s)) return { campus: "Kinston High School", city: "Kinston", building: "Kinston High School — Lancer Academy", room: "Lancer Academy classroom", roomNumber: null };
  return { campus: "Main Campus", city: "Kinston", building: s, room: s, roomNumber: rm };
}

const iso = (d: string) => new Date(d + "T00:00:00Z");
const weeksBetween = (a: string, b: string) => Math.max(1, Math.round((iso(b).getTime() - iso(a).getTime()) / (7 * 86400000)));
/** Weeks a cohort runs, first day to last day inclusive (Oct 27 → Mar 18 is 20.4 weeks). */
export const cohortWeeks = (r: Pick<Row, "start" | "end">) => Math.max(1, ((iso(r.end).getTime() - iso(r.start).getTime()) / 86400000 + 1) / 7);
/** A cohort meeting from 5:00 p.m. on is an evening class. */
export const isEvening = (time: string) => parseTime(time).start >= "17:00";

/** A workbook delivery model as it reads from its program: "Nurse Aide Level I — Monday & Wednesday
 *  20-week Offering", evening or daytime by its program type. */
export interface LenoirModel { name: string; days: string[]; weeks: number; evening: boolean }
const MODEL_NAME = /^Nurse Aide Level I — (.+?) (\d+)-week Offering$/i;
export function parseModel(name: string, programType: string | null): LenoirModel | null {
  const m = MODEL_NAME.exec(name); if (!m) return null;
  return { name, days: parseDays(m[1].replace(/\s*&\s*/g, ",")), weeks: Number(m[2]), evening: /evening|night/i.test(programType ?? "") };
}

/** The workbook model a cohort runs on. First the class days: the model it shares most days with
 *  (Monday & Wednesday vs Tuesday & Thursday — a Mon/Sat or Tue/Wed/Thu cohort goes by the days it
 *  does share, a tie by its first class day). Then, among those, the closest fit on length and time
 *  of day: the workbook's 20-week model is the 5:30–9:30p evening class and its 18- and 16-week
 *  models are daytime, so a model on the wrong side of 5 p.m. counts as two weeks off. */
export function modelFor(r: Pick<Row, "days" | "time" | "start" | "end">, models: LenoirModel[]): LenoirModel {
  if (!models.length) throw new Error("no Lenoir delivery models to choose from");
  const days = parseDays(r.days); const weeks = cohortWeeks(r); const evening = isEvening(r.time);
  const shared = (m: LenoirModel) => m.days.filter((d) => days.includes(d)).length;
  const best = Math.max(...models.map(shared));
  let pool = models.filter((m) => shared(m) === best);
  if (pool.length > 1 && best > 0) { const first = pool.filter((m) => m.days.includes(days[0])); if (first.length) pool = first; }
  const miss = (m: LenoirModel) => Math.abs(m.weeks - weeks) + (m.evening === evening ? 0 : 2);
  return [...pool].sort((a, b) => miss(a) - miss(b) || b.weeks - a.weeks)[0];
}

// ----- Scheduling the cohorts ahead ------------------------------------------------------------
// The college runs its classes in slots — a room, its class days (Monday & Wednesday or Tuesday &
// Thursday) and a time of day — and most slots run one cohort after another with a short gap
// (Bullock 175 mornings: Oct 2024 → Mar 2025, Jan → Jun, Jun → Oct, Nov → Mar, Apr → Aug). A few
// run once a year (Lancer Academy each fall). The projection carries each slot forward the way
// the sheet shows it running: back-to-back slots start again their usual gap after the last run
// ends, yearly slots start again a year after their last start, each new run as long as the
// slot's runs have been, on the same days, at the same time, in the same room.

/** A slot: room · class days · time of day. Mon/Sat and Mon/Tue cohorts go with Monday & Wednesday. */
export function slotOf(r: Pick<Row, "days" | "time" | "location">): string {
  const days = parseDays(r.days);
  const mw = days.filter((d) => d === "Mon" || d === "Wed").length, tt = days.filter((d) => d === "Tue" || d === "Thu").length;
  const group = mw > tt ? "Mon & Wed" : tt > mw ? "Tue & Thu" : days[0] === "Mon" ? "Mon & Wed" : "Tue & Thu";
  return `${parseLocation(r.location).room} · ${group} · ${isEvening(r.time) ? "evening" : "daytime"}`;
}

export interface ProjectedRow extends Row { slot: string; basis: string }
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const addDaysIso = (s: string, n: number) => new Date(iso(s).getTime() + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((iso(b).getTime() - iso(a).getTime()) / 86400000);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };
const monthYear = (s: string) => iso(s).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
/** Slots whose runs follow each other within this many days are back-to-back; longer gaps mean a yearly run. */
const BACK_TO_BACK_DAYS = 56;

/** Project the sheet's slots forward: every run that would start after `from` and by `through`. */
export function projectLenoirCohorts(rows: Row[], opts: { from: string; through: string; holidays?: Record<string, string> }): ProjectedRow[] {
  const holidays = opts.holidays ?? {};
  const slots = new Map<string, Row[]>();
  for (const r of rows) { const k = slotOf(r); slots.set(k, [...(slots.get(k) ?? []), r]); }
  const out: ProjectedRow[] = [];
  for (const [slot, runs] of slots) {
    runs.sort((a, b) => a.start.localeCompare(b.start));
    const last = runs[runs.length - 1];
    const meetDays = parseDays(last.days);
    const length = Math.round(median(runs.map((r) => daysBetween(r.start, r.end))));
    // The slot's first class day of the week, on or after `s`, that is not a holiday.
    const firstClassDay = (s: string) => { let d = s; for (let n = 0; n < 60; n++, d = addDaysIso(d, 1)) if (DOW[iso(d).getUTCDay()] === meetDays[0] && !holidays[d]) return d; return s; };
    const overlapsReal = (start: string, end: string) => runs.some((r) => start <= r.end && end >= r.start);
    const gaps = runs.slice(1).map((r, i) => daysBetween(runs[i].end, r.start)).filter((g) => g >= 0);
    const gap = gaps.length ? Math.round(median(gaps)) : NaN;
    const basis = runs.length >= 2 && gap <= BACK_TO_BACK_DAYS
      ? `${runs.length} runs back to back, about ${Math.round(gap / 7)} week${Math.round(gap / 7) === 1 ? "" : "s"} apart`
      : runs.length >= 2 ? `${runs.length} runs about a year apart` : `one run (${last.cohort})`;
    const make = (start: string): ProjectedRow => ({ cohort: "", start, end: addDaysIso(start, length), days: last.days, time: last.time, location: last.location, slot, basis });
    if (runs.length >= 2 && gap <= BACK_TO_BACK_DAYS) {
      let cursor = last.end;
      for (let n = 0; n < 12; n++) {
        const start = firstClassDay(addDaysIso(cursor, gap));
        if (start > opts.through) break;
        const row = make(start);
        if (start > opts.from && !overlapsReal(row.start, row.end)) out.push(row);
        cursor = row.end;
      }
    } else {
      for (let start = addDaysIso(last.start, 364); start <= opts.through; start = addDaysIso(start, 364)) {
        const row = make(firstClassDay(start));
        if (row.start > opts.from && !overlapsReal(row.start, row.end)) out.push(row);
      }
    }
  }
  // Numbered on from the college's own cohorts, in start order: "Cohort 39 · Bullock 175 · Mon & Wed · daytime · Jan 2027".
  out.sort((a, b) => a.start.localeCompare(b.start) || a.slot.localeCompare(b.slot));
  const next = 1 + Math.max(0, ...rows.map((r) => Number(/^Cohort (\d+)/.exec(r.cohort)?.[1] ?? 0)));
  out.forEach((r, i) => { r.cohort = `Cohort ${next + i} · ${r.slot} · ${monthYear(r.start)}`; });
  return out;
}

/** Seed the cohorts as offerings of Lenoir's Nurse Aide Level I models, with their rooms and weekly class patterns. */
/** Seed the sheet's cohorts and, after today, the runs projected from them through `through`
 *  (projected runs are planned offerings named "Planned <month> · <slot>"). */
export async function seedLenoirCohorts(prisma: PrismaClient, institutionId: string, today = new Date(), through = "2027-12-31"): Promise<{ cohorts: number; projected: number; rooms: number; patterns: number; byStatus: Record<string, number>; byModel: Record<string, number>; startsByYear: Record<string, number> }> {
  const programs = await prisma.program.findMany({ where: { institutionId, name: { startsWith: "Nurse Aide Level I" } }, include: { family: { select: { goalPlan: true } }, terms: { orderBy: { index: "asc" }, include: { courses: { orderBy: { sequenceOrder: "asc" }, select: { id: true } } } } } });
  const models = programs.map((p) => ({ program: p, model: parseModel(p.name, p.programType) })).filter((x): x is { program: (typeof programs)[number]; model: LenoirModel } => !!x.model && x.program.terms.length > 0 && x.program.terms[0].courses.length > 0);
  if (!models.length) throw new Error("Lenoir's Nurse Aide Level I delivery models are not seeded");
  const family = models[0].program.family;
  let rates = { ...BENCHMARK_RATES };
  if (family?.goalPlan) { try { const saved = JSON.parse(family.goalPlan) as { goal?: Partial<typeof BENCHMARK_RATES>; goalsByYear?: Record<string, number> }; if (saved.goal) rates = { ...rates, ...saved.goal }; } catch { /* benchmarks */ } }
  const annualGoal = (year: number) => { try { const gp = JSON.parse(family?.goalPlan ?? "{}") as { goalsByYear?: Record<string, number> }; return gp.goalsByYear?.[String(year)] ?? 80; } catch { return 80; } };

  // Campuses, buildings and rooms — one room per distinct place in the sheet.
  const campusId = new Map<string, string>(); const buildingId = new Map<string, string>(); const roomId = new Map<string, string>();
  const main = await prisma.campus.findFirst({ where: { institutionId }, orderBy: { createdAt: "asc" } });
  if (main) campusId.set("Main Campus", main.id);
  for (const r of LENOIR_COHORTS) {
    const loc = parseLocation(r.location);
    if (!campusId.has(loc.campus)) campusId.set(loc.campus, (await prisma.campus.create({ data: { institutionId, name: loc.campus, city: loc.city, state: "NC" } })).id);
    if (!buildingId.has(loc.building)) buildingId.set(loc.building, (await prisma.building.create({ data: { institutionId, campusId: campusId.get(loc.campus)!, name: loc.building } })).id);
    if (!roomId.has(loc.room)) roomId.set(loc.room, (await prisma.facility.create({ data: { institutionId, name: loc.room, kind: "CLASSROOM", buildingId: buildingId.get(loc.building)!, building: loc.building, roomNumber: loc.roomNumber, availability: "Nurse Aide I cohorts", status: "active" } })).id);
  }

  // The runs ahead, on the college's own holidays (a run never starts on a closed day).
  const holidays = holidayMap((await prisma.academicEvent.findMany({ where: { institutionId, kind: "holiday" }, select: { date: true, endDate: true, label: true, kind: true } }))
    .map((e) => ({ iso: e.date.toISOString().slice(0, 10), endIso: e.endDate?.toISOString().slice(0, 10) ?? null, label: e.label, kind: e.kind })));
  const projected = projectLenoirCohorts(LENOIR_COHORTS, { from: today.toISOString().slice(0, 10), through, holidays });
  const rows: Row[] = [...LENOIR_COHORTS, ...projected];

  const startsInYear = new Map<number, number>();
  for (const r of rows) { const y = iso(r.start).getUTCFullYear(); startsInYear.set(y, (startsInYear.get(y) ?? 0) + 1); }
  const byStatus: Record<string, number> = {}; const byModel: Record<string, number> = {}; let patterns = 0;
  for (const r of rows) {
    const start = iso(r.start), end = iso(r.end);
    const status = end < today ? "completed" : start <= today ? "active" : "planned";
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    const pick = modelFor(r, models.map((m) => m.model));
    const { program } = models.find((m) => m.model === pick)!;
    const term = program.terms[0]; const courseId = term.courses[0].id;
    const seats = program.defaultCohortSeats ?? 10;
    byModel[pick.name.replace(/^Nurse Aide Level I — /, "")] = (byModel[pick.name.replace(/^Nurse Aide Level I — /, "")] ?? 0) + 1;
    const year = start.getUTCFullYear();
    // Each cohort carries its share of the year's North-Star goal across the cohorts starting that year.
    const goal = Math.max(1, Math.round(annualGoal(year) / (startsInYear.get(year) ?? 1)));
    const t = deriveCohortTargets(goal, rates, 1);
    const cohort = await prisma.cohort.create({ data: { programId: program.id, name: r.cohort, status, startDate: start, entryYear: year, isExplicit: true, plannedSeats: seats, pipelineRates: JSON.stringify({ goal, rates, termOverrides: [] }) } });
    const stageTargets: Record<string, number> = { interested: t.interested, qualified: t.qualified, offered: t.offered, enrolled: seats, completing: t.completing, licensed: t.licensed, placed: t.placed, productive: t.productive };
    await prisma.funnelStage.createMany({ data: STAGES.map((s, i) => ({ cohortId: cohort.id, stageKey: s.key, sortOrder: i, label: s.label, targetNumber: stageTargets[s.key] ?? 0 })) });
    await prisma.cohortTerm.create({ data: { cohortId: cohort.id, termId: term.id, startDate: start, endDate: end, source: "chosen", semester: seasonOfDate(start) } });
    await prisma.cohortCourseDates.create({ data: { cohortId: cohort.id, courseId, startDate: start, endDate: end, auto: false } });
    // The weekly class pattern: the days and hours the sheet gives, in the room it names.
    const time = parseTime(r.time); const loc = parseLocation(r.location); const weeks = weeksBetween(r.start, r.end);
    for (const day of parseDays(r.days)) {
      await prisma.meetingPattern.create({ data: { cohortId: cohort.id, courseId, kind: "CLASS", sectionIndex: 1, sectionCount: 1, seats, dayOfWeek: day, startTime: time.start, lengthHours: time.hours, termIndex: 1, startWeek: 1, endWeek: weeks, facilityId: roomId.get(loc.room) ?? null } });
      patterns++;
    }
  }
  return { cohorts: LENOIR_COHORTS.length, projected: projected.length, rooms: roomId.size, patterns, byStatus, byModel, startsByYear: Object.fromEntries([...startsInYear].sort().map(([y, n]) => [String(y), n])) };
}
