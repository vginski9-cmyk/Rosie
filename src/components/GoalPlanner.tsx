"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BENCHMARK_RATES, RATE_DEFS, UTILIZATION_BENCHMARK,
  buildLadder, capacityFromNorthStar, utilization, roundLadder, defaultTermRetention,
  type LadderRates,
} from "@/lib/northstar";
import { saveFamilyGoalPlan } from "@/lib/actions";

// The North-Star goal surface: set the family's multi-year goal, then adjust
// every health-metric PERCENTAGE in a row (goal column + actual column) and the
// whole cohort-metrics ladder — interested → productive, plus term-by-term
// enrollment — autocalculates. Two tables, side by side, exactly like the
// institutions workbook. Edits persist in-browser per family.

type Anchor = "northstar" | "capacity";

interface Persisted {
  anchor: Anchor;
  northStar: number;
  capacity: number;
  goal: LadderRates;
  actual: LadderRates;
  termCount: number;
  termGoal: number[];
  termActual: number[];
  demand: number | null;
  year: number;
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
  familyId, familyName, seedNorthStar, seedDemand, seedTerms, seedYear, savedPlan,
}: {
  familyId: string;
  familyName: string;
  seedNorthStar: number;
  seedDemand: number | null;
  seedTerms: number;
  seedYear: number;
  /** Previously-saved plan from the database (JSON string), if any. */
  savedPlan: string | null;
}) {
  const initial: Persisted = useMemo(() => {
    const base: Persisted = {
      anchor: "northstar",
      northStar: seedNorthStar || 25,
      capacity: Math.round(capacityFromNorthStar(seedNorthStar || 25, BENCHMARK_RATES)),
      goal: { ...BENCHMARK_RATES },
      actual: { ...BENCHMARK_RATES },
      termCount: Math.max(1, seedTerms || 5),
      termGoal: defaultTermRetention(Math.max(1, seedTerms || 5)),
      termActual: defaultTermRetention(Math.max(1, seedTerms || 5), 0.92),
      demand: seedDemand,
      year: seedYear,
    };
    // The DB plan is authoritative when present — render it on the server too so
    // there's no hydration flash.
    if (savedPlan) {
      try {
        const saved = JSON.parse(savedPlan) as Partial<Persisted>;
        return { ...base, ...saved, goal: { ...base.goal, ...saved.goal }, actual: { ...base.actual, ...saved.actual } };
      } catch { /* fall through to base */ }
    }
    return base;
  }, [seedNorthStar, seedDemand, seedTerms, seedYear, savedPlan]);

  const [s, setS] = useState<Persisted>(initial);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const firstRender = useRef(true);

  // Debounced persistence to the database whenever the plan changes.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    setSaveState("saving");
    const t = setTimeout(() => {
      saveFamilyGoalPlan(familyId, JSON.stringify(s)).then(() => setSaveState("saved")).catch(() => setSaveState("idle"));
    }, 700);
    return () => clearTimeout(t);
  }, [s, familyId]);

  // Capacity drives both ladders. In North-Star mode it's derived from the goal
  // ladder's back-half yield; in capacity mode the user sets it directly.
  const goalCapacity = s.anchor === "northstar" ? capacityFromNorthStar(s.northStar, s.goal) : s.capacity;
  const goalLadder = roundLadder(buildLadder(goalCapacity, s.goal, s.termGoal.slice(0, s.termCount)));
  // Actuals share the same enrollment capacity (what you planned to seat) but run
  // the actual conversion percentages through it.
  const actualLadder = roundLadder(buildLadder(goalCapacity, s.actual, s.termActual.slice(0, s.termCount)));

  const goalUtil = utilization(goalLadder.enrolled, s.demand);
  const actualUtil = utilization(actualLadder.enrolled, s.demand);

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

  // The cohort-metrics ladder rows (second table), goal vs actual vs attainment.
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
      {/* Anchor controls */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-sm">
          <button onClick={() => setS((p) => ({ ...p, anchor: "northstar" }))} className={`px-3 py-1.5 ${s.anchor === "northstar" ? "bg-rose-600 text-white" : "bg-white text-slate-600"}`}>Anchor: North Star</button>
          <button onClick={() => setS((p) => ({ ...p, anchor: "capacity" }))} className={`px-3 py-1.5 ${s.anchor === "capacity" ? "bg-rose-600 text-white" : "bg-white text-slate-600"}`}>Anchor: Capacity</button>
        </div>

        {s.anchor === "northstar" ? (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">North-Star goal — fully-productive workers / cohort</span>
            <input type="number" min={0} value={s.northStar} onChange={(e) => setS((p) => ({ ...p, northStar: Math.max(0, Number(e.target.value) || 0) }))} className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-right tabular-nums" />
          </label>
        ) : (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">Enrollment capacity / cohort</span>
            <input type="number" min={0} value={Math.round(s.capacity)} onChange={(e) => setS((p) => ({ ...p, capacity: Math.max(0, Number(e.target.value) || 0) }))} className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-right tabular-nums" />
          </label>
        )}

        <label className="flex items-center gap-2 text-sm">
          <span className="text-slate-500">Regional annual demand</span>
          <input type="number" min={0} value={s.demand ?? 0} onChange={(e) => setS((p) => ({ ...p, demand: Math.max(0, Number(e.target.value) || 0) || null }))} className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-right tabular-nums" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-slate-500">Terms</span>
          <input type="number" min={1} max={12} value={s.termCount} onChange={(e) => setTermCount(Number(e.target.value) || 1)} className="w-16 rounded-lg border border-slate-300 px-2 py-1.5 text-right tabular-nums" />
        </label>
        <span className="ml-auto text-[11px] text-slate-400">{saveState === "saving" ? "saving…" : saveState === "saved" ? "✓ saved" : ""}</span>
        <button onClick={resetBenchmark} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50">Reset to benchmark</button>
      </div>

      <p className="text-[11px] text-slate-400">
        {s.anchor === "northstar"
          ? "Capacity is sized backward from the North Star through the goal yields. Type any percentage — goal or actual — and the whole ladder recomputes."
          : "Enrollment capacity is the anchor; the surpluses and yields below size the rest of the ladder. Type any percentage and the whole ladder recomputes."}
        {" "}Edits are saved to {familyName}&apos;s plan automatically.
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
                  <span className="block text-[10px] text-slate-400">enrolled ÷ regional demand</span>
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

        {/* Table 2 — autocalculated cohort metrics */}
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
            <h3 className="text-sm font-semibold text-slate-700">Talent-pipeline metrics — cohort ending {s.year}</h3>
            <p className="text-[11px] text-slate-400">Autocalculated from the percentages. Goal vs actual vs attainment.</p>
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
