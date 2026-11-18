// THE SEMESTER A CALENDAR WEEK BELONGS TO — one answer for every class on a chart. A week is the college's
// coded semester start whose week it falls in, else the anchor pattern (`semesterAt` on the week's Monday),
// never the season of the class's own term: a class that starts in January and runs twenty weeks has Spring
// weeks and Summer weeks, and a class that starts in May has Spring weeks until the college's summer start
// week. The staffing chart's weekly columns, semester bars, rotation bands, by-semester table and drill-downs
// all read this one rule, so the same Monday is never drawn twice (the owner's call, 2026-11-18: "there
// can't be summer and spring having the same dates"). A Friday-opening semester is carried by `knownStarts`
// (a semester begins with the week of its coded first day — Roanoke-Chowan's Spring 2027, Friday January 8).
import { semesterAt, mondayOfDate, type SemesterAnchors, type Season } from "./term";

export const SEM_ORDER: Record<string, number> = { Spring: 0, Summer: 1, Fall: 2 };

/** The semester and year of the week that begins on `mondayIso` (any date in the week works). */
export function semesterOfWeek(mondayIso: string, anchors?: SemesterAnchors): { year: string; sem: Season } {
  const s = semesterAt(mondayOfDate(new Date(mondayIso + "T00:00:00Z")), anchors);
  return { year: String(s.year), sem: s.season };
}

export interface SemesterWeeks<T> { year: string; sem: Season; /** Monday ISO → the rows of that week. */ weeks: Map<string, T[]> }

/** Rows grouped by the semester and year their week falls in, then by Monday — bands in calendar order (year,
 *  then Spring, Summer, Fall), weeks in date order. Every Monday appears in exactly one band. */
export function weeksBySemester<T extends { cohortId: string; mondayIso: string | null }>(rows: T[], anchorsOf: (cohortId: string) => SemesterAnchors | undefined): SemesterWeeks<T>[] {
  const bands = new Map<string, SemesterWeeks<T>>();
  const cache = new Map<string, { year: string; sem: Season }>();
  for (const r of rows) {
    if (!r.mondayIso) continue;
    const ck = `${r.cohortId}|${r.mondayIso}`;
    let x = cache.get(ck);
    if (!x) { x = semesterOfWeek(r.mondayIso, anchorsOf(r.cohortId)); cache.set(ck, x); }
    const bk = `${x.year}|${x.sem}`;
    const b = bands.get(bk) ?? { year: x.year, sem: x.sem, weeks: new Map<string, T[]>() }; bands.set(bk, b);
    const w = b.weeks.get(r.mondayIso) ?? []; w.push(r); b.weeks.set(r.mondayIso, w);
  }
  return [...bands.values()]
    .sort((a, b) => a.year.localeCompare(b.year) || (SEM_ORDER[a.sem] ?? 9) - (SEM_ORDER[b.sem] ?? 9))
    .map((b) => ({ ...b, weeks: new Map([...b.weeks.entries()].sort((a, c) => a[0].localeCompare(c[0]))) }));
}
