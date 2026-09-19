// The executive view (Phase 13): the six questions a decision-maker asks, answered from the saved
// scenarios and the workforce targets — not from the operational blocker queue.
//
//   1. Which workforce targets are at risk?           targetsAtRisk()
//   2. What is the expected shortfall?                 per target, from the baseline the engine measured
//   3. Which constraints bind?                         bindingRollup()
//   4. Which interventions are worth the most?         rankInterventions()
//   5. Which evidence gaps weaken the confidence?      evidenceGaps()
//   6. What changed recently that matters?             getExecutiveSummary() reads the change records
//
// The pure functions take plain rows so they can be tested; getExecutiveSummary() and getScenarioHub()
// read the database. A figure that was never measured stays null ("missing ≠ zero").

import { prisma } from "./db";
import { EXPANSION_KINDS, type ExpansionDesign, type ExpansionResult, type ConstraintKind } from "./expansion";
import { getExceptionQueue, type ExceptionItem } from "./exceptions";
import { getCalendarProvenance } from "./queries";
import { provisionalVerdict } from "./evidence";

// ── Rows ───────────────────────────────────────────────────────────────────────────────────────
export interface ScenarioLite {
  id: string; name: string; status: string; notes: string | null;
  programId: string; program: string; institutionId: string; institution: string; familyId: string | null; family: string | null;
  design: ExpansionDesign | null; result: ExpansionResult | null; evaluatedAt: string | null; updatedAt: string;
}
export interface FamilyTarget {
  familyId: string; family: string; job: string; institutionId: string; institution: string;
  programs: { id: string; name: string }[];
  goalsByYear: Record<number, number>;
}

// ── Summaries ──────────────────────────────────────────────────────────────────────────────────
export interface BindingLite { kind: ConstraintKind; label: string; shortfall: number | null; unit: string; where: string | null; fix: string; evidence: "verified" | "estimate" | "unknown" }
export interface ScenarioSummary {
  id: string; name: string; status: string; kindLabel: string;
  programId: string; program: string; institutionId: string; institution: string; familyId: string | null; family: string | null;
  evaluatedAt: string | null; updatedAt: string; evaluated: boolean;
  feasible: boolean | null; feasibleInTime: boolean | null; headline: string | null;
  binding: BindingLite | null;
  targetWorkers: number | null; targetYear: number | null;
  /** Productive workers a year the current plan yields (the engine's baseline), and what the scenario adds. */
  baselineAnnualProductive: number | null; additionalAnnualProductive: number | null;
  firstYearWorkersEnter: number | null;
  perAdditionalPlaced: number | null; recurring: number | null; oneTime: number | null;
  confidenceShare: number | null; unverified: string[]; stale: string[]; risks: string[];
}
export type TargetStatus = "no-target" | "unassessed" | "on-track" | "covered" | "at-risk";
export interface TargetAtRisk {
  familyId: string; family: string; job: string; institutionId: string; institution: string;
  programId: string | null; program: string | null;
  targetYear: number; target: number | null;
  baseline: number | null; expectedShortfall: number | null;
  /** The scenario the answer rests on: the recommended one, else the best evaluated. */
  chosen: ScenarioSummary | null;
  /** The shortfall left if the chosen scenario were done. */
  shortfallAfter: number | null;
  status: TargetStatus;
  scenarios: number;
}
export interface BindingRollup { kind: ConstraintKind; label: string; programs: { program: string; institution: string; programId: string; scenario: string; shortfall: number | null; unit: string; where: string | null; fix: string; evidence: string }[] }
export interface EvidenceGap { label: string; detail: string; count: number; href: string; kind: "assumption" | "stale" | "calendar" | "site" | "standard" | "risk" }
export interface RecentChange { when: string; what: string; where: string; href: string; kind: "scenario" | "assumption" | "applied-plan" | "program" }
export interface ExecutiveSummary {
  asOf: string; targetYear: number;
  targets: TargetAtRisk[];
  binding: BindingRollup[];
  interventions: ScenarioSummary[];
  evidence: EvidenceGap[];
  recent: RecentChange[];
  exceptions: { blockers: number; warnings: number; notes: number };
  scenarios: { total: number; evaluated: number; recommended: number };
}

const kindLabelOf = (kind: string | undefined) => EXPANSION_KINDS.find((k) => k.kind === kind)?.label ?? (kind ? kind.replace(/-/g, " ") : "scenario");

/** The executive-grade summary of one saved scenario. */
export function summarizeScenario(s: ScenarioLite): ScenarioSummary {
  const r = s.result;
  return {
    id: s.id, name: s.name, status: s.status, kindLabel: kindLabelOf(s.design?.kind),
    programId: s.programId, program: s.program, institutionId: s.institutionId, institution: s.institution, familyId: s.familyId, family: s.family,
    evaluatedAt: s.evaluatedAt, updatedAt: s.updatedAt, evaluated: !!r,
    feasible: r ? r.feasible : null, feasibleInTime: r ? r.feasibleInTime : null, headline: r?.headline ?? null,
    binding: r?.binding ? { kind: r.binding.kind, label: r.binding.label, shortfall: r.binding.shortfall, unit: r.binding.unit, where: r.binding.where, fix: r.binding.fix, evidence: r.binding.evidence } : null,
    targetWorkers: s.design?.targetWorkers ?? null, targetYear: s.design?.targetYear ?? null,
    baselineAnnualProductive: r ? r.outputs.baselineAnnualProductive : null, additionalAnnualProductive: r ? r.outputs.additionalAnnualProductive : null,
    firstYearWorkersEnter: r?.outputs.firstYearWorkersEnter ?? null,
    perAdditionalPlaced: r?.costs.perAdditionalPlaced ?? null, recurring: r?.costs.recurring ?? null, oneTime: r?.costs.oneTime ?? null,
    confidenceShare: r?.confidence.share ?? null, unverified: r?.confidence.unverified ?? [], stale: r?.confidence.stale ?? [], risks: r?.confidence.risks ?? [],
  };
}

/** The scenario a target's answer should rest on: recommended first, else the best evaluated (in time, then feasible, then most workers). */
export function chooseScenario(xs: ScenarioSummary[]): ScenarioSummary | null {
  const live = xs.filter((x) => x.status !== "archived");
  const rec = live.find((x) => x.status === "recommended" && x.evaluated);
  if (rec) return rec;
  // A recommended scenario that was never evaluated cannot carry the answer; the best evaluated one does.
  const evaluated = live.filter((x) => x.evaluated);
  if (evaluated.length === 0) return live.find((x) => x.status === "recommended") ?? live[0] ?? null;
  return [...evaluated].sort((a, b) => Number(b.feasibleInTime) - Number(a.feasibleInTime) || Number(b.feasible) - Number(a.feasible) || (b.additionalAnnualProductive ?? 0) - (a.additionalAnnualProductive ?? 0))[0];
}

/** The target for a family in the target year: the year's goal, else the latest goal on or before it. */
export function targetFor(goalsByYear: Record<number, number>, targetYear: number): number | null {
  if (goalsByYear[targetYear] != null) return goalsByYear[targetYear];
  const years = Object.keys(goalsByYear).map(Number).filter((y) => y <= targetYear).sort((a, b) => b - a);
  return years.length ? goalsByYear[years[0]] : null;
}

/** Question 1 and 2: each workforce target, whether it is at risk, and the expected shortfall. */
export function targetsAtRisk(families: FamilyTarget[], scenarios: ScenarioSummary[], targetYear: number): TargetAtRisk[] {
  return families.map((f) => {
    const mine = scenarios.filter((s) => s.familyId === f.familyId || f.programs.some((p) => p.id === s.programId));
    const chosen = chooseScenario(mine);
    const target = targetFor(f.goalsByYear, targetYear);
    const baseline = chosen?.evaluated ? chosen.baselineAnnualProductive : null;
    const expectedShortfall = target != null && baseline != null ? Math.max(0, target - baseline) : null;
    const shortfallAfter = expectedShortfall != null && chosen?.evaluated ? Math.max(0, target! - baseline! - (chosen.additionalAnnualProductive ?? 0)) : null;
    const status: TargetStatus = target == null ? "no-target"
      : !chosen?.evaluated ? "unassessed"
      : expectedShortfall === 0 ? "on-track"
      : chosen.feasibleInTime && shortfallAfter === 0 ? "covered"
      : "at-risk";
    const program = chosen ? { id: chosen.programId, name: chosen.program } : f.programs[0] ?? null;
    return {
      familyId: f.familyId, family: f.family, job: f.job, institutionId: f.institutionId, institution: f.institution,
      programId: program?.id ?? null, program: program?.name ?? null,
      targetYear, target, baseline, expectedShortfall, chosen, shortfallAfter, status, scenarios: mine.filter((s) => s.status !== "archived").length,
    };
  }).sort((a, b) => rank(a.status) - rank(b.status) || (b.expectedShortfall ?? -1) - (a.expectedShortfall ?? -1) || a.job.localeCompare(b.job));
}
const rank = (s: TargetStatus) => ({ "at-risk": 0, unassessed: 1, covered: 2, "no-target": 3, "on-track": 4 })[s];

/** Question 3: the constraints that bind, across the chosen scenarios, most common first. */
export function bindingRollup(chosen: ScenarioSummary[]): BindingRollup[] {
  const by = new Map<ConstraintKind, BindingRollup>();
  for (const s of chosen) {
    if (!s.binding) continue;
    const b = s.binding;
    const row = by.get(b.kind) ?? { kind: b.kind, label: CONSTRAINT_LABEL[b.kind] ?? b.label, programs: [] };
    row.programs.push({ program: s.program, institution: s.institution, programId: s.programId, scenario: s.name, shortfall: b.shortfall, unit: b.unit, where: b.where, fix: b.fix, evidence: b.evidence });
    by.set(b.kind, row);
  }
  return [...by.values()].sort((a, b) => b.programs.length - a.programs.length || a.label.localeCompare(b.label));
}
export const CONSTRAINT_LABEL: Record<ConstraintKind, string> = {
  time: "Time — the target date comes before the first cohort can produce workers", faculty: "Faculty — qualified instructor hours in the peak week", preceptors: "Preceptors — precepted shifts at secured sites",
  "clinical-seats": "Clinical seats — learner seats on a date, shift and setting", agreements: "Agreements — sites without a secured agreement", accreditor: "Accreditor — the approved capacity",
  rooms: "Rooms — lab and classroom hours in the peak week", pipeline: "Pipeline — qualified applicants", calendar: "Calendar — term dates and holidays", equipment: "Equipment — units per learner",
};

/** Question 4: the interventions worth the most — feasible scenarios, cheapest per placed worker first, most workers as the tie-break. */
export function rankInterventions(scenarios: ScenarioSummary[], limit = 8): ScenarioSummary[] {
  return scenarios
    .filter((s) => s.evaluated && s.status !== "archived" && s.feasible && (s.additionalAnnualProductive ?? 0) > 0)
    .sort((a, b) => (a.perAdditionalPlaced ?? Infinity) - (b.perAdditionalPlaced ?? Infinity) || (b.additionalAnnualProductive ?? 0) - (a.additionalAnnualProductive ?? 0))
    .slice(0, limit);
}

/** Question 5: the evidence gaps that lower confidence, from the chosen scenarios and the inputs behind them. */
export function evidenceGaps(chosen: ScenarioSummary[], exceptions: ExceptionItem[], calendars: { institutionId: string; institution: string; level: "provisional" | "hand-set" | "ok"; text: string }[]): EvidenceGap[] {
  const out: EvidenceGap[] = [];
  const unverified = new Map<string, Set<string>>();
  const stale = new Map<string, Set<string>>();
  for (const s of chosen) {
    for (const u of s.unverified) unverified.set(u, (unverified.get(u) ?? new Set()).add(s.program));
    for (const u of s.stale) stale.set(u, (stale.get(u) ?? new Set()).add(s.program));
  }
  for (const [label, programs] of [...unverified.entries()].sort((a, b) => b[1].size - a[1].size)) out.push({ kind: "assumption", label, detail: `an unverified assumption behind the answer for ${[...programs].join(", ")}`, count: programs.size, href: "/setup#evidence" });
  for (const [label, programs] of stale.entries()) out.push({ kind: "stale", label, detail: `past its review date — used by ${[...programs].join(", ")}`, count: programs.size, href: "/setup#evidence" });
  for (const c of calendars) if (c.level !== "ok") out.push({ kind: "calendar", label: c.level === "provisional" ? `${c.institution}: term dates are provisional` : `${c.institution}: some term dates set by hand`, detail: c.text, count: 1, href: `/orgs/${c.institutionId}#calendar` });
  for (const x of exceptions) if (x.kind === "unverified-input" || x.kind === "stale-input") out.push({ kind: x.kind === "stale-input" ? "stale" : "site", label: x.title, detail: x.detail, count: x.count, href: x.href });
  const risks = new Map<string, Set<string>>();
  for (const s of chosen) for (const r of s.risks) risks.set(r, (risks.get(r) ?? new Set()).add(s.program));
  for (const [label, programs] of risks.entries()) out.push({ kind: "risk", label, detail: `a risk the engine flagged for ${[...programs].join(", ")}`, count: programs.size, href: "/scenarios" });
  return out;
}

// ── Database ───────────────────────────────────────────────────────────────────────────────────
const parse = <T,>(s: string | null | undefined, fallback: T): T => { if (!s) return fallback; try { return JSON.parse(s) as T; } catch { return fallback; } };
const resultOf = (s: string | null) => { const r = parse<ExpansionResult | null>(s, null); return r && Array.isArray(r.rules) && Array.isArray(r.concurrent) ? r : null; };
const isoOf = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Every saved scenario, summarised, newest first. */
export async function getScenarioSummaries(): Promise<ScenarioSummary[]> {
  const rows = await prisma.scenario.findMany({ orderBy: { updatedAt: "desc" } });
  const programs = await prisma.program.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.programId))] } }, select: { id: true, name: true, institutionId: true, institution: { select: { name: true } }, family: { select: { id: true, name: true } } } });
  const progOf = new Map(programs.map((p) => [p.id, p]));
  return rows.flatMap((r) => {
    const p = progOf.get(r.programId);
    if (!p) return [];
    return [summarizeScenario({ id: r.id, name: r.name, status: r.status, notes: r.notes, programId: p.id, program: p.name, institutionId: p.institutionId, institution: p.institution.name, familyId: p.family?.id ?? r.familyId, family: p.family?.name ?? null, design: parse<ExpansionDesign | null>(r.design, null), result: resultOf(r.result), evaluatedAt: isoOf(r.evaluatedAt), updatedAt: r.updatedAt.toISOString() })];
  });
}

/** The workforce targets: every job family with its programs and goals by year. */
export async function getFamilyTargets(): Promise<FamilyTarget[]> {
  const fams = await prisma.programFamily.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, goalPlan: true, institutionId: true, institution: { select: { name: true } }, occupation: { select: { title: true } }, programs: { orderBy: { name: "asc" }, select: { id: true, name: true, yearTargets: { select: { year: true, credentialTarget: true } } } } } });
  return fams.map((f) => {
    const goalsByYear: Record<number, number> = {};
    for (const [y, g] of Object.entries(parse<{ goalsByYear?: Record<string, number> }>(f.goalPlan, {}).goalsByYear ?? {})) goalsByYear[Number(y)] = Number(g) || 0;
    if (Object.keys(goalsByYear).length === 0) for (const p of f.programs) for (const t of p.yearTargets) if (t.credentialTarget != null) goalsByYear[t.year] = (goalsByYear[t.year] ?? 0) + t.credentialTarget;
    return { familyId: f.id, family: f.name, job: f.occupation?.title ?? f.name, institutionId: f.institutionId, institution: f.institution.name, programs: f.programs.map((p) => ({ id: p.id, name: p.name })), goalsByYear };
  });
}

/** The recent changes that matter to the answers: scenarios, assumptions, applied plans, program designs. */
export async function getRecentChanges(limit = 8): Promise<RecentChange[]> {
  const since = new Date(Date.now() - 60 * 86400000);
  const [scen, assum, changes, progs] = await Promise.all([
    prisma.scenario.findMany({ where: { updatedAt: { gte: since } }, orderBy: { updatedAt: "desc" }, take: limit, select: { id: true, name: true, status: true, updatedAt: true, evaluatedAt: true, programId: true } }),
    prisma.assumption.findMany({ where: { updatedAt: { gte: since } }, orderBy: { updatedAt: "desc" }, take: limit, select: { key: true, scope: true, value: true, status: true, updatedAt: true } }),
    prisma.changeSet.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: limit, select: { id: true, kind: true, label: true, institutionId: true, createdAt: true, undoneAt: true } }),
    prisma.program.findMany({ where: { updatedAt: { gte: since } }, orderBy: { updatedAt: "desc" }, take: limit, select: { id: true, name: true, updatedAt: true } }),
  ]);
  const progNames = new Map((await prisma.program.findMany({ where: { id: { in: scen.map((s) => s.programId) } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  const instNames = new Map((await prisma.institution.findMany({ select: { id: true, name: true } })).map((i) => [i.id, i.name]));
  const out: RecentChange[] = [
    ...scen.map((s): RecentChange => ({ when: s.updatedAt.toISOString(), kind: "scenario", what: `Scenario “${s.name}” ${s.status === "recommended" ? "marked recommended" : s.evaluatedAt && s.evaluatedAt.getTime() >= s.updatedAt.getTime() - 1000 ? "evaluated" : "saved"}`, where: progNames.get(s.programId) ?? "", href: `/programs/${s.programId}/expand` })),
    ...assum.map((a): RecentChange => ({ when: a.updatedAt.toISOString(), kind: "assumption", what: `Assumption ${a.key} set to ${a.value} (${a.status})`, where: a.scope === "global" ? "workspace" : a.scope.startsWith("inst:") ? instNames.get(a.scope.slice(5)) ?? "college" : a.scope.startsWith("family:") ? "job family" : "program", href: a.scope.startsWith("inst:") ? `/orgs/${a.scope.slice(5)}/assumptions` : "/setup" })),
    ...changes.map((c): RecentChange => ({ when: c.createdAt.toISOString(), kind: "applied-plan", what: `${c.label}${c.undoneAt ? " (undone)" : ""}`, where: c.institutionId ? instNames.get(c.institutionId) ?? "" : "", href: c.kind === "scheduler-apply" ? `/scheduler${c.institutionId ? `?inst=${c.institutionId}` : ""}` : "/programs" })),
    ...progs.map((p): RecentChange => ({ when: p.updatedAt.toISOString(), kind: "program", what: `Program design “${p.name}” changed`, where: "", href: `/programs/${p.id}/structure` })),
  ];
  return out.sort((a, b) => b.when.localeCompare(a.when)).slice(0, limit);
}

/** Everything the executive Home shows. */
export async function getExecutiveSummary(now = new Date()): Promise<ExecutiveSummary> {
  const targetYear = now.getUTCFullYear() + 3;
  const [scenarios, families, exceptions, provenance, recent] = await Promise.all([getScenarioSummaries(), getFamilyTargets(), getExceptionQueue(), getCalendarProvenance(), getRecentChanges()]);
  const targets = targetsAtRisk(families, scenarios, targetYear);
  const chosen = targets.flatMap((t) => (t.chosen?.evaluated ? [t.chosen] : []));
  const calendars = provenance.institutions.map((i) => ({ institutionId: i.id, institution: i.name, ...provisionalVerdict(i) }));
  return {
    asOf: now.toISOString(), targetYear,
    targets,
    binding: bindingRollup(chosen),
    interventions: rankInterventions(scenarios),
    evidence: evidenceGaps(chosen, exceptions, calendars),
    recent,
    exceptions: { blockers: exceptions.filter((x) => x.severity === "blocker").length, warnings: exceptions.filter((x) => x.severity === "warning").length, notes: exceptions.filter((x) => x.severity === "info").length },
    scenarios: { total: scenarios.length, evaluated: scenarios.filter((s) => s.evaluated).length, recommended: scenarios.filter((s) => s.status === "recommended").length },
  };
}

/** The Scenarios hub: every program, its saved scenarios, and the target it is measured against. */
export async function getScenarioHub(now = new Date()) {
  const targetYear = now.getUTCFullYear() + 3;
  const [scenarios, families] = await Promise.all([getScenarioSummaries(), getFamilyTargets()]);
  const targets = targetsAtRisk(families, scenarios, targetYear);
  const institutions = new Map<string, { id: string; name: string; programs: { id: string; name: string; family: string; job: string; target: TargetAtRisk; scenarios: ScenarioSummary[] }[] }>();
  for (const f of families) {
    const t = targets.find((x) => x.familyId === f.familyId)!;
    const inst = institutions.get(f.institutionId) ?? { id: f.institutionId, name: f.institution, programs: [] };
    for (const p of f.programs) inst.programs.push({ id: p.id, name: p.name, family: f.family, job: f.job, target: t, scenarios: scenarios.filter((s) => s.programId === p.id) });
    institutions.set(f.institutionId, inst);
  }
  return { targetYear, institutions: [...institutions.values()].sort((a, b) => a.name.localeCompare(b.name)), totals: { programs: families.reduce((n, f) => n + f.programs.length, 0), scenarios: scenarios.length, evaluated: scenarios.filter((s) => s.evaluated).length, recommended: scenarios.filter((s) => s.status === "recommended").length } };
}
