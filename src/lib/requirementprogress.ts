// Progress against a credentialing body's requirement set — pure, unit-tested.
//
// Competency sets (ARRT): an item is met by one logged experience that reached
// competency; the rules count mandatory imaging procedures, electives (with the
// Head and Fluoroscopy minimums and the "one must be an upper GI or contrast enema"
// condition), general patient-care procedures, and simulations against the cap.
//
// Case sets (CAAHEP / ARC-STSA, CCST-7e): cases are counted by specialty and role.
// First Scrub always counts; Second Scrub counts up to the maximum the body allows
// (40 of the 120), with diagnostic endoscopy capped at 10 and vaginal delivery at 5
// among them; Observation is documented and never counted. Specialty First Scrub
// needs at least 10 in each of four specialties.

import type { ReqItemLite } from "./requirements";

export interface RuleDef { key: string; label: string; min?: number; max?: number; of?: number; scope?: string; anyOf?: string[]; notes?: string }
export interface LogLite { itemId: string; outcome: string; role: string | null; simulated: boolean; count: number; date: string; employerId?: string | null }
export interface RuleResult { key: string; label: string; have: number; min: number | null; max: number | null; of: number | null; ok: boolean; note: string | null }
export interface ItemState<T extends ReqItemLite = ReqItemLite> { item: T; met: boolean; attempts: number; cases: { fs: number; ss: number; obs: number }; simulated: boolean; lastDate: string | null; sites: string[] }
export interface Progress<T extends ReqItemLite = ReqItemLite> { kind: "competency" | "cases"; rules: RuleResult[]; items: ItemState<T>[]; complete: boolean; pct: number; missingRequired: T[]; missingElective: T[] }

const csv = (v: string | null | undefined) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().trim();

/** A tiny scope language: `category == X`, `category != X`, `mandatory`, `!mandatory`, `electiveGroup == g`, joined by `&&`. */
export function inScope(item: ReqItemLite, scope: string | undefined): boolean {
  if (!scope || scope === "all") return true;
  return scope.split("&&").map((x) => x.trim()).every((clause) => {
    let m: RegExpMatchArray | null;
    if ((m = clause.match(/^category\s*==\s*(.+)$/))) return norm(item.category) === norm(m[1]);
    if ((m = clause.match(/^category\s*!=\s*(.+)$/))) return norm(item.category) !== norm(m[1]);
    if ((m = clause.match(/^electiveGroup\s*==\s*(.+)$/))) return norm(item.electiveGroup) === norm(m[1]);
    if (clause === "mandatory") return item.mandatory;
    if (clause === "!mandatory") return !item.mandatory;
    return true; // unknown clauses (role ==, simulated) are handled by the kind-specific logic
  });
}

export function itemStates<T extends ReqItemLite>(items: T[], logs: LogLite[]): ItemState<T>[] {
  return items.map((item) => {
    const mine = logs.filter((l) => l.itemId === item.id);
    const cases = { fs: 0, ss: 0, obs: 0 };
    for (const l of mine) { const r = norm(l.role); if (r === "first scrub") cases.fs += l.count; else if (r === "second scrub") cases.ss += l.count; else if (r === "observation" || r === "observe") cases.obs += l.count; }
    const met = mine.some((l) => norm(l.outcome) === "competent" && norm(l.role) !== "observation" && norm(l.role) !== "observe");
    const dates = mine.map((l) => l.date).sort();
    return { item, met, attempts: mine.length, cases, simulated: mine.some((l) => l.simulated && norm(l.outcome) === "competent"), lastDate: dates[dates.length - 1] ?? null, sites: [...new Set(mine.map((l) => l.employerId).filter((x): x is string => !!x))] };
  });
}

export function competencyProgress<T extends ReqItemLite>(items: T[], rules: RuleDef[], logs: LogLite[]): Progress<T> {
  const states = itemStates(items, logs);
  const metIds = new Set(states.filter((s) => s.met).map((s) => s.item.id));
  const results: RuleResult[] = rules.map((r) => {
    if (r.key === "simulation" || r.scope === "simulated") {
      const have = states.filter((s) => s.met && s.simulated).length;
      return { key: r.key, label: r.label, have, min: null, max: r.max ?? null, of: null, ok: r.max == null || have <= r.max, note: r.notes ?? null };
    }
    if (r.min == null) return { key: r.key, label: r.label, have: 0, min: null, max: null, of: null, ok: true, note: r.notes ?? null };
    const pool = items.filter((i) => inScope(i, r.scope));
    const have = pool.filter((i) => metIds.has(i.id)).length;
    let ok = have >= r.min;
    let note: string | null = r.notes ?? null;
    if (r.anyOf?.length) { const anyMet = pool.some((i) => metIds.has(i.id) && r.anyOf!.some((n) => i.name.toLowerCase().includes(n.toLowerCase()))); if (!anyMet) { ok = false; note = `needs one of: ${r.anyOf.join(" / ")}`; } }
    return { key: r.key, label: r.label, have, min: r.min, max: null, of: r.of ?? pool.length, ok, note };
  });
  const counted = results.filter((r) => r.min != null);
  const pct = counted.length ? counted.reduce((n, r) => n + Math.min(1, r.have / Math.max(1, r.min!)), 0) / counted.length : 0;
  return { kind: "competency", rules: results, items: states, complete: results.every((r) => r.ok), pct, missingRequired: states.filter((s) => s.item.mandatory && !s.met).map((s) => s.item), missingElective: states.filter((s) => !s.item.mandatory && !s.met).map((s) => s.item) };
}

export function caseProgress<T extends ReqItemLite>(items: T[], rules: RuleDef[], logs: LogLite[]): Progress<T> {
  const states = itemStates(items, logs);
  const isGeneral = (i: ReqItemLite) => /general surgery/i.test(i.category);
  const isEndo = (i: ReqItemLite) => /endoscop/i.test(i.category), isVag = (i: ReqItemLite) => /vaginal/i.test(i.category);
  const r = (k: string) => rules.find((x) => x.key === k);
  const genFs = states.filter((s) => isGeneral(s.item)).reduce((n, s) => n + s.cases.fs, 0);
  const genSs = states.filter((s) => isGeneral(s.item)).reduce((n, s) => n + s.cases.ss, 0);
  const specs = states.filter((s) => !isGeneral(s.item) && !isEndo(s.item) && !isVag(s.item));
  const specFs = specs.reduce((n, s) => n + s.cases.fs, 0);
  const specSs = specs.reduce((n, s) => n + s.cases.ss, 0);
  const endoSs = Math.min(10, states.filter((s) => isEndo(s.item)).reduce((n, s) => n + s.cases.ss + s.cases.fs, 0));
  const vagSs = Math.min(5, states.filter((s) => isVag(s.item)).reduce((n, s) => n + s.cases.ss + s.cases.fs, 0));
  const ssMax = r("second-scrub-max")?.max ?? 40;
  const ssCounted = Math.min(ssMax, genSs + specSs + endoSs + vagSs);
  const spread = specs.filter((s) => s.cases.fs >= 10).length;
  const specFsCounted = Math.min(specFs, 40 + Math.max(0, specFs - specs.reduce((n, s) => n + Math.min(10, s.cases.fs), 0)));
  const obs = states.reduce((n, s) => n + s.cases.obs, 0);
  const total = genFs + specFs + ssCounted;
  const results: RuleResult[] = [];
  const push = (key: string, label: string, have: number, min: number | null, max: number | null, ok: boolean, note: string | null) => results.push({ key, label, have, min, max, of: null, ok, note });
  push("total", r("total")?.label ?? "Total surgical cases", total, r("total")?.min ?? 120, null, total >= (r("total")?.min ?? 120), obs ? `${obs} observation case${obs === 1 ? "" : "s"} documented, not counted` : null);
  push("general", r("general")?.label ?? "General Surgery cases", genFs + Math.min(genSs, 10), r("general")?.min ?? 30, null, genFs + Math.min(genSs, 10) >= (r("general")?.min ?? 30), null);
  push("general-fs", r("general-fs")?.label ?? "General Surgery — First Scrub", genFs, r("general-fs")?.min ?? 20, null, genFs >= (r("general-fs")?.min ?? 20), null);
  push("specialty", r("specialty")?.label ?? "Specialty cases", specFs + Math.min(specSs + endoSs + vagSs, 30), r("specialty")?.min ?? 90, null, specFs + Math.min(specSs + endoSs + vagSs, 30) >= (r("specialty")?.min ?? 90), null);
  push("specialty-fs", r("specialty-fs")?.label ?? "Specialty — First Scrub", specFsCounted, r("specialty-fs")?.min ?? 60, null, specFsCounted >= (r("specialty-fs")?.min ?? 60) && spread >= (r("specialty-spread")?.min ?? 4), spread < (r("specialty-spread")?.min ?? 4) ? `only ${spread} specialt${spread === 1 ? "y has" : "ies have"} 10+ First Scrub cases` : null);
  push("specialty-spread", r("specialty-spread")?.label ?? "Specialties with ≥ 10 First Scrub cases", spread, r("specialty-spread")?.min ?? 4, null, spread >= (r("specialty-spread")?.min ?? 4), specs.filter((s) => s.cases.fs > 0 && s.cases.fs < 10).map((s) => `${s.item.category} ${s.cases.fs}`).join(", ") || null);
  push("second-scrub-max", r("second-scrub-max")?.label ?? "Second Scrub cases counted", ssCounted, null, ssMax, true, `${genSs + specSs + endoSs + vagSs} logged${endoSs ? ` · endoscopy ${endoSs}` : ""}${vagSs ? ` · vaginal delivery ${vagSs}` : ""}`);
  push("observation", r("observation")?.label ?? "Observation cases", obs, null, null, true, "documented, not counted");
  const counted = results.filter((x) => x.min != null);
  const pct = counted.length ? counted.reduce((n, x) => n + Math.min(1, x.have / Math.max(1, x.min!)), 0) / counted.length : 0;
  return { kind: "cases", rules: results, items: states, complete: results.every((x) => x.ok), pct, missingRequired: states.filter((s) => s.item.mandatory && s.cases.fs + s.cases.ss === 0).map((s) => s.item), missingElective: states.filter((s) => !s.item.mandatory && s.cases.fs + s.cases.ss === 0).map((s) => s.item) };
}

export function progressFor<T extends ReqItemLite>(kind: string, items: T[], rules: RuleDef[], logs: LogLite[]): Progress<T> {
  return kind === "cases" ? caseProgress(items, rules, logs) : competencyProgress(items, rules, logs);
}

/** What a student still needs, by asset setting: the count of unmet required items (and, second, unmet electives)
 *  that each setting can supply — the rotation planner's demand signal for routing a student to the right rooms. */
export function needsBySetting(progress: Progress, electiveWeight = 0.25): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of progress.missingRequired) for (const c of csv(i.settingCodes)) out[c] = (out[c] ?? 0) + 1;
  for (const i of progress.missingElective) for (const c of csv(i.settingCodes)) out[c] = (out[c] ?? 0) + electiveWeight;
  return out;
}
