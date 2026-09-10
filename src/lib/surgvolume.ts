// Surgical case volume, the way a surgical technology program reads a site: how many cases a day
// the OR does on average (annual cases ÷ the days it operates), and how many of those each OR carries.
// The tracker's modeled operating days (250, or 260 for the largest hospitals) are the divisor when the
// facility has them; the program's own case-days-a-year setting is the fallback.

export interface CaseVolume { annualSurgicalCases: number | null; operatingDaysPerYear?: number | null; operatingRooms?: number | null }

/** Average cases a day, or null when the site has no annual volume on record. */
export function avgCasesPerDay(v: CaseVolume, fallbackDays = 250): number | null {
  if (v.annualSurgicalCases == null) return null;
  const days = Math.max(1, v.operatingDaysPerYear ?? fallbackDays);
  return v.annualSurgicalCases / days;
}

/** Average cases per OR per operating day — the tracker's "cases/OR/operating day". */
export function casesPerOrDay(v: CaseVolume, fallbackDays = 250): number | null {
  const perDay = avgCasesPerDay(v, fallbackDays);
  if (perDay == null || !v.operatingRooms) return null;
  return perDay / v.operatingRooms;
}

/** One line for a site: "6,558 cases/yr · ≈ 26.2/day · 6.6 per OR-day". */
export function caseVolumeLine(v: CaseVolume & { inpatientSurgicalCases?: number | null; ambulatorySurgicalCases?: number | null }, fallbackDays = 250): string | null {
  const perDay = avgCasesPerDay(v, fallbackDays);
  if (perDay == null) return null;
  const parts = [`${v.annualSurgicalCases!.toLocaleString("en-US")} cases/yr`];
  if (v.inpatientSurgicalCases != null || v.ambulatorySurgicalCases != null) parts.push(`${(v.inpatientSurgicalCases ?? 0).toLocaleString("en-US")} inpatient · ${(v.ambulatorySurgicalCases ?? 0).toLocaleString("en-US")} ambulatory`);
  parts.push(`≈ ${perDay.toFixed(1)} a day over ${v.operatingDaysPerYear ?? fallbackDays} operating days`);
  const perOr = casesPerOrDay(v, fallbackDays);
  if (perOr != null) parts.push(`${perOr.toFixed(1)} per OR-day`);
  return parts.join(" · ");
}

/** Match a tracker facility name to an organization on file: case, punctuation, "and"/"&", campus dashes. */
export function normalizeFacilityName(name: string): string {
  return name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\b(the|campus|inc|llc)\b/g, " ").replace(/\s+/g, " ").trim();
}

/** The scrub roles a site allows a student on an item, stored as a comma list: "first scrub, second scrub, observation". */
export const SCRUB_ROLES = ["first scrub", "second scrub", "observation"] as const;
export type ScrubRole = (typeof SCRUB_ROLES)[number];
export function parseScrubRoles(v: string | null | undefined): ScrubRole[] {
  const parts = (v ?? "").split(",").map((x) => x.trim().toLowerCase()).map((x) => (x === "observe" || x === "observe only" ? "observation" : x));
  return SCRUB_ROLES.filter((r) => parts.includes(r));
}
export function joinScrubRoles(roles: readonly string[]): string | null {
  const kept = SCRUB_ROLES.filter((r) => roles.includes(r));
  return kept.length ? kept.join(", ") : null;
}
