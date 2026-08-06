"use client";

import { useMemo, useState } from "react";
import {
  ladderPivot, healthFromPivot, yearSeasonPivot, yoyChange, deriveCohortTargets,
  PIPELINE_METRICS, type PipelineFact, type PipelineMetricKey,
} from "@/lib/pipeline";
import type { LadderRates } from "@/lib/northstar";

// The talent-pipeline analytics board — the institution workbook's three output
// surfaces on one page, computed live from the same facts:
//   1. the funnel-ladder pivot (metric rows, nested per-term enrollment, Grand
//      Total, target vs actual) — the "TALENT PIPELINE HEALTH METRICS" pivot;
//   2. the health-ratio block computed FROM the pivot's own aggregates, with
//      every numerator ÷ denominator shown — the staged-cells block;
//   3. the Year → Season pivot for any one metric — "OUTPUT VISUAL_PROGRAM
//      STRUCTURE" — plus the Y-O-Y change table.
// A lineage toggle on every row answers "where is this number sourced from?"

export interface ProgramOpt { id: string; name: string; credential: string | null }
export interface CohortOpt { id: string; name: string; programId: string; endYear: number }

const fmtT = (v: number | null) => (v == null ? "—" : (Math.round(v * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const fmtA = (v: number | null) => (v == null ? "—" : Math.round(v).toLocaleString());
const fmtR = (v: number | null) => (v == null ? "—" : (Math.round(v * 100) / 100).toFixed(2));
const fmtPct = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${Math.round(v * 100)}%`);

function attainCls(actual: number | null, target: number | null): string {
  if (actual == null || target == null || target === 0) return "text-slate-400";
  const a = actual / target;
  if (a >= 1) return "text-emerald-600";
  if (a >= 0.85) return "text-amber-600";
  return "text-rose-600";
}

export function PipelineAnalytics({
  institution, familyName, programs, cohorts, facts, rates, nowYear,
}: {
  institution: string;
  familyName: string;
  programs: ProgramOpt[];
  cohorts: CohortOpt[];
  facts: PipelineFact[];
  rates: LadderRates;
  nowYear: number;
}) {
  const [programId, setProgramId] = useState<string>("all");
  const [cohortId, setCohortId] = useState<string>("all");
  const [visualMetric, setVisualMetric] = useState<PipelineMetricKey>("qualified");
  const [lineage, setLineage] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);

  const cohortOpts = useMemo(
    () => cohorts.filter((c) => programId === "all" || c.programId === programId),
    [cohorts, programId],
  );

  const filtered = useMemo(
    () => facts.filter((f) => (programId === "all" || f.programId === programId) && (cohortId === "all" || f.cohortId === cohortId)),
    [facts, programId, cohortId],
  );

  const pivot = useMemo(() => ladderPivot(filtered), [filtered]);
  const health = useMemo(() => healthFromPivot(pivot), [pivot]);
  const visual = useMemo(() => yearSeasonPivot(filtered, visualMetric), [filtered, visualMetric]);
  const yoy = useMemo(() => yoyChange(filtered), [filtered]);

  // The derivation waterfall: because every cohort's targets are derived with
  // the SAME family rates and the chain is linear, deriving from the summed
  // goal is exactly the sum of the per-cohort derivations.
  const scopeGoal = useMemo(() => {
    const rows = filtered.filter((f) => f.metric === "productive");
    return rows.length ? rows.reduce((s, f) => s + (f.target ?? 0), 0) : 0;
  }, [filtered]);
  const scopeTerms = useMemo(() => {
    const t = filtered.filter((f) => f.metric === "term").map((f) => f.termIndex ?? 0);
    return t.length ? Math.max(...t) : 5;
  }, [filtered]);
  const chain = useMemo(() => deriveCohortTargets(scopeGoal, rates, scopeTerms).chain, [scopeGoal, rates, scopeTerms]);

  const rowKey = (m: string, ti: number | null) => `${m}:${ti ?? ""}`;

  return (
    <div className="space-y-8">
      {/* ── Filter header (the pivot's filter row) ─────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Institution</div>
            <div className="mt-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700">{institution}</div>
          </div>
          <label className="block">
            <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Program</span>
            <select value={programId} onChange={(e) => { setProgramId(e.target.value); setCohortId("all"); }} className="mt-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm">
              <option value="all">All — {familyName}</option>
              {programs.map((p) => <option key={p.id} value={p.id}>{p.name}{p.credential ? ` (${p.credential})` : ""}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Cohort</span>
            <select value={cohortId} onChange={(e) => setCohortId(e.target.value)} className="mt-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm">
              <option value="all">{cohortOpts.length > 1 ? "All cohorts (multiple items)" : "All cohorts"}</option>
              {cohortOpts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={lineage} onChange={(e) => setLineage(e.target.checked)} className="h-3.5 w-3.5 accent-rose-600" />
            Show where every number is sourced from
          </label>
        </div>
      </section>

      {/* ── 1. Funnel-ladder pivot ─────────────────────────────────────────── */}
      <section className="space-y-2">
        <div>
          <h2 className="text-lg font-semibold">Talent-pipeline ladder — target vs actual</h2>
          <p className="text-sm text-slate-500">
            Every stage of the funnel for the {cohortId === "all" ? `${pivot.cohorts.length} cohort${pivot.cohorts.length === 1 ? "" : "s"} in scope` : "selected cohort"},
            with term-by-term enrollment nested under capacity. Targets are derived from each cohort&apos;s North-Star goal;
            actuals come live from the student records. Click a row to see each cohort&apos;s share.
          </p>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 font-semibold">Pipeline stage</th>
                <th className="px-3 py-2 text-right font-semibold">Target (normalized)</th>
                <th className="px-3 py-2 text-right font-semibold">Actual (normalized)</th>
                <th className="px-3 py-2 text-right font-semibold">Attainment</th>
                {lineage && <th className="px-3 py-2 font-semibold">Target sourced from</th>}
              </tr>
            </thead>
            <tbody>
              {pivot.rows.map((r) => {
                const k = rowKey(r.metric, r.termIndex);
                const open = openRow === k;
                const attain = r.actual != null && r.target ? r.actual / r.target : null;
                const src = filtered.find((f) => f.metric === r.metric && f.termIndex === r.termIndex)?.targetSource ?? "";
                return [
                  <tr key={k} onClick={() => setOpenRow(open ? null : k)} className={`cursor-pointer border-b border-slate-100 hover:bg-rose-50/40 ${r.nested ? "bg-slate-50/50" : ""}`}>
                    <td className={`px-3 py-1.5 ${r.nested ? "pl-8 text-slate-500" : "font-medium text-slate-800"}`}>
                      {r.nested ? "↳ " : ""}{r.label}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{fmtT(r.target)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{fmtA(r.actual)}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${attainCls(r.actual, r.target)}`}>{attain == null ? "—" : `${Math.round(attain * 100)}%`}</td>
                    {lineage && <td className="px-3 py-1.5 text-xs text-slate-400">{src}</td>}
                  </tr>,
                  open && r.parts.length > 1 ? (
                    <tr key={`${k}-parts`} className="border-b border-slate-100 bg-amber-50/40">
                      <td colSpan={lineage ? 5 : 4} className="px-8 py-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">How this row adds up</div>
                        <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
                          {r.parts.map((p) => (
                            <span key={p.cohort} className="tabular-nums">{p.cohort}: <strong>{fmtT(p.target)}</strong> target{p.actual != null ? <> · {fmtA(p.actual)} actual</> : null}</span>
                          ))}
                          <span className="tabular-nums text-slate-800">Σ = <strong>{fmtT(r.target)}</strong></span>
                        </div>
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
              <tr className="bg-slate-100/80 font-semibold text-slate-800">
                <td className="px-3 py-2">Grand Total</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtT(pivot.grandTotalTarget)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtA(pivot.grandTotalActual)}</td>
                <td className="px-3 py-2" />
                {lineage && <td className="px-3 py-2 text-xs font-normal text-slate-400">sum of every normalized row above (terms included)</td>}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 2. Health ratios from the pivot's aggregates ───────────────────── */}
      <section className="space-y-2">
        <div>
          <h2 className="text-lg font-semibold">Talent-pipeline health metrics</h2>
          <p className="text-sm text-slate-500">
            Each ratio is computed from the ladder rows above — the same aggregates, restated as numerator ÷ denominator —
            and judged against its benchmark. Nothing here is entered separately: change the goal or the student data and
            these move with it.
          </p>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 font-semibold">Health metric</th>
                <th className="px-3 py-2 font-semibold">Computed as</th>
                <th className="px-3 py-2 text-right font-semibold">Goal plan</th>
                <th className="px-3 py-2 text-right font-semibold">Actual</th>
                <th className="px-3 py-2 text-right font-semibold">Benchmark</th>
                <th className="px-3 py-2 text-center font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {health.map((h) => (
                <tr key={h.key} className="border-b border-slate-100">
                  <td className="px-3 py-1.5 font-medium text-slate-800">{h.label}</td>
                  <td className="px-3 py-1.5 text-xs text-slate-500">
                    {h.formula}
                    {lineage && (
                      <span className="ml-1 tabular-nums text-slate-400">
                        (goal {fmtT(h.targetNum)} ÷ {fmtT(h.targetDen)}{h.actualRatio != null ? <> · actual {fmtA(h.actualNum)} ÷ {fmtA(h.actualDen)}</> : null})
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{fmtR(h.targetRatio)}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${h.healthy == null ? "text-slate-400" : h.healthy ? "text-emerald-600" : "text-rose-600"}`}>{fmtR(h.actualRatio)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{fmtR(h.benchmark)}</td>
                  <td className="px-3 py-1.5 text-center">
                    {h.healthy == null ? <span className="text-slate-300">·</span> : h.healthy ? <span className="text-emerald-500">●</span> : <span className="text-rose-500">●</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 3. How the targets are derived (the backward chain) ────────────── */}
      <section className="space-y-2">
        <div>
          <h2 className="text-lg font-semibold">How the targets add up</h2>
          <p className="text-sm text-slate-500">
            Targets are not entered stage by stage — the whole ladder is derived backward from one number, the North-Star
            productivity goal, by dividing out each rate in the family&apos;s goal plan. This is the full chain for the
            {cohortId === "all" ? " cohorts in scope (goals summed)" : " selected cohort"}.
          </p>
        </div>
        <ol className="space-y-1.5">
          {chain.map((s, i) => (
            <li key={s.key + i} className="flex flex-wrap items-baseline gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
              <span className="w-6 text-right text-xs tabular-nums text-slate-400">{i + 1}.</span>
              <span className="font-medium text-slate-800">{s.label}</span>
              <span className="tabular-nums font-semibold text-rose-700">{fmtT(s.value)}</span>
              <span className="text-xs text-slate-500">{s.formula}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* ── 4. Year → Season pivot ─────────────────────────────────────────── */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">Pipeline by year &amp; season</h2>
            <p className="text-sm text-slate-500">One metric, pivoted by the year each cohort lands its graduates and the season it starts — the workbook&apos;s program-structure visual.</p>
          </div>
          <label className="block">
            <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Metric</span>
            <select value={visualMetric} onChange={(e) => setVisualMetric(e.target.value as PipelineMetricKey)} className="mt-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm">
              {PIPELINE_METRICS.map((m) => <option key={m.key} value={m.key}>{m.key === "term" ? "Term 1 enrollment" : m.label}</option>)}
            </select>
          </label>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 font-semibold">Year → season</th>
                <th className="px-3 py-2 text-right font-semibold">Target (normalized)</th>
                <th className="px-3 py-2 text-right font-semibold">Actual (normalized)</th>
                {lineage && <th className="px-3 py-2 font-semibold">Cohorts in this cell</th>}
              </tr>
            </thead>
            <tbody>
              {visual.rows.map((y) => [
                <tr key={y.year} className="border-b border-slate-100 bg-slate-50/60 font-medium text-slate-800">
                  <td className="px-3 py-1.5">{y.year}{y.year === nowYear ? <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700">now</span> : null}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtT(y.target)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtA(y.actual)}</td>
                  {lineage && <td />}
                </tr>,
                ...y.seasons.map((s) => (
                  <tr key={`${y.year}-${s.season}`} className="border-b border-slate-100">
                    <td className="px-3 py-1.5 pl-8 text-slate-500">↳ {s.season}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{fmtT(s.target)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{fmtA(s.actual)}</td>
                    {lineage && <td className="px-3 py-1.5 text-xs text-slate-400">{[...new Set(s.cohorts)].join(" · ")}</td>}
                  </tr>
                )),
              ])}
              <tr className="bg-slate-100/80 font-semibold text-slate-800">
                <td className="px-3 py-2">Grand Total</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtT(visual.grandTotalTarget)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtA(visual.grandTotalActual)}</td>
                {lineage && <td />}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 5. Y-O-Y change ────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <div>
          <h2 className="text-lg font-semibold">Year-over-year change in pipeline targets</h2>
          <p className="text-sm text-slate-500">How each stage&apos;s target steps between cohort years — (year ÷ prior year) − 1. This is where a stairstep goal shows up as growth the pipeline has to absorb.</p>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 font-semibold">Metric</th>
                {yoy.years.map((y) => <th key={y} className="px-3 py-2 text-right font-semibold">{y}</th>)}
              </tr>
            </thead>
            <tbody>
              {yoy.rows.map((r) => (
                <tr key={r.metric} className="border-b border-slate-100">
                  <td className="px-3 py-1.5 font-medium text-slate-800">{r.label}</td>
                  {r.changes.map((c, i) => (
                    <td key={i} className={`px-3 py-1.5 text-right tabular-nums ${c == null ? "text-slate-300" : c > 0 ? "text-emerald-600" : c < 0 ? "text-rose-600" : "text-slate-500"}`}>{fmtPct(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
