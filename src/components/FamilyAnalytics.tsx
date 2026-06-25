"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { type StageKey } from "@/lib/funnel";
import { buildTrajectory, buildConstellation, yearSpan } from "@/lib/goals";
import { computeHealthMetrics, aggregateStages } from "@/lib/metrics";
import { fmt } from "@/lib/format";

export interface FamCohort {
  id: string;
  name: string;
  programId: string;
  programName: string;
  gradYear: number;
  entryYear: number | null;
  status: string;
  enrolled: number;
  completers: number;
  stagesActual: Partial<Record<StageKey, number>>;
  /** Delivery footprint for this cohort (whole program at its enrollment). */
  facultyFte: number;
  preceptorFte: number;
  facultyHours: number;
  preceptorHours: number;
}

const STATUS_COLOR: Record<string, string> = { active: "#10b981", completed: "#64748b", planned: "#0ea5e9", archived: "#cbd5e1" };
const PROG_COLORS = ["#e11d48", "#7c3aed", "#0891b2", "#ca8a04", "#0d9488"];

export function FamilyAnalytics({
  cohorts, demandByYear, goalByYear, templates,
}: {
  cohorts: FamCohort[];
  demandByYear: Record<number, number>;
  goalByYear: Record<number, number>;
  templates: { id: string; name: string }[];
}) {
  const [template, setTemplate] = useState<string>("all");
  const [year, setYear] = useState<number | null>(null);
  const [view, setView] = useState<"time" | "cohort">("time");

  const progColor = (id: string) => PROG_COLORS[Math.max(0, templates.findIndex((t) => t.id === id)) % PROG_COLORS.length];

  // Filter scope.
  const scoped = useMemo(() => cohorts.filter((c) => (template === "all" || c.programId === template) && (year == null || c.gradYear === year)), [cohorts, template, year]);

  // Produced per grad year (filtered by template only — year filter is for drill).
  const tplScoped = useMemo(() => cohorts.filter((c) => template === "all" || c.programId === template), [cohorts, template]);
  const producedByYear = useMemo(() => {
    const m: Record<number, number> = {};
    for (const c of tplScoped) m[c.gradYear] = (m[c.gradYear] ?? 0) + c.completers;
    return m;
  }, [tplScoped]);

  const years = useMemo(() => yearSpan([...Object.keys(demandByYear), ...Object.keys(goalByYear), ...tplScoped.map((c) => c.gradYear)].map(Number)), [demandByYear, goalByYear, tplScoped]);
  const trajectory = useMemo(() => buildTrajectory(years.map((y) => ({ year: y, demand: demandByYear[y] ?? null, goal: goalByYear[y] ?? null, produced: producedByYear[y] ?? null }))), [years, demandByYear, goalByYear, producedByYear]);
  const maxVal = Math.max(1, ...trajectory.flatMap((p) => [p.demand ?? 0, p.goal ?? 0, p.produced ?? 0]));

  // Health metrics for the scope (drill-aware).
  const health = useMemo(() => {
    const agg = aggregateStages(scoped.map((c) => c.stagesActual));
    const demand = year != null ? demandByYear[year] : undefined;
    return computeHealthMetrics(agg, demand ?? undefined);
  }, [scoped, year, demandByYear]);

  // Delivery footprint per year — sum FTE of cohorts ACTIVE that year (entry→grad
  // overlap), so the resource cost sits beside the production goals.
  const deliveryByYear = useMemo(() => {
    const m: Record<number, { facFte: number; precFte: number; facHrs: number; active: number }> = {};
    for (const y of years) {
      let facFte = 0, precFte = 0, facHrs = 0, active = 0;
      for (const c of tplScoped) {
        const ey = c.entryYear ?? c.gradYear - 2;
        if (ey <= y && y <= c.gradYear) { facFte += c.facultyFte; precFte += c.preceptorFte; facHrs += c.facultyHours; active += 1; }
      }
      m[y] = { facFte, precFte, facHrs, active };
    }
    return m;
  }, [years, tplScoped]);
  const maxFte = Math.max(0.1, ...years.map((y) => (deliveryByYear[y]?.facFte ?? 0) + (deliveryByYear[y]?.precFte ?? 0)));

  const constellation = useMemo(() => buildConstellation(scoped.map((c) => ({ id: c.id, name: c.name, programId: c.programId, programName: c.programName, entryYear: c.entryYear, gradYear: c.gradYear, enrolled: c.enrolled, completers: c.completers, status: c.status }))), [scoped]);
  const constYears = useMemo(() => yearSpan(constellation.flatMap((b) => [b.entryYear, b.gradYear])), [constellation]);

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Disaggregate</span>
        <select value={template} onChange={(e) => setTemplate(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
          <option value="all">All templates</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-sm">
          <button onClick={() => setView("time")} className={`px-3 py-1.5 ${view === "time" ? "bg-rose-600 text-white" : "bg-white text-slate-600"}`}>Time series</button>
          <button onClick={() => setView("cohort")} className={`px-3 py-1.5 ${view === "cohort" ? "bg-rose-600 text-white" : "bg-white text-slate-600"}`}>By cohort</button>
        </div>
        {year != null && <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-medium text-rose-700">Year: {year} <button onClick={() => setYear(null)} className="ml-1 opacity-70 hover:opacity-100">✕</button></span>}
        <span className="ml-auto text-xs text-slate-400">{scoped.length} cohort{scoped.length === 1 ? "" : "s"} in scope</span>
      </div>

      {view === "time" ? (
        <>
          {/* Multi-year trajectory — produced vs goal vs demand. Click a year to drill. */}
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">Multi-year workforce trajectory</h2>
              <div className="flex items-center gap-3 text-[11px] text-slate-500">
                <Legend c="#cbd5e1" t="regional demand" /><Legend c="#64748b" t="goal" /><Legend c="#e11d48" t="produced" />
                <span className="text-slate-400">click a year to drill</span>
              </div>
            </div>
            <div className="flex items-end gap-2 overflow-x-auto pb-1" style={{ height: 200 }}>
              {trajectory.map((p) => {
                const h = (v: number | null) => `${((v ?? 0) / maxVal) * 150}px`;
                const active = year === p.year;
                return (
                  <button key={p.year} onClick={() => setYear(active ? null : p.year)} className={`group flex min-w-[58px] flex-1 flex-col items-center rounded-lg px-1 pt-1 ${active ? "bg-rose-50 ring-1 ring-rose-300" : "hover:bg-slate-50"}`} title={`${p.year}: produced ${fmt.num(p.produced)} / goal ${fmt.num(p.goal)} / demand ${fmt.num(p.demand)}`}>
                    <span className="flex flex-1 items-end gap-0.5">
                      <span className="block w-2.5 rounded-t bg-slate-200" style={{ height: h(p.demand) }} />
                      <span className="block w-2.5 rounded-t bg-slate-500" style={{ height: h(p.goal) }} />
                      <span className="block w-2.5 rounded-t" style={{ height: h(p.produced), background: p.onTrack === false ? "#f43f5e" : "#e11d48" }} />
                    </span>
                    <span className="mt-1 block text-[11px] font-semibold tabular-nums text-slate-700">{p.year}</span>
                    <span className="block text-[9px] tabular-nums text-slate-400">{fmt.num(p.produced)}/{fmt.num(p.goal)}</span>
                  </button>
                );
              })}
            </div>
            {/* cumulative gap callout */}
            {trajectory.length > 0 && (() => {
              const last = trajectory[trajectory.length - 1];
              const gap = last.cumulativeProduced - last.cumulativeGoal;
              return (
                <div className={`mt-3 rounded-lg px-3 py-2 text-xs ${gap >= 0 ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
                  Cumulative through {last.year}: <strong>{fmt.num(last.cumulativeProduced)}</strong> produced vs <strong>{fmt.num(last.cumulativeGoal)}</strong> goal —
                  {gap >= 0 ? ` ${fmt.num(gap)} ahead.` : ` ${fmt.num(-gap)} behind the multi-year goal.`}
                </div>
              );
            })()}
          </section>

          {/* Delivery footprint — staffing FTE demand across overlapping cohorts, same year axis */}
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">Delivery footprint — staffing demand</h2>
              <div className="flex items-center gap-3 text-[11px] text-slate-500">
                <Legend c="#e11d48" t="faculty FTE" /><Legend c="#7c3aed" t="preceptor FTE" />
                <span className="text-slate-400">FTE needed across all cohorts running that year</span>
              </div>
            </div>
            <div className="flex items-end gap-2 overflow-x-auto pb-1" style={{ height: 150 }}>
              {years.map((y) => {
                const d = deliveryByYear[y] ?? { facFte: 0, precFte: 0, facHrs: 0, active: 0 };
                const hf = `${(d.facFte / maxFte) * 105}px`;
                const hp = `${(d.precFte / maxFte) * 105}px`;
                return (
                  <div key={y} className="flex min-w-[58px] flex-1 flex-col items-center" title={`${y}: ${d.active} active cohort(s) · ${d.facFte.toFixed(2)} faculty FTE · ${d.precFte.toFixed(2)} preceptor FTE · ${fmt.num(d.facHrs)} faculty contact hrs`}>
                    <div className="flex flex-1 flex-col justify-end">
                      <div className="w-7 rounded-t bg-violet-500" style={{ height: hp }} />
                      <div className="w-7 bg-rose-600" style={{ height: hf }} />
                    </div>
                    <div className="mt-1 text-[11px] font-semibold tabular-nums text-slate-700">{y}</div>
                    <div className="text-[9px] tabular-nums text-slate-400">{(d.facFte + d.precFte).toFixed(1)} FTE</div>
                  </div>
                );
              })}
            </div>
            <p className="mt-1 text-[11px] text-slate-400">Because cohorts overlap (a class runs ~2 years), peak staffing demand is the sum of every cohort active that year — read alongside the production goals above.</p>
          </section>

          {/* Per-year detail table */}
          <section className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2">Year</th><th className="px-4 py-2 text-right">Demand</th><th className="px-4 py-2 text-right">Goal</th><th className="px-4 py-2 text-right">Produced</th><th className="px-4 py-2 text-right">vs goal</th><th className="px-4 py-2 text-right">% of goal</th><th className="px-4 py-2 text-right">% of demand</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {trajectory.map((p) => (
                  <tr key={p.year} className={`cursor-pointer hover:bg-slate-50 ${year === p.year ? "bg-rose-50/40" : ""}`} onClick={() => setYear(year === p.year ? null : p.year)}>
                    <td className="px-4 py-2 font-medium">{p.year}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-500">{fmt.num(p.demand)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600">{fmt.num(p.goal)}</td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums">{fmt.num(p.produced)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{p.gapVsGoal != null ? <span className={p.gapVsGoal >= 0 ? "text-emerald-600" : "text-rose-600"}>{p.gapVsGoal >= 0 ? "+" : ""}{fmt.num(p.gapVsGoal)}</span> : "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{p.goalAttainment != null ? fmt.pct(p.goalAttainment) : "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-500">{p.demandCoverage != null ? fmt.pct(p.demandCoverage) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : (
        /* Cohort constellation — entry→grad bars across years */
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Cohort constellation {year != null ? `· ${year}` : ""}</h2>
          {constellation.length === 0 ? <p className="text-sm text-slate-400">No cohorts in scope.</p> : (
            <div className="space-y-1.5">
              {/* year axis */}
              <div className="flex gap-1 pl-44 text-[10px] text-slate-400">
                {constYears.map((y) => <div key={y} className="flex-1 text-center">{y}</div>)}
              </div>
              {constellation.map((b) => {
                const lo = constYears[0], span = constYears.length;
                const left = ((b.entryYear - lo) / span) * 100;
                const width = (Math.max(1, b.gradYear - b.entryYear + 1) / span) * 100;
                return (
                  <div key={b.id} className="flex items-center gap-2">
                    <Link href={`/programs/${b.programId}`} className="w-44 shrink-0 truncate text-xs text-slate-600 hover:text-rose-700">{b.name}</Link>
                    <div className="relative h-7 flex-1 rounded bg-slate-50">
                      <div className="absolute top-0 flex h-7 items-center rounded px-2 text-[10px] font-medium text-white" style={{ left: `${left}%`, width: `${width}%`, minWidth: 60, background: progColor(b.programId) }} title={`${b.programName} · ${b.enrolled} enrolled · ${b.completers} completers · ${b.status}`}>
                        <span className="truncate">{b.enrolled}→{b.completers}</span>
                        <span className="ml-auto h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[b.status ?? ""] ?? "#fff" }} />
                      </div>
                    </div>
                  </div>
                );
              })}
              <div className="flex flex-wrap gap-3 pt-2 text-[10px] text-slate-500">
                {templates.map((t) => <Legend key={t.id} c={progColor(t.id)} t={t.name} />)}
                <span className="text-slate-300">|</span>
                {Object.entries(STATUS_COLOR).filter(([k]) => k !== "archived").map(([k, c]) => <span key={k} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: c }} />{k}</span>)}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Talent-pipeline health metrics (drill-aware) */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Talent-pipeline health metrics {year != null ? `· ${year}` : template !== "all" ? `· ${templates.find((t) => t.id === template)?.name}` : "· all cohorts"}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {health.map((m) => (
            <div key={m.key} className={`rounded-xl border bg-white p-4 ${m.healthy === false ? "border-amber-200 ring-1 ring-amber-100" : "border-slate-200"}`}>
              <div className="text-[11px] font-medium leading-tight text-slate-500">{m.label}</div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className={`text-2xl font-bold tabular-nums ${m.healthy === false ? "text-amber-600" : "text-slate-900"}`}>{m.ratio != null ? (m.benchmark < 1.05 && m.den !== "demand" && m.key !== "interestedSurplus" && m.key !== "qualifiedSurplus" && m.key !== "offeredSurplus" ? fmt.pct(m.ratio) : m.ratio.toFixed(2)) : "—"}</span>
                <span className="text-[11px] text-slate-400">vs {m.benchmark < 1.05 ? fmt.pct(m.benchmark) : m.benchmark.toFixed(2)}</span>
              </div>
              {m.healthy != null && <div className={`mt-0.5 text-[10px] font-medium ${m.healthy ? "text-emerald-600" : "text-amber-600"}`}>{m.healthy ? "at/above benchmark" : "below benchmark"}</div>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Legend({ c, t }: { c: string; t: string }) {
  return <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm" style={{ background: c }} />{t}</span>;
}
