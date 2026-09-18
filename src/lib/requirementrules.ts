// Rules as requirement lines — pure. A case-log standard (surgical technology) carries requirements
// that are not items on the list: total volume, the First Scrub role, and a spread across specialties.
// A network that "covers 1 of 1 required experiences" can still be unable to graduate anyone. These
// lines put each rule on the scorecard next to the items, scored from the same site provisions:
//
//   confirmed  a secured site confirmed what the rule needs (VERIFIED record, right role, known volume)
//   possible   only inferred / unconfirmed providers reach it — never success-styled
//   unknown    the inputs that decide it are missing (no annual volume on record)
//   none       nothing in the network reaches it
//
// The service-line list (`service-line-confirmation`) says which categories a generic asset must
// not be taken to imply; requirements.ts turns those into "possible" until the site confirms.

import type { CategoryCoverage, ReqItemLite, ItemCoverage } from "./requirements";

export interface RuleDefLite { key: string; label: string; min?: number; max?: number; of?: number; scope?: string; notes?: string; categories?: string[] }
export type LineVerdict = "confirmed" | "possible" | "unknown" | "none";
export interface RuleLine { key: string; label: string; required: true; verdict: LineVerdict; detail: string }

const hasFirstScrub = (role: string | null) => !!role && /first\s*scrub/i.test(role);

/** Categories the set says need service-line confirmation (never inferred from a generic asset). */
export function serviceLineCategories(rules: RuleDefLite[]): string[] {
  return rules.filter((r) => r.key === "service-line-confirmation").flatMap((r) => r.categories ?? []);
}

/** The rule lines for a case-log set, scored against item coverage. `studentsPerYear` sizes the volume rule
 *  (0 or unknown → the line is unknown). */
export function caseRuleLines(rules: RuleDefLite[], coverage: CategoryCoverage<ReqItemLite>[], studentsPerYear: number | null): RuleLine[] {
  const items: ItemCoverage[] = coverage.flatMap((c) => c.itemCoverage);
  const general = items.filter((i) => /general surgery/i.test(i.item.category));
  const specialty = items.filter((i) => i.item.electiveGroup === "specialty");
  const lines: RuleLine[] = [];
  const r = (k: string) => rules.find((x) => x.key === k);

  const gfs = r("general-fs");
  if (gfs) {
    const confirmed = general.some((i) => i.providers.secured.some((p) => p.basis === "verified" && p.status !== "possible" && hasFirstScrub(p.studentRole)));
    const any = general.some((i) => i.providers.secured.length > 0);
    lines.push({ key: gfs.key, label: `${gfs.label} — a secured site lets students first-scrub general cases`, required: true, verdict: confirmed ? "confirmed" : any ? "possible" : "none", detail: confirmed ? "a secured site confirmed the First Scrub role for General Surgery" : any ? "a secured site has an OR, but no site has confirmed that students may First Scrub general cases here" : "no secured site provides General Surgery cases" });
  }
  const spread = r("specialty-spread");
  if (spread) {
    const need = spread.min ?? 4;
    const confirmedCats = new Set(specialty.filter((i) => i.providers.secured.some((p) => p.basis === "verified" && p.status !== "possible" && hasFirstScrub(p.studentRole))).map((i) => i.item.category));
    const anyCats = new Set(specialty.filter((i) => i.providers.secured.length > 0).map((i) => i.item.category));
    const verdict: LineVerdict = confirmedCats.size >= need ? "confirmed" : anyCats.size >= need ? "possible" : "none";
    lines.push({ key: spread.key, label: `${spread.label} — ${need} specialties confirmed for First Scrub at secured sites`, required: true, verdict, detail: `${confirmedCats.size} of ${need} specialties confirmed for First Scrub${anyCats.size > confirmedCats.size ? `; ${anyCats.size - confirmedCats.size} more only inferred or possible` : ""}` });
  }
  const total = r("total");
  if (total) {
    const need = total.min ?? 120;
    const vols = items.flatMap((i) => i.providers.secured.filter((p) => p.basis === "verified" && p.status !== "possible" && p.annualVolume != null).map((p) => p.annualVolume as number));
    const known = vols.reduce((n, v) => n + v, 0);
    if (!studentsPerYear || studentsPerYear <= 0) lines.push({ key: total.key, label: `${total.label} — ${need} per student a year at secured sites`, required: true, verdict: "unknown", detail: "how many students need cases this year is not known" });
    else if (!vols.length) lines.push({ key: total.key, label: `${total.label} — ${need} per student a year at secured sites`, required: true, verdict: "unknown", detail: `no secured site has a confirmed annual case volume on record (need ${need * studentsPerYear} cases for ${studentsPerYear} students)` });
    else lines.push({ key: total.key, label: `${total.label} — ${need} per student a year at secured sites`, required: true, verdict: known >= need * studentsPerYear ? "confirmed" : "none", detail: `${known} confirmed cases a year at secured sites vs ${need * studentsPerYear} needed for ${studentsPerYear} students` });
  }
  return lines;
}
