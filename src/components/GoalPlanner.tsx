"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BENCHMARK_RATES, RATE_DEFS, UTILIZATION_BENCHMARK,
  buildLadder, capacityFromNorthStar, utilization, roundLadder, defaultTermRetention,
  type LadderRates,
} from "@/lib/northstar";
import { saveFamilyGoalPlan } from "@/lib/actions";

// The North-Star goal surface. Set a MULTI-YEAR goal — one box per year, so a
// program can stairstep up, hold, or shrink — then adjust every health-metric
// PERCENTAGE in a row (goal % + actual %) and the whole cohort-metrics ladder
// (interested → fully productive, plus term-by-term enrollment) autocalculates
// for the selected year. Two tables, side by side, exactly like the institutions
// workbook. Edits persist to the family's plan in the database.

type Anchor = "northstar" | "capacity";

interface Persisted {
  anchor: Anchor;
  years: number[];
  /** North-Star (fully-productive) goal per year, keyed by year string. */
  goalsByYear: Record<string, number>;
  /** Enrollment capacity per year (when anchoring on capacity), keyed by year string. */
  capByYear: Record<string, number>;
  selectedYear: number;
  goal: LadderRates;
  actual: LadderRates;
  termCount: number;
  termGoal: number[];
  termActual: number[];
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
  familyId, familyName, seedYears, seedGoalsByYear, seedTerms, savedPlan,
}: {
  familyId: string;
  familyName: string;
  seedYears: number[];
  seedGoalsByYear: Record<number, number>;
  seedTerms: number;
  /** Previously-saved plan from the database (JSON string), if any. */
  savedPlan: string | null;
}) {
  const initial: Persisted = useMemo(() => {
    const years = (seedYears.length ? seedYears : [new Date().getFullYear() + 2]).slice().sort((a, b) => a - b);
    const terms = Math.max(1, seedTerms || 5);
    // Per-year North Star: use the family's target where known, else carry forward.
    const goalsByYear: Record<string, number> = {};
    let last = 25;
    for (const y of years) {
      const g = Math.round(seedGoalsByYear[y] ?? 0) || last;
      goalsByYear[String(y)] = g;
      last = g;
    }
    const capByYear: Record<string, number> = {};
    for (const y of years) capByYear[String(y)] = Math.round(capacityFromNorthStar(goalsByYear[String(y)], BENCHMARK_RATES));
    const base: Persisted = {
      anchor: "northstar",
      years,
      goalsByYear,
      capByYear,
      selectedYear: years[years.length - 1],
      goal: { ...BENCHMARK_RATES },
      actual: { ...BENCHMARK_RATES },
      termCount: terms,
      termGoal: defaultTermRetention(terms),
      termActual: defaultTermRetention(terms, 0.92),
    };
    if (savedPlan) {
      try {
        const saved = JSON.parse(savedPlan) as Partial<Persisted>;
        const merged: Persisted = {
          ...base, ...saved,
          goal: { ...base.goal, ...saved.goal },
          actual: { ...base.actual, ...saved.actual },
          goalsByYear: { ...base.goalsByYear, ...saved.goalsByYear },
          capByYear: { ...base.capByYear, ...saved.capByYear },
        };
        // Guard against a saved selectedYear no longer in range.
        if (!merged.years.includes(merged.selectedYear)) merged.selectedYear = merged.years[merged.years.length - 1];
        return merged;
      } catch { /* fall through to base */ }
    }
    return base;
  }, [seedYears, seedGoalsByYear, seedTerms, savedPlan]);

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

  // Capacity for any given year (the anchor for that year's ladder).
  const capacityForYear = (year: number): number => {
    if (s.anchor === "northstar") return capacityFromNorthStar(s.goalsByYear[String(year)] ?? 0, s.goal);
    return s.capByYear[String(year)] ?? 0;
  };
  const productiveForYear = (year: number): number => buildLadder(capacityForYear(year), s.goal).productive;

  const goalCapacity = capacityForYear(s.selectedYear);
  const goalLadder = roundLadder(buildLadder(goalCapacity, s.goal, s.termGoal.slice(0, s.termCount)));
  const actualLadder = roundLadder(buildLadder(goalCapacity, s.actual, s.termActual.slice(0, s.termCount)));

  // Utilization — productive ÷ enrollment capacity.
  const goalUtil = utilization(goalLadder.productive, goalCapacity);
  const actualUtil = utilization(actualLadder.productive, goalCapacity);

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
  const setActualRate = (k: keyof LadderRates, vPct: number) => setS((p) => ({ ...p, actual: { ...p.actual, [k]: vPct / 100 } }));
  const setTermGoal = (i: number, vPct: number) => setS((p) => { const t = [...p.termGoal]; t[i] = vPct / 100; return { ...p, termGoal: t }; });
  const setTermActual = (i: number, vPct: number) => setS((p) => { const t = [...p.termActual]; t[i] = vPct / 100; return { ...p, termActual: t }; });
  const setTermCount = (n: number) => setS((p) => {
    const c = Math.max(1, Math.min(12, n));
    const grow = (arr: number[], def: number) => Array.from({ length: c }, (_, i) => arr[i] ?? (i === 0 ? 1 : def));
    return { ...p, termCount: c, termGoal: grow(p.termGoal, 0.94), termActual: grow(p.termActual, 0.92) };
  });
  const resetBenchmark = () => setS((p) => ({ ...p, goal: { ...BENCHMARK_RATES }, actual: { ...BENCHMARK_RATES }, termGoal: defaultTermRetention(p.termCount), termActual: defaultTermRetention(p.termCount, 0.92) }));

  const attain = (g: number, a: number) => (g > 0 ? a / g : null);

  // Per-year bars (north-star or capacity) for the stairstep visual.
  const yearVals = s.years.map((y) => ({ year: y, val: s.anchor === "northstar" ? (s.goalsByYear[String(y)] ?? 0) : (s.capByYear[String(y)] ?? 0) }));
  const maxYearVal = Math.max(1, ...yearVals.map((v) => v.val));

  const ladderRows: { label: string; g: number; a: number; strong?: boolean; sub?: boolean }[] = [
    { label: "Interested candidates", g: goalLadder.interested, a: actualLadder.interested },
    { label: "Qualified applicants", g: goalLadder.qualified, a: actualLadder.qualified },
    { label: "Offered admission", g: goalLadder.offered, a: actualLadder.offered },
    { label: "Actual cohort enrollment capacity", g: goalLadder.enrolled, a: actualLadder.enrolled, strong: true },
    ...goalLadder.terms.map((g, i) => ({ label: `Term ${i + 1}`, g, a: actualLadder.terms[i] ?? 0, sub: true })),
    { label: "Students completing on time", g: goalLadder.completing, a: actualLadder.completing },
    { label: "Passing licensure (first time)", g: goalLadder.licensed, a: actualLadder.licensed },
    { label: "Credentialed graduates retained & placed", g: goalLadder.placed, a: actualLadder.placed },
    { label: "Reaching full productivity in region", g: goalLadder.productive, a: actualLadder.productive, strong: true },
  ];

  return (
    <div className="space-y-4">
      {/* Anchor + global controls */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-sm">
          <button onClick={() => setS((p) => ({ ...p, anchor: "northstar" }))} className={`px-3 py-1.5 ${s.anchor === "northstar" ? "bg-rose-600 text-white" : "bg-white text-slate-600"}`}>Anchor: North Star</button>
          <button onClick={() => setS((p) => ({ ...p, anchor: "capacity" }))} className={`px-3 py-1.5 ${s.anchor === "capacity" ? "bg-rose-600 text-white" : "bg-white text-slate-600"}`}>Anchor: Capacity</button>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-slate-500">Terms</span>
          <input type="number" min={1} max={12} value={s.termCount} onChange={(e) => setTermCount(Number(e.target.value) || 1)} className="w-16 rounded-lg border border-slate-300 px-2 py-1.5 text-right tabular-nums" />
        </label>
        <span className="ml-auto text-[11px] text-slate-400">{saveState === "saving" ? "saving…" : saveState === "saved" ? "✓ saved" : ""}</span>
        <button onClick={resetBenchmark} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50">Reset to benchmark</button>
      </div>

      {/* Multi-year North-Star goals — one box per year (stairstep) */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-700">{s.anchor === "northstar" ? "North-Star goal by year" : "Enrollment capacity by year"}</h3>
            <p className="text-[11px] text-slate-400">{s.anchor === "northstar" ? "Fully-productive workers each year — stairstep up, hold, or shrink. Click a year to plan its full pipeline below." : "Enrolled seats each year. Click a year to plan its full pipeline below."}</p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={removeYear} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50" title="remove last year">−</button>
            <button onClick={addYear} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50" title="add a year">+ year</button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {yearVals.map(({ year, val }) => {
            const selected = year === s.selectedYear;
            const derived = s.anchor === "northstar" ? Math.round(capacityForYear(year)) : Math.round(productiveForYear(year));
            return (
              <div key={year} className={`flex w-28 flex-col rounded-lg border p-2 ${selected ? "border-rose-400 bg-rose-50/60 ring-1 ring-rose-200" : "border-slate-200"}`}>
                <button onClick={() => selectYear(year)} className={`mb-1 text-left text-xs font-semibold ${selected ? "text-rose-700" : "text-slate-600 hover:text-rose-600"}`}>{year}{selected ? " ●" : ""}</button>
                {/* stairstep bar */}
                <span className="mb-1 flex h-8 items-end">
                  <span className="block w-full rounded-t bg-rose-300" style={{ height: `${Math.max(6, (val / maxYearVal) * 32)}px` }} />
                </span>
                <input type="number" min={0} value={Math.round(val)} onChange={(e) => setYearValue(year, Number(e.target.value) || 0)} className="w-full rounded border border-slate-300 px-1.5 py-1 text-right text-sm tabular-nums focus:border-rose-400 focus:outline-none" />
                <span className="mt-0.5 text-[10px] text-slate-400">{s.anchor === "northstar" ? `cap ${derived}` : `prod ${derived}`}</span>
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-[11px] text-slate-400">
        Planning <strong className="text-slate-600">{s.selectedYear}</strong> — {s.anchor === "northstar"
          ? "capacity is sized backward from that year's North Star through the goal yields."
          : "that year's enrollment capacity anchors the ladder."}
        {" "}Type any percentage — goal or actual — and the ladder recomputes. Saved to {familyName}&apos;s plan automatically.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Table 1 — health-metric percentages (editable) */}
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
            <h3 className="text-sm font-semibold text-slate-700">Talent-pipeline health metrics</h3>
            <p className="text-[11px] text-slate-400">Editable — goal % and actual %. Anchored on enrollment capacity or chained off the stage above.</p>
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
                const gv = s.goal[d.key], av = s.actual[d.key];
                const healthy = av >= d.benchmark;
                return (
                  <tr key={d.key} className="hover:bg-slate-50/60">
                    <td className="px-4 py-1.5">
                      <span className="block font-medium text-slate-700">{d.label}</span>
                      <span className="block text-[10px] text-slate-400">{d.of}{d.anchor === "capacity" ? " · surplus" : " · yield"}</span>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <input type="number" value={Math.round(gv * 1000) / 10} step={1} onChange={(e) => setGoalRate(d.key, Number(e.target.value) || 0)} className="w-16 rounded border border-slate-200 px-1.5 py-1 text-right tabular-nums focus:border-rose-400 focus:outline-none" />
                      <span className="ml-0.5 text-slate-400">%</span>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <input type="number" value={Math.round(av * 1000) / 10} step={1} onChange={(e) => setActualRate(d.key, Number(e.target.value) || 0)} className={`w-16 rounded border px-1.5 py-1 text-right tabular-nums focus:outline-none ${healthy ? "border-slate-200 focus:border-emerald-400" : "border-amber-300 bg-amber-50 focus:border-amber-400"}`} />
                      <span className="ml-0.5 text-slate-400">%</span>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">{pct(d.benchmark)}</td>
                  </tr>
                );
              })}
              <tr className="bg-slate-50/60">
                <td className="px-4 py-1.5">
                  <span className="block font-medium text-slate-700">Regional pipeline utilization</span>
                  <span className="block text-[10px] text-slate-400">productive ÷ enrollment capacity</span>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{pctOf(goalUtil)}</td>
                <td className={`px-2 py-1.5 text-right tabular-nums ${actualUtil != null && actualUtil >= UTILIZATION_BENCHMARK ? "text-emerald-600" : "text-amber-600"}`}>{pctOf(actualUtil)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">{pct(UTILIZATION_BENCHMARK)}</td>
              </tr>
            </tbody>
          </table>
          {/* Per-term retention editor */}
          <div className="border-t border-slate-200 bg-slate-50/60 px-4 py-3">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Term-by-term retention (% of prior term)</div>
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: s.termCount }, (_, i) => (
                <label key={i} className="flex items-center gap-1 text-xs">
                  <span className="text-slate-500">T{i + 1}</span>
                  <input type="number" value={Math.round((s.termGoal[i] ?? 1) * 1000) / 10} step={1} disabled={i === 0} onChange={(e) => setTermGoal(i, Number(e.target.value) || 0)} className="w-14 rounded border border-slate-200 px-1 py-0.5 text-right tabular-nums disabled:bg-slate-100 disabled:text-slate-400" title={i === 0 ? "Term 1 = enrolled" : "goal retention"} />
                  <input type="number" value={Math.round((s.termActual[i] ?? 1) * 1000) / 10} step={1} disabled={i === 0} onChange={(e) => setTermActual(i, Number(e.target.value) || 0)} className="w-14 rounded border border-amber-200 bg-amber-50/50 px-1 py-0.5 text-right tabular-nums disabled:bg-slate-100 disabled:text-slate-400" title={i === 0 ? "Term 1 = enrolled" : "actual retention"} />
                </label>
              ))}
            </div>
            <div className="mt-1 text-[10px] text-slate-400">left = goal · right = actual · T1 fixed at enrolled</div>
          </div>
        </div>

        {/* Table 2 — autocalculated cohort metrics (sequential, interested → productive) */}
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
            <h3 className="text-sm font-semibold text-slate-700">Talent-pipeline metrics — cohort ending {s.selectedYear}</h3>
            <p className="text-[11px] text-slate-400">Autocalculated from the percentages, in funnel order. Goal vs actual vs attainment.</p>
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
                  <tr key={r.label} className={r.strong ? "bg-rose-50/40" : r.sub ? "bg-slate-50/40" : "hover:bg-slate-50/60"}>
                    <td className={`px-4 py-1.5 ${r.strong ? "font-semibold text-slate-800" : r.sub ? "pl-7 text-slate-500" : "text-slate-700"}`}>{r.label}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{num(r.g)}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${r.strong ? "font-semibold text-slate-900" : "text-slate-700"}`}>{num(r.a)}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums font-medium ${attainColor(a)}`}>{pctOf(a)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
