"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  BENCHMARK_RATES, RATE_DEFS, UTILIZATION_BENCHMARK,
  buildLadder, capacityFromNorthStar, utilization, roundLadder,
  type LadderRates,
} from "@/lib/northstar";
import { saveFamilyGoalPlan } from "@/lib/actions";

// The North-Star goal surface. Set a multi-year goal — one clean number per year,
// stairstep up / hold / shrink. Under each year sit the instantiations (cohorts)
// graduating that year, with the goal already set and the ACTUAL sourced live from
// the student database. Click a year to plan its full pipeline below.

type Anchor = "northstar" | "capacity";

export interface Instantiation {
  id: string;
  name: string;
  programId: string;
  program: string;
  goalProductive: number;
  students: number;
  enrolled: number;
  completed: number;
  placed: number;
  status: string;
  phase: string;              // recruiting | in-program | graduated | unscheduled
  currentTerm: string | null; // current term name (when in-program)
  endLabel: string | null;    // expected-end label, e.g. "ends May 2026"
}

const PHASE_BADGE: Record<string, string> = {
  recruiting: "bg-sky-100 text-sky-700", "in-program": "bg-emerald-100 text-emerald-700",
  graduated: "bg-slate-200 text-slate-600", unscheduled: "bg-slate-100 text-slate-400",
};
const PHASE_LABEL: Record<string, string> = {
  recruiting: "recruiting", "in-program": "in program", graduated: "graduated", unscheduled: "unscheduled",
};

/** Live actual funnel for a year, summed from the student database (cumulative). */
export interface ActualFunnel {
  interested: number; qualified: number; offered: number; enrolled: number;
  completing: number; licensed: number; placed: number; productive: number;
}

/** Actual health-metric ratio for one rate, computed from the live funnel + capacity. */
function actualRateOf(key: keyof LadderRates, a: ActualFunnel, cap: number): number | null {
  switch (key) {
    case "interestedSurplus": return cap ? a.interested / cap : null;
    case "qualifiedSurplus": return cap ? a.qualified / cap : null;
    case "offeredSurplus": return cap ? a.offered / cap : null;
    case "enrollmentRate": return cap ? a.enrolled / cap : null;
    case "completionRate": return a.enrolled ? a.completing / a.enrolled : null;
    case "licensureRate": return a.completing ? a.licensed / a.completing : null;
    case "placementRate": return a.licensed ? a.placed / a.licensed : null;
    case "productivityRate": return a.placed ? a.productive / a.placed : null;
  }
}

interface Persisted {
  anchor: Anchor;
  years: number[];
  goalsByYear: Record<string, number>;
  capByYear: Record<string, number>;
  selectedYear: number;
  goal: LadderRates;
  actual: LadderRates;
}

const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
const pctOf = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const num = (v: number) => Math.round(v).toLocaleString();

function attainColor(a: number | null): string {
  if (a == null) return "text-slate-400";
  if (a >= 1) return "text-emerald-600";
  if (a >= 0.85) return "text-amber-600";
  return "text-rose-600";
}

export function GoalPlanner({
  familyId, familyName, seedYears, seedGoalsByYear, savedPlan, instantiationsByYear = {}, actualByYear = {}, nowYear,
}: {
  familyId: string;
  familyName: string;
  seedYears: number[];
  seedGoalsByYear: Record<number, number>;
  savedPlan: string | null;
  instantiationsByYear?: Record<number, Instantiation[]>;
  actualByYear?: Record<number, ActualFunnel>;
  nowYear: number;
}) {
  const initial: Persisted = useMemo(() => {
    const years = (seedYears.length ? seedYears : [new Date().getFullYear() + 2]).slice().sort((a, b) => a - b);
    const goalsByYear: Record<string, number> = {};
    let last = 25;
    for (const y of years) { const g = Math.round(seedGoalsByYear[y] ?? 0) || last; goalsByYear[String(y)] = g; last = g; }
    const capByYear: Record<string, number> = {};
    for (const y of years) capByYear[String(y)] = Math.round(capacityFromNorthStar(goalsByYear[String(y)], BENCHMARK_RATES));
    // Open on the latest year with live student data (else latest with a cohort, else last).
    const withData = years.filter((y) => (actualByYear[y]?.interested ?? 0) > 0);
    const withCohorts = years.filter((y) => (instantiationsByYear[y]?.length ?? 0) > 0);
    const pool = withData.length ? withData : withCohorts;
    const defaultYear = pool.length ? pool[pool.length - 1] : years[years.length - 1];
    const base: Persisted = {
      anchor: "northstar", years, goalsByYear, capByYear,
      selectedYear: defaultYear,
      goal: { ...BENCHMARK_RATES }, actual: { ...BENCHMARK_RATES },
    };
    if (savedPlan) {
      try {
        const saved = JSON.parse(savedPlan) as Partial<Persisted>;
        const merged: Persisted = {
          ...base, ...saved,
          goal: { ...base.goal, ...saved.goal }, actual: { ...base.actual, ...saved.actual },
          goalsByYear: { ...base.goalsByYear, ...saved.goalsByYear }, capByYear: { ...base.capByYear, ...saved.capByYear },
        };
        if (!merged.years.includes(merged.selectedYear)) merged.selectedYear = merged.years[merged.years.length - 1];
        return merged;
      } catch { /* fall through */ }
    }
    return base;
  }, [seedYears, seedGoalsByYear, savedPlan, instantiationsByYear, actualByYear]);

  const [s, setS] = useState<Persisted>(initial);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    setSaveState("saving");
    const t = setTimeout(() => {
      saveFamilyGoalPlan(familyId, JSON.stringify(s)).then(() => setSaveState("saved")).catch(() => setSaveState("idle"));
    }, 700);
    return () => clearTimeout(t);
  }, [s, familyId]);

  const capacityForYear = (year: number): number =>
    s.anchor === "northstar" ? capacityFromNorthStar(s.goalsByYear[String(year)] ?? 0, s.goal) : (s.capByYear[String(year)] ?? 0);
  const productiveForYear = (year: number): number => buildLadder(capacityForYear(year), s.goal).productive;

  const goalCapacity = capacityForYear(s.selectedYear);
  const goalLadder = roundLadder(buildLadder(goalCapacity, s.goal));
  // ACTUAL is sourced live from the student database (no manual entry).
  const actualFunnel: ActualFunnel | null = actualByYear[s.selectedYear] ?? null;
  const hasActual = actualFunnel != null && (actualFunnel.interested > 0 || actualFunnel.enrolled > 0);
  const goalUtil = utilization(goalLadder.productive, goalCapacity);
  const actualUtil = actualFunnel ? utilization(actualFunnel.productive, goalCapacity) : null;

  const setYearValue = (year: number, v: number) => setS((p) => {
    const k = String(year);
    return p.anchor === "northstar"
      ? { ...p, goalsByYear: { ...p.goalsByYear, [k]: Math.max(0, v) } }
      : { ...p, capByYear: { ...p.capByYear, [k]: Math.max(0, v) } };
  });
  const selectYear = (year: number) => setS((p) => ({ ...p, selectedYear: year }));
  const addYear = () => setS((p) => {
    const next = (p.years[p.years.length - 1] ?? new Date().getFullYear()) + 1;
    const lastG = p.goalsByYear[String(p.years[p.years.length - 1])] ?? 25;
    const lastC = p.capByYear[String(p.years[p.years.length - 1])] ?? Math.round(capacityFromNorthStar(lastG, p.goal));
    return { ...p, years: [...p.years, next], goalsByYear: { ...p.goalsByYear, [String(next)]: lastG }, capByYear: { ...p.capByYear, [String(next)]: lastC } };
  });
  const removeYear = () => setS((p) => {
    if (p.years.length <= 1) return p;
    const years = p.years.slice(0, -1);
    return { ...p, years, selectedYear: years.includes(p.selectedYear) ? p.selectedYear : years[years.length - 1] };
  });

  const setGoalRate = (k: keyof LadderRates, vPct: number) => setS((p) => ({ ...p, goal: { ...p.goal, [k]: vPct / 100 } }));
  const resetBenchmark = () => setS((p) => ({ ...p, goal: { ...BENCHMARK_RATES } }));
  const attain = (g: number, a: number | null) => (a != null && g > 0 ? a / g : null);

  const af = actualFunnel;
  const ladderRows: { label: string; g: number; a: number | null; strong?: boolean }[] = [
    { label: "Interested candidates", g: goalLadder.interested, a: af?.interested ?? null },
    { label: "Qualified applicants", g: goalLadder.qualified, a: af?.qualified ?? null },
    { label: "Offered admission", g: goalLadder.offered, a: af?.offered ?? null },
    { label: "Enrollment capacity", g: goalLadder.enrolled, a: af?.enrolled ?? null, strong: true },
    { label: "Completing on time", g: goalLadder.completing, a: af?.completing ?? null },
    { label: "Passing licensure (first time)", g: goalLadder.licensed, a: af?.licensed ?? null },
    { label: "Retained & placed regionally", g: goalLadder.placed, a: af?.placed ?? null },
    { label: "Reaching full productivity", g: goalLadder.productive, a: af?.productive ?? null, strong: true },
  ];

  return (
    <div className="space-y-5">
      {/* Anchor + save */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-sm">
          <button onClick={() => setS((p) => ({ ...p, anchor: "northstar" }))} className={`px-3 py-1.5 ${s.anchor === "northstar" ? "bg-rose-600 text-white" : "bg-white text-slate-600"}`}>Anchor: North Star</button>
          <button onClick={() => setS((p) => ({ ...p, anchor: "capacity" }))} className={`px-3 py-1.5 ${s.anchor === "capacity" ? "bg-rose-600 text-white" : "bg-white text-slate-600"}`}>Anchor: Capacity</button>
        </div>
        <span className="ml-auto text-[11px] text-slate-400">{saveState === "saving" ? "saving…" : saveState === "saved" ? "✓ saved" : ""}</span>
        <button onClick={resetBenchmark} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50">Reset rates to benchmark</button>
      </div>

      {/* Multi-year goals — clean numbers, instantiations under each year */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-400">{s.anchor === "northstar" ? "Fully-productive workers each year — set the goal; the class delivering it sits underneath." : "Enrollment capacity each year."} Click a year to plan its full pipeline below.</p>
          <div className="flex items-center gap-1">
            <button onClick={removeYear} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50" title="remove last year">−</button>
            <button onClick={addYear} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50" title="add a year">+ year</button>
          </div>
        </div>

        {/* The stairstep: one goal box per year, reading left → right. */}
        <div className="overflow-x-auto pb-1">
          <div className="flex items-stretch gap-2">
            {s.years.map((year) => {
              const selected = year === s.selectedYear;
              const goalVal = s.anchor === "northstar" ? (s.goalsByYear[String(year)] ?? 0) : (s.capByYear[String(year)] ?? 0);
              const derived = s.anchor === "northstar" ? Math.round(capacityForYear(year)) : Math.round(productiveForYear(year));
              const insts = instantiationsByYear[year] ?? [];
              const actualProductive = insts.reduce((n, i) => n + i.placed, 0);
              return (
                <button key={year} onClick={() => selectYear(year)}
                  className={`min-w-[128px] shrink-0 rounded-xl border p-3 text-left ${selected ? "border-rose-400 bg-rose-50/50 ring-1 ring-rose-200" : "border-slate-200 bg-white hover:border-rose-200"} ${year === nowYear ? "outline outline-1 outline-offset-2 outline-rose-200" : ""}`}>
                  <span className={`block text-sm font-bold tabular-nums ${selected ? "text-rose-700" : "text-slate-700"}`}>{year}{year === nowYear ? " · now" : ""}</span>
                  <input
                    type="number" min={0} value={Math.round(goalVal)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setYearValue(year, Number(e.target.value) || 0)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-center text-2xl font-bold tabular-nums text-slate-800 focus:border-rose-400 focus:outline-none"
                  />
                  <span className="mt-0.5 block text-[10px] text-slate-400">{s.anchor === "northstar" ? `needs ~${derived} enrolled` : `→ ~${derived} productive`}</span>
                  <span className="mt-0.5 block text-[10px] tabular-nums">
                    {insts.length > 0
                      ? <><strong className={attainColor(attain(Math.round(goalVal), actualProductive))}>{actualProductive}</strong> <span className="text-slate-400">placed · {insts.length} class{insts.length === 1 ? "" : "es"}</span></>
                      : <span className="text-slate-300">{year < nowYear ? "none graduated" : year === nowYear ? "none graduating" : "not planned"}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* The selected year's instantiations — the classes delivering that goal. */}
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{s.selectedYear} — instantiations delivering this goal</div>
          {(instantiationsByYear[s.selectedYear] ?? []).length === 0 ? (
            <p className="text-xs text-slate-300">
              {s.selectedYear < nowYear ? `No instantiations graduated in ${s.selectedYear}.` : s.selectedYear === nowYear ? `No instantiations graduating in ${s.selectedYear}.` : `No instantiations planned for ${s.selectedYear} yet.`}
            </p>
          ) : (
            <div className="space-y-1.5">
              {(instantiationsByYear[s.selectedYear] ?? []).map((c) => (
                <Link key={c.id} href={`/programs/${c.programId}/offerings/${c.id}`} className="rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2 text-[13px] hover:border-rose-200 hover:bg-rose-50/40 block">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-slate-800">
                      {c.name} <span className="font-normal text-slate-400">· {c.program}</span>
                      <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${PHASE_BADGE[c.phase] ?? PHASE_BADGE.unscheduled}`}>{PHASE_LABEL[c.phase] ?? c.phase}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-3 tabular-nums text-slate-500">
                      <span>goal <strong className="text-slate-700">{c.goalProductive || "—"}</strong></span>
                      <span className="text-slate-300">·</span>
                      <span title="live from student data">{c.students} students</span>
                      <span className="text-emerald-600">{c.enrolled} enrolled</span>
                      <span className="text-lime-600">{c.completed} completed</span>
                      <span className="text-rose-600">{c.placed} placed</span>
                    </span>
                  </span>
                  {(c.currentTerm || c.endLabel) && (
                    <span className="mt-0.5 block text-[11px] text-slate-400">
                      {c.phase === "in-program" && c.currentTerm ? `Now in ${c.currentTerm}` : c.phase === "recruiting" ? "Starts soon" : ""}
                      {c.currentTerm && c.endLabel ? " · " : ""}{c.endLabel ?? ""}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Selected year's full pipeline — two tables */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">{s.selectedYear} pipeline plan <span className="font-normal text-slate-400">— goal rates set the plan; actuals are sourced live from the student database</span></h3>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
              <div className="text-sm font-semibold text-slate-700">Talent-pipeline health metrics</div>
              <p className="text-[11px] text-slate-400">Goal % is editable. <strong>Actual % is live from the student database{hasActual ? "" : s.selectedYear > nowYear ? ` — ${s.selectedYear} hasn't started` : ` — no student records for ${s.selectedYear}`}.</strong></p>
            </div>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-2 text-left font-medium">Metric</th>
                  <th className="px-2 py-2 text-right font-medium">Goal</th>
                  <th className="px-2 py-2 text-right font-medium">Actual</th>
                  <th className="px-3 py-2 text-right font-medium">Bench</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {RATE_DEFS.map((d) => {
                  const gv = s.goal[d.key];
                  const ar = af ? actualRateOf(d.key, af, goalCapacity) : null;
                  const healthy = ar != null && ar >= d.benchmark;
                  return (
                    <tr key={d.key} className="hover:bg-slate-50/60">
                      <td className="px-4 py-1.5">
                        <span className="block font-medium text-slate-700">{d.label}</span>
                        <span className="block text-[10px] text-slate-400">{d.of}</span>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <input type="number" value={Math.round(gv * 1000) / 10} step={1} onChange={(e) => setGoalRate(d.key, Number(e.target.value) || 0)} className="w-16 rounded border border-slate-200 px-1.5 py-1 text-right tabular-nums focus:border-rose-400 focus:outline-none" /><span className="ml-0.5 text-slate-400">%</span>
                      </td>
                      <td className={`px-2 py-1.5 text-right tabular-nums font-medium ${ar == null ? "text-slate-300" : healthy ? "text-emerald-600" : "text-amber-600"}`}>{ar == null ? "—" : pct(ar)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">{pct(d.benchmark)}</td>
                    </tr>
                  );
                })}
                <tr className="bg-slate-50/60">
                  <td className="px-4 py-1.5"><span className="block font-medium text-slate-700">Regional pipeline utilization</span><span className="block text-[10px] text-slate-400">productive ÷ enrollment capacity</span></td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{pctOf(goalUtil)}</td>
                  <td className={`px-2 py-1.5 text-right tabular-nums ${actualUtil != null && actualUtil >= UTILIZATION_BENCHMARK ? "text-emerald-600" : "text-amber-600"}`}>{pctOf(actualUtil)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">{pct(UTILIZATION_BENCHMARK)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
              <div className="text-sm font-semibold text-slate-700">Talent-pipeline metrics — cohort ending {s.selectedYear}</div>
              <p className="text-[11px] text-slate-400">Autocalculated, in funnel order. Goal vs actual vs attainment.</p>
            </div>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-2 text-left font-medium">Metric</th>
                  <th className="px-3 py-2 text-right font-medium">Goal</th>
                  <th className="px-3 py-2 text-right font-medium">Actual</th>
                  <th className="px-3 py-2 text-right font-medium">Attain</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ladderRows.map((r) => {
                  const a = attain(r.g, r.a);
                  return (
                    <tr key={r.label} className={r.strong ? "bg-rose-50/40" : "hover:bg-slate-50/60"}>
                      <td className={`px-4 py-1.5 ${r.strong ? "font-semibold text-slate-800" : "text-slate-700"}`}>{r.label}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{num(r.g)}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums ${r.a == null ? "text-slate-300" : r.strong ? "font-semibold text-slate-900" : "text-slate-700"}`}>{r.a == null ? "—" : num(r.a)}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums font-medium ${attainColor(a)}`}>{pctOf(a)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
