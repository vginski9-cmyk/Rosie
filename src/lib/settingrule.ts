// SETTING RULES — the explicit logic behind "which clinical settings satisfy this requirement".
//
// A rotation's wording ("Acute MedSurg or LTC", "Acute & LTC", "60 hours, at least 20 in the OR")
// used to collapse to ONE asset setting code, so every downstream reader (scheduler, capacity,
// coverage) planned as if only the first setting counted. A setting rule is a bounded, declarative
// structure — five shapes, no nesting, no expressions — validated on the server, read by one
// allocator, and described back to the reader in plain words. AI or a lexical alias may PROPOSE
// a rule; only a reviewed rule is used for planning, and a proposed one reads "needs review".
//
// Quantities are in the requirement's unit (hours unless the requirement says otherwise) and are
// the obligation ONCE: "60 hours, at least 20 in A, remainder A or B" is 60 total, not 80.

import { SETTING_PRESETS } from "./settingPresets";

export type Mixing = "allowed" | "forbidden" | "unknown";
export type Continuity = "one-site" | "none" | "unknown";
export type RuleScope = "learner" | "group" | "rotation" | "session" | "offering";

export type SettingRule =
  /** "A only" — no substitution. */
  | { kind: "only"; setting: string }
  /** "A or B" — eligible alternatives; the obligation is satisfied once through any of them. */
  | { kind: "any-of"; settings: string[] }
  /** "A and B" — every component required; each component's quantity must be known before completion can be claimed (null = not yet known). */
  | { kind: "all-of"; components: { setting: string; quantity: number | null }[] }
  /** "60 hours, at least 20 in A, remainder A or B" — one pool with per-setting minimums inside the total. */
  | { kind: "pool"; settings: string[]; minimums: { setting: string; quantity: number }[] }
  /** "Any two of A / B / C" — a required count of DISTINCT settings from the list, each with a minimum exposure (null = not yet known). */
  | { kind: "n-of"; count: number; settings: string[]; minimumEach: number | null };

export type InterpretationStatus = "proposed" | "needs-review" | "reviewed";

/** A rule with the facts around it: how hours may be split, whether the rotation stays at one site, what the source said, and whether a person reviewed the interpretation. */
export interface SettingRuleSpec {
  rule: SettingRule;
  /** May one learner's obligation be split across the eligible settings? Unknown until the program says. */
  mixing: Mixing;
  /** Must the rotation stay at one site? A continuity constraint, never a setting synonym. */
  continuity: Continuity;
  scope: RuleScope;
  /** The original wording, kept verbatim. */
  sourceText: string | null;
  status: InterpretationStatus;
  /** Open questions a reviewer must answer before the rule is "reviewed" (e.g. "is LTC an approved substitute?"). */
  questions: string[];
}

export const KNOWN_SETTINGS = new Set(SETTING_PRESETS.map((p) => p[0]));

export interface RuleError { path: string; message: string }

const isCode = (s: unknown): s is string => typeof s === "string" && /^[A-Z][A-Z0-9_]{0,11}$/.test(s);
const nonNeg = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0;

/** Validate a rule against the settings that exist (the presets plus any the institution's assets carry). Returns every problem; an empty list means valid. */
export function validateSettingRule(rule: unknown, knownSettings: Set<string> = KNOWN_SETTINGS, total: number | null = null): RuleError[] {
  const errs: RuleError[] = [];
  if (!rule || typeof rule !== "object") return [{ path: "", message: "a rule must be an object" }];
  const r = rule as Record<string, unknown>;
  const kinds = ["only", "any-of", "all-of", "pool", "n-of"];
  if (!kinds.includes(String(r.kind))) return [{ path: "kind", message: `unsupported rule kind "${String(r.kind)}" — one of ${kinds.join(", ")}` }];
  const checkSetting = (s: unknown, path: string) => { if (!isCode(s)) errs.push({ path, message: "a setting code is upper-case letters and digits" }); else if (!knownSettings.has(s)) errs.push({ path, message: `unrecognized setting "${s}"` }); };
  const list = (v: unknown, path: string, min = 1): string[] => { if (!Array.isArray(v) || v.length < min) { errs.push({ path, message: `needs at least ${min} setting${min === 1 ? "" : "s"}` }); return []; } v.forEach((s, i) => checkSetting(s, `${path}[${i}]`)); if (new Set(v).size !== v.length) errs.push({ path, message: "a setting is listed twice" }); return v.filter(isCode); };
  switch (r.kind) {
    case "only": checkSetting(r.setting, "setting"); break;
    case "any-of": list(r.settings, "settings", 2); break;
    case "all-of": {
      if (!Array.isArray(r.components) || r.components.length < 2) { errs.push({ path: "components", message: "needs at least 2 components" }); break; }
      const seen = new Set<string>(); let sum = 0, known = true;
      r.components.forEach((c, i) => {
        const cc = (c ?? {}) as Record<string, unknown>;
        checkSetting(cc.setting, `components[${i}].setting`);
        if (typeof cc.setting === "string") { if (seen.has(cc.setting)) errs.push({ path: `components[${i}].setting`, message: "a setting is listed twice" }); seen.add(cc.setting); }
        if (cc.quantity == null) known = false; else if (!nonNeg(cc.quantity)) errs.push({ path: `components[${i}].quantity`, message: "a quantity is zero or more" }); else sum += cc.quantity as number;
      });
      if (known && total != null && sum > total) errs.push({ path: "components", message: `component quantities (${sum}) exceed the total (${total})` });
      break;
    }
    case "pool": {
      const settings = list(r.settings, "settings", 1);
      if (!Array.isArray(r.minimums)) { errs.push({ path: "minimums", message: "minimums must be a list (may be empty)" }); break; }
      const seen = new Set<string>(); let sum = 0;
      r.minimums.forEach((m, i) => {
        const mm = (m ?? {}) as Record<string, unknown>;
        checkSetting(mm.setting, `minimums[${i}].setting`);
        if (typeof mm.setting === "string" && settings.length && !settings.includes(mm.setting)) errs.push({ path: `minimums[${i}].setting`, message: "a minimum names a setting outside the pool" });
        if (typeof mm.setting === "string") { if (seen.has(mm.setting)) errs.push({ path: `minimums[${i}].setting`, message: "a setting has two minimums" }); seen.add(mm.setting); }
        if (!nonNeg(mm.quantity)) errs.push({ path: `minimums[${i}].quantity`, message: "a minimum is zero or more" }); else sum += mm.quantity as number;
      });
      if (total != null && sum > total) errs.push({ path: "minimums", message: `the minimums (${sum}) exceed the total (${total}) — a minimum sits inside the total, it is not added to it` });
      break;
    }
    case "n-of": {
      const settings = list(r.settings, "settings", 2);
      if (!Number.isInteger(r.count) || (r.count as number) < 1) errs.push({ path: "count", message: "count is a whole number of at least 1" });
      else if (settings.length && (r.count as number) > settings.length) errs.push({ path: "count", message: `cannot require ${r.count} distinct settings from ${settings.length}` });
      if (r.minimumEach != null && !nonNeg(r.minimumEach)) errs.push({ path: "minimumEach", message: "the minimum per setting is zero or more" });
      if (r.minimumEach != null && total != null && Number.isInteger(r.count) && (r.count as number) * (r.minimumEach as number) > total) errs.push({ path: "minimumEach", message: `${r.count} × ${r.minimumEach} exceeds the total (${total})` });
      break;
    }
  }
  return errs;
}

/** Parse a stored JSON rule spec; a bad or missing value is null (never a silently invented rule). */
export function parseRuleSpec(json: string | null | undefined): SettingRuleSpec | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Partial<SettingRuleSpec>;
    if (!v || typeof v !== "object" || !v.rule) return null;
    return {
      rule: v.rule as SettingRule,
      mixing: v.mixing === "allowed" || v.mixing === "forbidden" ? v.mixing : "unknown",
      continuity: v.continuity === "one-site" || v.continuity === "none" ? v.continuity : "unknown",
      scope: (["learner", "group", "rotation", "session", "offering"] as RuleScope[]).includes(v.scope as RuleScope) ? (v.scope as RuleScope) : "learner",
      sourceText: typeof v.sourceText === "string" ? v.sourceText : null,
      status: v.status === "reviewed" || v.status === "proposed" ? v.status : "needs-review",
      questions: Array.isArray(v.questions) ? v.questions.filter((q): q is string => typeof q === "string") : [],
    };
  } catch { return null; }
}
export const ruleSpecJson = (spec: SettingRuleSpec) => JSON.stringify(spec);

/** Every setting the rule can ever draw on. */
export function eligibleSettings(rule: SettingRule): string[] {
  switch (rule.kind) {
    case "only": return [rule.setting];
    case "any-of": return [...rule.settings];
    case "all-of": return rule.components.map((c) => c.setting);
    case "pool": return [...rule.settings];
    case "n-of": return [...rule.settings];
  }
}
export const settingEligible = (rule: SettingRule, setting: string) => eligibleSettings(rule).includes(setting);

/** Per-setting minimum exposures the rule fixes (a component of "and", a minimum inside a pool). Unknown quantities are omitted — see `unresolvedQuantities`. */
export function minimumsOf(rule: SettingRule): { setting: string; quantity: number }[] {
  switch (rule.kind) {
    case "all-of": return rule.components.filter((c): c is { setting: string; quantity: number } => c.quantity != null);
    case "pool": return [...rule.minimums];
    default: return [];
  }
}
/** Which parts of the rule still need a number before completion can be judged. */
export function unresolvedQuantities(rule: SettingRule): string[] {
  if (rule.kind === "all-of") return rule.components.filter((c) => c.quantity == null).map((c) => `quantity required in ${c.setting}`);
  if (rule.kind === "n-of" && rule.minimumEach == null) return [`minimum exposure in each of the ${rule.count} settings`];
  return [];
}

/** The rule in words: "medical-surgical OR long-term care", "at least 20 in OR, the rest in OR or AMB". */
export function describeRule(rule: SettingRule, name: (code: string) => string = (c) => c): string {
  switch (rule.kind) {
    case "only": return `${name(rule.setting)} only`;
    case "any-of": return rule.settings.map(name).join(" OR ");
    case "all-of": return rule.components.map((c) => `${name(c.setting)}${c.quantity != null ? ` (${c.quantity})` : " (quantity to confirm)"}`).join(" AND ");
    case "pool": { const mins = rule.minimums.map((m) => `at least ${m.quantity} in ${name(m.setting)}`); return `${mins.length ? mins.join(", ") + ", " : ""}${mins.length ? "the rest " : ""}in ${rule.settings.map(name).join(" or ")}`; }
    case "n-of": return `any ${rule.count} of ${rule.settings.map(name).join(" / ")}${rule.minimumEach != null ? ` (at least ${rule.minimumEach} each)` : " (exposure per setting to confirm)"}`;
  }
}
/** The questions a reviewer must answer before this spec can be used for planning without caveats. */
export function openQuestions(spec: SettingRuleSpec): string[] {
  const qs = [...spec.questions];
  const alternatives = spec.rule.kind === "any-of" || spec.rule.kind === "pool" || spec.rule.kind === "n-of";
  if (alternatives && spec.mixing === "unknown") qs.push("May one learner's hours be split across the eligible settings, or must the whole obligation sit in one?");
  if (spec.continuity === "unknown") qs.push("Must the rotation stay at one site?");
  for (const u of unresolvedQuantities(spec.rule)) qs.push(`What is the ${u}?`);
  if (spec.status !== "reviewed") qs.push("Has the program confirmed this interpretation against its approved requirements?");
  return [...new Set(qs)];
}

// ── Allocation: the obligation, once, against what each setting can offer ─────────────────────────────

export interface AllocationResult {
  /** yes = the whole obligation fits under the rule; no = it provably cannot; unknown = the rule is not defined enough to say. */
  feasible: "yes" | "no" | "unknown";
  /** How much of the obligation each setting would carry (only when feasible). */
  allocation: Record<string, number>;
  /** What stopped or limits it, as reason codes the evaluation service shares. */
  reasons: { code: "REQUIREMENT_UNRESOLVED" | "SETTING_INELIGIBLE" | "SETTING_MINIMUM_UNMET" | "CAPACITY_EXHAUSTED" | "MIXING_FORBIDDEN"; detail: string }[];
  /** Total allocated (never more than the obligation). */
  total: number;
}

/** Allocate ONE obligation of `total` units against the units each setting can supply, honouring the rule:
 *  minimums first, then the remainder anywhere eligible; a forbidden mix keeps the whole obligation in one setting;
 *  "and" components each get their own quantity; "any N of" wants N distinct settings at their minimum. */
export function allocateObligation(spec: Pick<SettingRuleSpec, "rule" | "mixing">, total: number, supply: Record<string, number>): AllocationResult {
  const rule = spec.rule;
  const reasons: AllocationResult["reasons"] = [];
  const avail = (s: string) => Math.max(0, supply[s] ?? 0);
  const none = (feasible: "no" | "unknown", code: AllocationResult["reasons"][number]["code"], detail: string): AllocationResult => ({ feasible, allocation: {}, reasons: [...reasons, { code, detail }], total: 0 });
  if (!(total > 0)) return { feasible: "yes", allocation: {}, reasons, total: 0 };
  const unresolved = unresolvedQuantities(rule);
  if (unresolved.length) return none("unknown", "REQUIREMENT_UNRESOLVED", `not defined enough to allocate: ${unresolved.join("; ")}`);
  const eligible = eligibleSettings(rule);
  const offered = Object.keys(supply).filter((s) => avail(s) > 0);
  if (offered.length && !offered.some((s) => eligible.includes(s))) reasons.push({ code: "SETTING_INELIGIBLE", detail: `${offered.join(", ")} not eligible — the rule allows ${eligible.join(", ")}` });

  // 1. Components / minimums.
  const alloc: Record<string, number> = {};
  const take = (s: string, q: number) => { const got = Math.min(q, avail(s) - (alloc[s] ?? 0)); if (got > 0) alloc[s] = (alloc[s] ?? 0) + got; return got; };
  if (rule.kind === "only") {
    const got = take(rule.setting, total);
    if (got < total) return none("no", "CAPACITY_EXHAUSTED", `${rule.setting} offers ${avail(rule.setting)} of the ${total} required and no substitute is allowed`);
    return { feasible: "yes", allocation: alloc, reasons, total: got };
  }
  if (rule.kind === "all-of") {
    for (const c of rule.components) {
      const need = c.quantity ?? 0; const got = take(c.setting, need);
      if (got < need) return none("no", "SETTING_MINIMUM_UNMET", `${c.setting} needs ${need}, ${avail(c.setting)} offered`);
    }
    const sum = Object.values(alloc).reduce((n, v) => n + v, 0);
    const rest = total - sum;
    if (rest > 0) { let left = rest; for (const c of rule.components) { if (left <= 0) break; left -= take(c.setting, left); } if (left > 0) return none("no", "CAPACITY_EXHAUSTED", `${left} of the ${total} cannot be placed in ${eligible.join(" / ")}`); }
    return { feasible: "yes", allocation: alloc, reasons, total };
  }
  if (rule.kind === "n-of") {
    const each = rule.minimumEach ?? 0;
    const ok = rule.settings.filter((s) => avail(s) >= each && (each > 0 || avail(s) > 0));
    if (ok.length < rule.count) return none("no", "SETTING_MINIMUM_UNMET", `only ${ok.length} of the ${rule.count} required distinct settings offer at least ${each}: ${ok.join(", ") || "none"}`);
    const chosen = ok.sort((a, b) => avail(b) - avail(a)).slice(0, rule.count);
    for (const s of chosen) take(s, each);
    let left = total - Object.values(alloc).reduce((n, v) => n + v, 0);
    for (const s of chosen) { if (left <= 0) break; left -= take(s, left); }
    if (spec.mixing !== "forbidden") for (const s of rule.settings) { if (left <= 0) break; left -= take(s, left); }
    if (left > 0) return none("no", "CAPACITY_EXHAUSTED", `${left} of the ${total} cannot be placed`);
    return { feasible: "yes", allocation: alloc, reasons, total };
  }
  // any-of and pool
  const settings = rule.kind === "pool" ? rule.settings : rule.settings;
  const mins = rule.kind === "pool" ? rule.minimums : [];
  if (spec.mixing === "forbidden" || (spec.mixing === "unknown" && rule.kind === "any-of")) {
    // The whole obligation in ONE setting (unknown mixing is treated as not permitted until answered — and said so).
    const fit = settings.filter((s) => avail(s) >= total && mins.every((m) => m.setting === s || m.quantity === 0));
    if (fit.length) { const s = fit.sort((a, b) => avail(b) - avail(a))[0]; alloc[s] = total; return { feasible: "yes", allocation: alloc, reasons: spec.mixing === "unknown" ? [...reasons, { code: "MIXING_FORBIDDEN", detail: "placed in one setting: whether hours may be mixed is not yet confirmed" }] : reasons, total }; }
    const best = Math.max(0, ...settings.map(avail));
    if (spec.mixing === "unknown" && settings.reduce((n, s) => n + avail(s), 0) >= total) return none("unknown", "MIXING_FORBIDDEN", `no single setting offers all ${total} (best ${best}); together they do — allowed only if hours may be mixed, which is not yet confirmed`);
    return none("no", "MIXING_FORBIDDEN", `no single setting offers all ${total} (best ${best}) and hours may not be mixed`);
  }
  for (const m of mins) { const got = take(m.setting, m.quantity); if (got < m.quantity) return none("no", "SETTING_MINIMUM_UNMET", `${m.setting} needs at least ${m.quantity}, ${avail(m.setting)} offered`); }
  let left = total - Object.values(alloc).reduce((n, v) => n + v, 0);
  for (const s of [...mins.map((m) => m.setting), ...settings]) { if (left <= 0) break; left -= take(s, left); }
  if (left > 0) return none("no", "CAPACITY_EXHAUSTED", `${left} of the ${total} cannot be placed in ${settings.join(" / ")}`);
  return { feasible: "yes", allocation: alloc, reasons, total };
}

/** Judge exposures already taken (setting → quantity, one entry per seat's OWN setting — a multi-tagged site never credits two settings for one hour) against the rule. */
export function judgeExposure(spec: Pick<SettingRuleSpec, "rule" | "mixing" | "continuity">, total: number, exposure: Record<string, number>, sitesUsed = 1): { status: "met" | "unmet" | "unknown"; reasons: { code: "REQUIREMENT_UNRESOLVED" | "SETTING_INELIGIBLE" | "SETTING_MINIMUM_UNMET" | "MIXING_FORBIDDEN" | "CONTINUITY_UNMET" | "SHORT"; detail: string }[]; credited: number } {
  const rule = spec.rule; const reasons: ReturnType<typeof judgeExposure>["reasons"] = [];
  const eligible = eligibleSettings(rule);
  let credited = 0;
  for (const [s, q] of Object.entries(exposure)) { if (eligible.includes(s)) credited += q; else if (q > 0) reasons.push({ code: "SETTING_INELIGIBLE", detail: `${q} in ${s} does not count — the rule allows ${eligible.join(", ")}` }); }
  const unresolved = unresolvedQuantities(rule);
  if (unresolved.length) return { status: "unknown", reasons: [...reasons, { code: "REQUIREMENT_UNRESOLVED", detail: unresolved.join("; ") }], credited };
  for (const m of minimumsOf(rule)) if ((exposure[m.setting] ?? 0) < m.quantity) reasons.push({ code: "SETTING_MINIMUM_UNMET", detail: `${m.setting}: ${exposure[m.setting] ?? 0} of at least ${m.quantity}` });
  if (rule.kind === "n-of") { const each = rule.minimumEach ?? 0; const distinct = rule.settings.filter((s) => (exposure[s] ?? 0) >= Math.max(each, Number.EPSILON)); if (distinct.length < rule.count) reasons.push({ code: "SETTING_MINIMUM_UNMET", detail: `${distinct.length} of ${rule.count} distinct settings reached ${each}` }); }
  const used = eligible.filter((s) => (exposure[s] ?? 0) > 0);
  if (used.length > 1 && (rule.kind === "any-of" || rule.kind === "pool" || rule.kind === "n-of")) {
    if (spec.mixing === "forbidden") reasons.push({ code: "MIXING_FORBIDDEN", detail: `hours sit in ${used.join(" and ")} but may not be mixed` });
    else if (spec.mixing === "unknown") reasons.push({ code: "MIXING_FORBIDDEN", detail: `hours sit in ${used.join(" and ")}; whether they may be mixed is not confirmed` });
  }
  if (spec.continuity === "one-site" && sitesUsed > 1) reasons.push({ code: "CONTINUITY_UNMET", detail: `spread over ${sitesUsed} sites; the rotation must stay at one` });
  if (credited < total) reasons.push({ code: "SHORT", detail: `${credited} of ${total} credited` });
  const unknown = reasons.some((r) => r.code === "MIXING_FORBIDDEN" && spec.mixing === "unknown");
  const hard = reasons.some((r) => r.code !== "MIXING_FORBIDDEN" || spec.mixing === "forbidden");
  return { status: hard ? "unmet" : unknown ? "unknown" : "met", reasons, credited };
}

// ── Lexical proposals: a phrase suggests a rule; it never settles one ─────────────────────────────────

/** Words that find a setting. Matching is lexical help only: it never establishes that one setting may substitute for another. */
const ALIASES: [RegExp, string][] = [
  [/\b(med[- ]?surg|medical[- ]surgical|telemetry|acute(?![- ]?care))\b/i, "BEDS"],
  [/\b(ltc|long[- ]term care|skilled nursing|snf|nursing home)\b/i, "LTC"],
  [/\b(adult care|assisted living|alf)\b/i, "ALF"],
  [/\b(operating room|or suite|\bors?\b|surgery|surgical)\b/i, "ORS"],
  [/\b(c-arm|c arm|operating room)\b/i, "OR"],
  [/\b(icu|critical care|ccu|intensive)\b/i, "ICU"],
  [/\b(emergency|\bed\b|trauma)\b/i, "ED"],
  [/\b(pediatric|peds)\b/i, "PEDS"],
  [/\b(behavioral|psych|mental health)\b/i, "BH"],
  [/\b(clinic|physician office|doctor'?s office|ambulatory|outpatient)\b/i, "AMB"],
  [/\b(home health)\b/i, "HH"],
  [/\b(hospice|palliative)\b/i, "HOSP"],
  [/\b(public health|community health|community)\b/i, "PH"],
  [/\b(general (diagnostic )?radiograph|radiographic room|\bgen\b|chest|bone)\b/i, "GEN"],
  [/\b(fluoro|fluoroscopy|r&f)\b/i, "FLUORO"],
  [/\b(portable|mobile)\b/i, "PORT"],
  [/\b(computed tomography|\bct\b)\b/i, "CT"],
  [/\b(mri|magnetic)\b/i, "MRI"],
  [/\b(endoscopy|\bgi\b)\b/i, "ENDO"],
  [/\b(rehab|physical therapy|occupational therapy)\b/i, "REHAB"],
  [/\b(dialysis)\b/i, "DIAL"],
];

/** Propose a rule from a phrase. "A or B" / "A / B" → alternatives (mixing unknown); "A and B" / "A & B" → components with unknown quantities; one setting → only. Always `proposed` and never reviewed here. */
export function proposeRuleFromText(text: string, knownSettings: Set<string> = KNOWN_SETTINGS, prefer: Set<string> = new Set()): SettingRuleSpec | null {
  const t = text.trim();
  if (!t) return null;
  // "Operating room" is the OR suite (ORS, surgical technology) or the C-arm setting (OR, radiography): the caller's context decides.
  const SIBLINGS: Record<string, string> = { OR: "ORS", ORS: "OR" };
  const pickSibling = (codes: string[]) => { const both = codes.filter((c) => SIBLINGS[c] && codes.includes(SIBLINGS[c])); if (both.length !== 2) return codes; const keep = both.find((c) => prefer.has(c)) ?? "ORS"; return codes.filter((c) => c === keep || !both.includes(c)); };
  const parts = t.split(/\s*(?:\bor\b|\/)\s*/i);
  const andParts = t.split(/\s*(?:\band\b|&|\+)\s*/i);
  const codesOf = (s: string) => { const out: string[] = []; for (const [re, code] of ALIASES) if (re.test(s) && knownSettings.has(code) && !out.includes(code)) out.push(code); return pickSibling(out); };
  const questions: string[] = [];
  // "Chest & Bone", "Trauma / Emergency": every part names the SAME setting — one setting, not a compound rule.
  const sameSetting = (ps: string[]) => ps.length > 1 && ps.every((p) => codesOf(p).length === 1) && new Set(ps.map((p) => codesOf(p)[0])).size === 1;
  if (sameSetting(parts) || sameSetting(andParts)) { const code = codesOf(t)[0]; return { rule: { kind: "only", setting: code }, mixing: "allowed", continuity: "unknown", scope: "learner", sourceText: t, status: "proposed", questions: [`"${t}" reads as one setting (${code}) — confirm.`] }; }
  if (parts.length > 1 && parts.every((p) => codesOf(p).length === 1)) {
    const settings = parts.map((p) => codesOf(p)[0]);
    questions.push(`"${t}" reads as alternatives (${settings.join(" or ")}): is each an approved substitute for the others?`);
    return { rule: { kind: "any-of", settings }, mixing: "unknown", continuity: "unknown", scope: "learner", sourceText: t, status: "proposed", questions };
  }
  if (andParts.length > 1 && andParts.every((p) => codesOf(p).length === 1)) {
    const settings = andParts.map((p) => codesOf(p)[0]);
    questions.push(`"${t}" reads as both required (${settings.join(" and ")}): how much exposure is required in each?`);
    return { rule: { kind: "all-of", components: settings.map((setting) => ({ setting, quantity: null })) }, mixing: "allowed", continuity: "unknown", scope: "learner", sourceText: t, status: "proposed", questions };
  }
  const all = codesOf(t);
  if (all.length === 1) return { rule: { kind: "only", setting: all[0] }, mixing: "allowed", continuity: "unknown", scope: "learner", sourceText: t, status: "proposed", questions: [`"${t}" reads as ${all[0]} only — confirm no other setting is accepted.`] };
  if (all.length > 1) return { rule: { kind: "any-of", settings: all }, mixing: "unknown", continuity: "unknown", scope: "learner", sourceText: t, status: "needs-review", questions: [`"${t}" names ${all.join(", ")} without saying whether they are alternatives or all required.`] };
  return null;
}

/** A legacy single setting code as a reviewed "only" rule (the migration's deterministic case). */
export const onlyRule = (setting: string, sourceText: string | null = null, status: InterpretationStatus = "reviewed"): SettingRuleSpec => ({ rule: { kind: "only", setting }, mixing: "allowed", continuity: "unknown", scope: "learner", sourceText, status, questions: [] });

/** The rule a legacy rotation row means: a stored rule wins; else plain wording with one code is a reviewed "only";
 *  compound wording ("A or B", "A & B", "A / B") is a PROPOSED rule that needs review — never silently its first setting. */
export const COMPOUND_WORDING = /\b(or|and)\b|[\/&+]/i;
export function ruleFromLegacy(r: { rotationType: string; settingCode: string | null; rule?: string | null; sourceText?: string | null; interpretationStatus?: string | null }, known: Set<string> = KNOWN_SETTINGS): SettingRuleSpec | null {
  const stored = parseRuleSpec(r.rule);
  if (stored) return { ...stored, status: r.interpretationStatus === "reviewed" ? "reviewed" : stored.status === "reviewed" ? "needs-review" : stored.status };
  const wording = r.sourceText ?? r.rotationType;
  if (COMPOUND_WORDING.test(wording)) {
    const proposed = proposeRuleFromText(wording, known, new Set(r.settingCode ? [r.settingCode] : []));
    if (proposed) {
      if (r.settingCode && !eligibleSettings(proposed.rule).includes(r.settingCode)) proposed.questions.push(`The stored mapping says ${r.settingCode}; the wording names ${eligibleSettings(proposed.rule).join(", ")}.`);
      return { ...proposed, status: "needs-review" };
    }
    if (r.settingCode) return { ...onlyRule(r.settingCode, wording, "needs-review"), questions: [`"${wording}" reads as compound; only ${r.settingCode} is mapped — confirm whether other settings are accepted.`] };
    return null;
  }
  if (r.settingCode) return onlyRule(r.settingCode, wording, r.interpretationStatus === "proposed" ? "proposed" : "reviewed");
  return null;
}
