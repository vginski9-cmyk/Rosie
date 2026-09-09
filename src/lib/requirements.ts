// Requirement coverage — pure: for a family's requirement set, which asset settings
// each category needs, and which of the family's sites can supply them (by
// agreement tier), so a coordinator sees where every mandatory experience can be
// had and where nothing in the network provides it.

export interface ReqItemLite { category: string; name: string; mandatory: boolean; electiveGroup: string | null; minCount: number | null; role: string | null; settingCodes: string; notes: string | null }
export interface ReqSiteLite { employerId: string; name: string; agreementRank: number; seatsBySetting: Record<string, number>; casesPerDay: number | null; driveMinutes: number | null; ring: string | null }
export interface CategoryCoverage<T extends ReqItemLite = ReqItemLite> {
  category: string;
  items: T[];
  mandatory: number; elective: number;
  settings: string[];
  /** Sites with at least one asset in one of the category's settings, by agreement tier. */
  sites: { secured: ReqSiteLite[]; asked: ReqSiteLite[]; other: ReqSiteLite[] };
  seatsSecured: number; seatsAsked: number;
  nearestSecuredMinutes: number | null;
  verdict: "covered" | "asked-only" | "prospect-only" | "none" | "n/a";
}
export const csv = (v: string | null | undefined) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

export function requirementCoverage<T extends ReqItemLite>(items: T[], sites: ReqSiteLite[]): CategoryCoverage<T>[] {
  const cats: string[] = [];
  for (const it of items) if (!cats.includes(it.category)) cats.push(it.category);
  return cats.map((category) => {
    const mine = items.filter((i) => i.category === category);
    const settings = [...new Set(mine.flatMap((i) => csv(i.settingCodes)))];
    if (!settings.length) return { category, items: mine, mandatory: mine.filter((i) => i.mandatory).length, elective: mine.filter((i) => !i.mandatory).length, settings, sites: { secured: [], asked: [], other: [] }, seatsSecured: 0, seatsAsked: 0, nearestSecuredMinutes: null, verdict: "n/a" };
    const seatsOf = (s: ReqSiteLite) => settings.reduce((n, c) => n + (s.seatsBySetting[c] ?? 0), 0);
    const able = sites.filter((s) => seatsOf(s) > 0);
    const secured = able.filter((s) => s.agreementRank === 0), asked = able.filter((s) => s.agreementRank === 1), other = able.filter((s) => s.agreementRank >= 2);
    const near = secured.map((s) => s.driveMinutes).filter((x): x is number => x != null);
    const verdict: CategoryCoverage["verdict"] = secured.length ? "covered" : asked.length ? "asked-only" : other.length ? "prospect-only" : "none";
    return { category, items: mine, mandatory: mine.filter((i) => i.mandatory).length, elective: mine.filter((i) => !i.mandatory).length, settings, sites: { secured, asked, other }, seatsSecured: secured.reduce((n, s) => n + seatsOf(s), 0), seatsAsked: asked.reduce((n, s) => n + seatsOf(s), 0), nearestSecuredMinutes: near.length ? Math.min(...near) : null, verdict };
  });
}

/** Which of a program template's clinical courses reach each requirement category — by the service-area
 *  hours (or cases) coded on the course and by the rotation settings its sessions are coded with. `hours`
 *  is per setting per student; a course with a setting but no hours still counts as reaching it. */
export interface CourseSettings { code: string | null; name: string; settings: string[]; hours?: Record<string, number>; cases?: Record<string, number> }
export function requirementCourseCoverage(coverage: CategoryCoverage<ReqItemLite>[], courses: CourseSettings[]): { category: string; courses: string[]; detail: { course: string; hours: number; cases: number }[]; hours: number; cases: number; uncovered: boolean }[] {
  return coverage.map((c) => {
    const detail = courses.filter((k) => k.settings.some((s) => c.settings.includes(s))).map((k) => ({
      course: k.code ?? k.name,
      hours: c.settings.reduce((n, s) => n + (k.hours?.[s] ?? 0), 0),
      cases: c.settings.reduce((n, s) => n + (k.cases?.[s] ?? 0), 0),
    }));
    return { category: c.category, courses: detail.map((d) => d.course), detail, hours: detail.reduce((n, d) => n + d.hours, 0), cases: detail.reduce((n, d) => n + d.cases, 0), uncovered: c.settings.length > 0 && detail.length === 0 };
  });
}
