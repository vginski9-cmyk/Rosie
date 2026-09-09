// How a program's clinical sequence rolls up to the credentialing body's list — pure.
//
// Each clinical course, in sequence, is coded with hours (or cases) per service area and
// therefore with the asset settings its students will be in. Every requirement item is
// mapped to the settings that can supply it, so course by course we can say which items
// FIRST become reachable, what is reachable in total by the end of each course, and —
// against the rules — whether the sequence as designed can ever satisfy the list (a
// mandatory item no course reaches is a design gap before it is a scheduling one).
//
// On top of reachability sits the program's own pacing: a target per rule by the end of
// each course (how many mandatory competencies / how many first-scrub general cases a
// student should have by then). Explicit targets come from the course's requirement plan;
// with none, the rule's minimum is paced evenly across the clinical courses that reach it.

import type { ReqItemLite } from "./requirements";
import type { RuleDef } from "./requirementprogress";
import { inScope } from "./requirementprogress";

export interface RollupCourse { id: string; code: string | null; name: string; termIndex: number; termName: string; settings: string[]; hours: Record<string, number>; cases: Record<string, number>; plan: Record<string, number> }
export interface RollupSet { id: string; name: string; authority: string; kind: string; rules: RuleDef[]; items: ReqItemLite[] }
export interface CourseRollup {
  course: RollupCourse;
  /** Items first reachable in this course (its settings supply them and no earlier course did). */
  newItems: ReqItemLite[];
  /** Everything reachable by the end of this course. */
  reachable: ReqItemLite[];
  hours: number; cases: number; cumHours: number; cumCases: number;
  /** Per counted rule: what the sequence can reach so far, the design target by the end of this course, and the auto-paced target. */
  rules: { key: string; label: string; min: number; reachable: number; target: number; explicit: boolean; targetOk: boolean }[];
}
export interface Rollup { courses: CourseRollup[]; endGaps: { key: string; label: string; min: number; reachable: number }[]; unreachable: ReqItemLite[]; unreachableRequired: ReqItemLite[]; caseDesign: { planned: number; required: number } | null }

const csv = (v: string | null | undefined) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

export function rollupSequence(set: RollupSet, courses: RollupCourse[]): Rollup {
  const seq = [...courses].sort((a, b) => a.termIndex - b.termIndex || (a.code ?? a.name).localeCompare(b.code ?? b.name));
  const counted = set.rules.filter((r) => r.min != null && r.key !== "simulation");
  const reachableBy = (settings: Set<string>) => set.items.filter((i) => { const s = csv(i.settingCodes); return s.length === 0 || s.some((c) => settings.has(c)); });
  const seen = new Set<string>();
  let cum = new Set<string>(); let cumHours = 0, cumCases = 0;
  const totalRequired = counted.reduce<Record<string, number>>((m, r) => { m[r.key] = r.min!; return m; }, {});
  // Even pacing: each counted rule's minimum spread across the clinical courses whose settings can reach its items.
  const reaches = (c: RollupCourse, r: RuleDef) => set.items.some((i) => inScope(i, r.scope) && (csv(i.settingCodes).length === 0 || csv(i.settingCodes).some((x) => c.settings.includes(x))));
  const coursesReaching = counted.reduce<Record<string, number>>((m, r) => { m[r.key] = seq.filter((c) => reaches(c, r)).length; return m; }, {});
  const paceSoFar: Record<string, number> = {};
  const out: CourseRollup[] = seq.map((c) => {
    cum = new Set([...cum, ...c.settings]);
    const reach = reachableBy(cum);
    const newItems = reach.filter((i) => !seen.has(i.id)); for (const i of newItems) seen.add(i.id);
    const hours = Object.values(c.hours).reduce((n, v) => n + v, 0), cases = Object.values(c.cases).reduce((n, v) => n + v, 0);
    cumHours += hours; cumCases += cases;
    const rules = counted.map((r) => {
      const reachable = set.kind === "cases" ? (r.key === "total" ? cumCases : Math.min(cumCases, r.min!)) : reach.filter((i) => inScope(i, r.scope)).length;
      if (reaches(c, r)) paceSoFar[r.key] = (paceSoFar[r.key] ?? 0) + 1;
      const auto = Math.round((totalRequired[r.key] * (paceSoFar[r.key] ?? 0)) / Math.max(1, coursesReaching[r.key]));
      const explicit = c.plan[r.key];
      const target = explicit != null ? explicit : auto;
      return { key: r.key, label: r.label, min: r.min!, reachable, target, explicit: explicit != null, targetOk: target <= reachable };
    });
    return { course: c, newItems, reachable: reach, hours, cases, cumHours, cumCases, rules };
  });
  const last = out[out.length - 1];
  const endGaps = last ? last.rules.filter((r) => r.reachable < r.min).map((r) => ({ key: r.key, label: r.label, min: r.min, reachable: r.reachable })) : counted.map((r) => ({ key: r.key, label: r.label, min: r.min!, reachable: 0 }));
  const unreachable = set.items.filter((i) => csv(i.settingCodes).length > 0 && !seen.has(i.id));
  return { courses: out, endGaps, unreachable, unreachableRequired: unreachable.filter((i) => i.mandatory), caseDesign: set.kind === "cases" ? { planned: cumCases, required: set.rules.find((r) => r.key === "total")?.min ?? 120 } : null };
}
