// Requirement coverage — pure: for a family's requirement set, which sites can provide
// EACH required experience, at the grain the credentialing body counts (an ARRT
// competency, an AST case category), and what that adds up to per category.
//
// A site provides an item when a coordinator has recorded that it does (a provision:
// provides / limited, with an annual volume and, for cases, the most a student may do
// there), or — with no record either way — when it has an active asset in one of the
// item's settings (INFERRED: a hospital with a fluoroscopy room presumably does upper
// GIs; a site that has no OR cannot supply cardiothoracic cases). An explicit "none"
// removes an inference. Inferred provision is never success-styled: the verdict a page
// shows is computed from the weakest required input (src/lib/evidence.ts). Categories the
// set names as needing service-line confirmation (cardiothoracic, neurosurgery, transplant)
// are never inferred from a generic asset — they read "possible" until the site confirms.

export interface ReqItemLite { id: string; category: string; name: string; mandatory: boolean; electiveGroup: string | null; minCount: number | null; role: string | null; settingCodes: string; notes: string | null }
export interface ReqSiteLite { employerId: string; name: string; agreementRank: number; seatsBySetting: Record<string, number>; casesPerDay: number | null; driveMinutes: number | null; ring: string | null }
export interface ProvisionLite { employerId: string; itemId: string; status: string; annualVolume: number | null; studentRole: string | null; source: string; notes?: string | null }
export type ProvisionBasis = "verified" | "estimate" | "inferred";
/** `possible`: the site has the asset but the item is a service line a generic asset does not imply. */
export interface SiteProvision { site: ReqSiteLite; status: "provides" | "limited" | "possible"; basis: ProvisionBasis; annualVolume: number | null; studentRole: string | null; seats: number }
export type ItemVerdict = "covered" | "possible" | "asked-only" | "prospect-only" | "none" | "n/a";
export interface ItemCoverage<T extends ReqItemLite = ReqItemLite> {
  item: T;
  settings: string[];
  providers: { secured: SiteProvision[]; asked: SiteProvision[]; other: SiteProvision[] };
  /** Sites that explicitly said no. */
  declined: number;
  /** Secured providers that are only inferred from assets (nobody confirmed). */
  unverifiedSecured: number;
  /** Secured providers the site confirmed (a VERIFIED record saying provides or limited). */
  confirmedSecured: number;
  annualVolumeSecured: number | null;
  /** `covered` = a secured site provides it (confirmed or inferred); `possible` = only a service-line
   *  guess at a secured site. The basis is separate: see confirmedSecured / unverifiedSecured. */
  verdict: ItemVerdict;
}
export interface CategoryCoverage<T extends ReqItemLite = ReqItemLite> {
  category: string;
  items: T[];
  itemCoverage: ItemCoverage<T>[];
  mandatory: number; elective: number;
  settings: string[];
  /** Sites that provide at least one of the category's items, by agreement tier. */
  sites: { secured: ReqSiteLite[]; asked: ReqSiteLite[]; other: ReqSiteLite[] };
  seatsSecured: number; seatsAsked: number;
  nearestSecuredMinutes: number | null;
  /** Required items no secured site provides — the real placement gaps. */
  mandatoryGaps: T[];
  electiveGaps: T[];
  /** Items whose only secured providers are inferred, unconfirmed. */
  unverified: number;
  /** Required items with at least one confirmed secured provider. */
  requiredConfirmed: number;
  verdict: ItemVerdict;
}
export interface CoverageOptions {
  /** Categories a generic asset must not be taken to imply (service lines): inferred only as "possible". */
  noInferCategories?: Iterable<string>;
}
export const csv = (v: string | null | undefined) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

/** How one site stands on one item: explicit record wins, else inferred from its assets in the item's settings. */
export function provisionOf(site: ReqSiteLite, item: ReqItemLite, record: ProvisionLite | undefined, noInfer = false): SiteProvision | "none" | "unknown" {
  const settings = csv(item.settingCodes);
  const seats = settings.reduce((n, c) => n + (site.seatsBySetting[c] ?? 0), 0);
  if (record) {
    if (record.status === "none") return "none";
    return { site, status: record.status === "limited" ? "limited" : "provides", basis: record.source === "ESTIMATE" ? "estimate" : "verified", annualVolume: record.annualVolume, studentRole: record.studentRole, seats };
  }
  if (!settings.length) return "unknown";
  if (seats <= 0) return "unknown";
  return { site, status: noInfer ? "possible" : "provides", basis: "inferred", annualVolume: null, studentRole: null, seats };
}

export function itemCoverage<T extends ReqItemLite>(item: T, sites: ReqSiteLite[], provisions: ProvisionLite[], noInfer = false): ItemCoverage<T> {
  const settings = csv(item.settingCodes);
  const byEmp = new Map(provisions.filter((p) => p.itemId === item.id).map((p) => [p.employerId, p]));
  const providers = { secured: [] as SiteProvision[], asked: [] as SiteProvision[], other: [] as SiteProvision[] };
  let declined = 0;
  for (const s of sites) {
    const p = provisionOf(s, item, byEmp.get(s.employerId), noInfer);
    if (p === "none") { declined++; continue; }
    if (p === "unknown") continue;
    (s.agreementRank === 0 ? providers.secured : s.agreementRank === 1 ? providers.asked : providers.other).push(p);
  }
  const gradable = settings.length > 0 || byEmp.size > 0;
  const real = (xs: SiteProvision[]) => xs.filter((p) => p.status !== "possible");
  const verdict: ItemVerdict = !gradable ? "n/a"
    : real(providers.secured).length ? "covered"
    : providers.secured.length ? "possible"
    : real(providers.asked).length ? "asked-only"
    : real(providers.other).length ? "prospect-only" : "none";
  const vols = providers.secured.map((p) => p.annualVolume).filter((v): v is number => v != null);
  return {
    item, settings, providers, declined,
    unverifiedSecured: providers.secured.filter((p) => p.basis === "inferred").length,
    confirmedSecured: providers.secured.filter((p) => p.basis === "verified" && p.status !== "possible").length,
    annualVolumeSecured: vols.length ? vols.reduce((n, v) => n + v, 0) : null, verdict,
  };
}

export function requirementCoverage<T extends ReqItemLite>(items: T[], sites: ReqSiteLite[], provisions: ProvisionLite[] = [], opts: CoverageOptions = {}): CategoryCoverage<T>[] {
  const noInfer = new Set([...(opts.noInferCategories ?? [])].map((c) => c.toLowerCase()));
  const cats: string[] = [];
  for (const it of items) if (!cats.includes(it.category)) cats.push(it.category);
  return cats.map((category) => {
    const mine = items.filter((i) => i.category === category);
    const settings = [...new Set(mine.flatMap((i) => csv(i.settingCodes)))];
    const ic = mine.map((i) => itemCoverage(i, sites, provisions, noInfer.has(category.toLowerCase())));
    const mandatory = mine.filter((i) => i.mandatory).length, elective = mine.length - mandatory;
    const graded = ic.filter((c) => c.verdict !== "n/a");
    if (!graded.length) return { category, items: mine, itemCoverage: ic, mandatory, elective, settings, sites: { secured: [], asked: [], other: [] }, seatsSecured: 0, seatsAsked: 0, nearestSecuredMinutes: null, mandatoryGaps: [], electiveGaps: [], unverified: 0, requiredConfirmed: 0, verdict: "n/a" };
    // Sites that provide anything in the category, by tier — for the "who can supply it" columns.
    const seen = new Map<string, ReqSiteLite>();
    for (const c of ic) for (const tier of ["secured", "asked", "other"] as const) for (const p of c.providers[tier]) seen.set(p.site.employerId, p.site);
    const all = [...seen.values()];
    const seatsOf = (s: ReqSiteLite) => settings.reduce((n, c) => n + (s.seatsBySetting[c] ?? 0), 0);
    const secured = all.filter((s) => s.agreementRank === 0), asked = all.filter((s) => s.agreementRank === 1), other = all.filter((s) => s.agreementRank >= 2);
    const near = secured.map((s) => s.driveMinutes).filter((x): x is number => x != null);
    const mandatoryGaps = ic.filter((c) => c.item.mandatory && c.verdict !== "covered" && c.verdict !== "n/a").map((c) => c.item);
    const electiveGaps = ic.filter((c) => !c.item.mandatory && c.verdict !== "covered" && c.verdict !== "n/a").map((c) => c.item);
    // A category is covered when every required item has a secured provider (or, with no required
    // items, when at least one of its electives does); short of that, the best tier any item reaches.
    const required = ic.filter((c) => c.item.mandatory && c.verdict !== "n/a");
    const best = (xs: ItemCoverage<T>[]): ItemVerdict => xs.some((c) => c.verdict === "covered") ? "covered" : xs.some((c) => c.verdict === "possible") ? "possible" : xs.some((c) => c.verdict === "asked-only") ? "asked-only" : xs.some((c) => c.verdict === "prospect-only") ? "prospect-only" : "none";
    const verdict: ItemVerdict = required.length ? (required.every((c) => c.verdict === "covered") ? "covered" : best(required.filter((c) => c.verdict !== "covered"))) : best(graded);
    return {
      category, items: mine, itemCoverage: ic, mandatory, elective, settings, sites: { secured, asked, other },
      seatsSecured: secured.reduce((n, s) => n + seatsOf(s), 0), seatsAsked: asked.reduce((n, s) => n + seatsOf(s), 0),
      nearestSecuredMinutes: near.length ? Math.min(...near) : null, mandatoryGaps, electiveGaps,
      unverified: ic.filter((c) => c.verdict === "covered" && c.confirmedSecured === 0).length,
      requiredConfirmed: required.filter((c) => c.confirmedSecured > 0).length,
      verdict,
    };
  });
}

/** One site's contribution to a requirement set: per item, what it provides and on what basis. */
export interface SiteItemFit<T extends ReqItemLite = ReqItemLite> { item: T; settings: string[]; seats: number; state: "provides" | "limited" | "possible" | "none" | "unknown" | "n/a"; basis: ProvisionBasis | null; annualVolume: number | null; studentRole: string | null; notes: string | null }
export function siteFit<T extends ReqItemLite>(site: ReqSiteLite, items: T[], provisions: ProvisionLite[], opts: CoverageOptions = {}): SiteItemFit<T>[] {
  const noInfer = new Set([...(opts.noInferCategories ?? [])].map((c) => c.toLowerCase()));
  const byItem = new Map(provisions.filter((p) => p.employerId === site.employerId).map((p) => [p.itemId, p]));
  return items.map((item) => {
    const settings = csv(item.settingCodes);
    const seats = settings.reduce((n, c) => n + (site.seatsBySetting[c] ?? 0), 0);
    const rec = byItem.get(item.id);
    const p = provisionOf(site, item, rec, noInfer.has(item.category.toLowerCase()));
    if (p === "none") return { item, settings, seats, state: "none", basis: rec?.source === "ESTIMATE" ? "estimate" : "verified", annualVolume: null, studentRole: null, notes: rec?.notes ?? null };
    if (p === "unknown") return { item, settings, seats, state: settings.length ? "unknown" : "n/a", basis: null, annualVolume: null, studentRole: null, notes: rec?.notes ?? null };
    return { item, settings, seats, state: p.status, basis: p.basis, annualVolume: p.annualVolume, studentRole: p.studentRole, notes: rec?.notes ?? null };
  });
}
/** A site's fit rolled up: what it provides, what it has confirmed, what is only inferred or possible. */
export function siteFitScore(fit: SiteItemFit[]): { requiredProvided: number; requiredConfirmed: number; required: number; electiveProvided: number; elective: number; unverified: number; possible: number; declined: number; unknown: number } {
  const g = fit.filter((x) => x.state !== "n/a"), reqd = g.filter((x) => x.item.mandatory);
  const provides = (x: SiteItemFit) => x.state === "provides" || x.state === "limited";
  return {
    requiredProvided: reqd.filter(provides).length, requiredConfirmed: reqd.filter((x) => provides(x) && x.basis === "verified").length, required: reqd.length,
    electiveProvided: g.filter((x) => !x.item.mandatory && provides(x)).length, elective: g.filter((x) => !x.item.mandatory).length,
    unverified: g.filter((x) => provides(x) && x.basis === "inferred").length, possible: g.filter((x) => x.state === "possible").length,
    declined: g.filter((x) => x.state === "none").length, unknown: g.filter((x) => x.state === "unknown").length,
  };
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
