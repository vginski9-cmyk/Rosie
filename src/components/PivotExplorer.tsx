"use client";

import { useMemo, useState } from "react";
import { pivot, distinct, applyFilters, DIMS, type Fact, type Dim, type Measure, type Filters, dimValue } from "@/lib/pivot";

const fmtN = (v: number) => {
  if (v === 0) return "—";
  const abs = Math.abs(v);
  return v.toLocaleString(undefined, { maximumFractionDigits: abs < 100 ? 2 : 0 });
};

export function PivotExplorer({
  facts, hideDims = [], defaultRowDim = "program", defaultColDim = "year", defaultMetric = "Enrolled (Term 1)",
}: {
  facts: Fact[];
  /** Dimensions to remove from the row/column pickers (e.g. when scoped to one family). */
  hideDims?: Dim[];
  defaultRowDim?: Dim;
  defaultColDim?: Dim;
  defaultMetric?: string;
}) {
  const dims = useMemo(() => DIMS.filter((d) => !hideDims.includes(d.key)), [hideDims]);
  const [rowDim, setRowDim] = useState<Dim>(defaultRowDim);
  const [colDim, setColDim] = useState<Dim>(defaultColDim);
  const [measure, setMeasure] = useState<Measure>("value");
  const [group, setGroup] = useState<string>("Pipeline");
  const [metric, setMetric] = useState<string>(defaultMetric);
  const [filters, setFilters] = useState<Filters>({});
  const [drill, setDrill] = useState<{ row: string; col: string } | null>(null);

  // Compose the active filter set (group + metric + ad-hoc header filters).
  const effFilters: Filters = useMemo(() => {
    const f: Filters = { ...filters };
    if (group !== "All") f.metricGroup = new Set([group]);
    if (metric !== "All") f.metric = new Set([metric]);
    return f;
  }, [filters, group, metric]);

  const metricOptions = useMemo(() => {
    const scoped = group === "All" ? facts : facts.filter((x) => x.metricGroup === group);
    return distinct(scoped, "metric");
  }, [facts, group]);

  const p = useMemo(() => pivot(facts, rowDim, colDim, measure, effFilters), [facts, rowDim, colDim, measure, effFilters]);
  const maxRowTotal = Math.max(1, ...Object.values(p.rowTotals));

  const toggleFilter = (d: Dim, val: string) => setFilters((prev) => {
    const cur = new Set(prev[d] ?? []);
    cur.has(val) ? cur.delete(val) : cur.add(val);
    const next = { ...prev };
    if (cur.size) next[d] = cur; else delete next[d];
    return next;
  });
  const adHocChips = (Object.entries(filters) as [Dim, Set<string>][]).flatMap(([d, s]) => [...s].map((v) => ({ d, v })));

  const drillFacts = useMemo(() => {
    if (!drill) return [];
    return applyFilters(facts, { ...effFilters, [rowDim]: new Set([drill.row]), [colDim]: new Set([drill.col]) });
  }, [drill, facts, effFilters, rowDim, colDim]);

  const measureNote = group === "All" ? "mixing metric groups — totals are illustrative only" : group === "Delivery" ? "delivery requirement (FTE / hours / sections)" : "pipeline count (people)";

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <Ctl label="Metric group">
          <select value={group} onChange={(e) => { setGroup(e.target.value); setMetric("All"); }} className="ctl">
            <option>All</option><option>Pipeline</option><option>Delivery</option>
          </select>
        </Ctl>
        <Ctl label="Metric">
          <select value={metric} onChange={(e) => setMetric(e.target.value)} className="ctl w-56">
            <option value="All">All metrics in group</option>
            {metricOptions.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Ctl>
        <span className="self-end pb-2 text-slate-300">│</span>
        <Ctl label="Rows"><select value={rowDim} onChange={(e) => setRowDim(e.target.value as Dim)} className="ctl">{dims.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</select></Ctl>
        <Ctl label="Columns"><select value={colDim} onChange={(e) => setColDim(e.target.value as Dim)} className="ctl">{dims.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</select></Ctl>
        <Ctl label="Measure">
          <select value={measure} onChange={(e) => setMeasure(e.target.value as Measure)} className="ctl">
            <option value="value">Value</option><option value="actual">Actual</option><option value="target">Target</option>
          </select>
        </Ctl>
        <span className="self-end pb-2 text-[11px] text-slate-400">{measureNote}</span>
        <style>{`.ctl{border:1px solid #cbd5e1;border-radius:8px;padding:6px 8px;font-size:13px;background:#fff}`}</style>
      </div>

      {/* Active ad-hoc filter chips */}
      {adHocChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400">Filters:</span>
          {adHocChips.map(({ d, v }) => (
            <button key={d + v} onClick={() => toggleFilter(d, v)} className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-1 font-medium text-rose-700">
              {DIMS.find((x) => x.key === d)?.label}: {v} <span className="opacity-70">✕</span>
            </button>
          ))}
          <button onClick={() => setFilters({})} className="text-slate-400 hover:text-rose-600">clear all</button>
        </div>
      )}

      {/* Pivot grid */}
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left">{DIMS.find((d) => d.key === rowDim)?.label}</th>
              {p.colKeys.map((c) => (
                <th key={c} className="cursor-pointer px-3 py-2 text-right font-semibold hover:bg-rose-50" onClick={() => toggleFilter(colDim, c)} title="click to filter">{c}</th>
              ))}
              <th className="bg-slate-100 px-3 py-2 text-right font-bold text-slate-600">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {p.rowKeys.map((r) => (
              <tr key={r} className="hover:bg-slate-50/60">
                <td className="sticky left-0 z-10 cursor-pointer bg-white px-3 py-1.5 font-medium text-slate-700 hover:text-rose-700" onClick={() => toggleFilter(rowDim, r)} title="click to filter">
                  <span className="flex items-center gap-2">
                    <span className="inline-block h-1.5 rounded-full bg-rose-200" style={{ width: `${(p.rowTotals[r] / maxRowTotal) * 40}px` }} />
                    {r}
                  </span>
                </td>
                {p.colKeys.map((c) => {
                  const v = p.get(r, c);
                  return <td key={c} className={`px-3 py-1.5 text-right tabular-nums ${v ? "cursor-pointer text-slate-700 hover:bg-rose-50" : "text-slate-300"}`} onClick={() => v && setDrill({ row: r, col: c })}>{fmtN(v)}</td>;
                })}
                <td className="bg-slate-50 px-3 py-1.5 text-right font-semibold tabular-nums">{fmtN(p.rowTotals[r])}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 bg-slate-100 font-semibold">
              <td className="sticky left-0 z-10 bg-slate-100 px-3 py-2 text-slate-600">Total</td>
              {p.colKeys.map((c) => <td key={c} className="px-3 py-2 text-right tabular-nums text-slate-700">{fmtN(p.colTotals[c])}</td>)}
              <td className="bg-slate-200 px-3 py-2 text-right tabular-nums text-slate-900">{fmtN(p.grand)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-[11px] text-slate-400">Click a row or column header to filter; click a cell to see the underlying facts. {p.rowKeys.length} × {p.colKeys.length} grid.</p>

      {/* Drill drawer */}
      {drill && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setDrill(null)}>
          <div className="absolute inset-0 bg-slate-900/30" />
          <div className="relative z-10 h-full w-full max-w-md overflow-y-auto border-l border-slate-200 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="text-sm font-semibold">{drill.row} · {drill.col}</div>
              <button onClick={() => setDrill(null)} className="text-slate-400 hover:text-slate-700">✕</button>
            </div>
            <p className="mt-2 text-xs text-slate-500">{drillFacts.length} facts behind this cell</p>
            <div className="mt-3 space-y-1.5">
              {drillFacts.map((f, i) => (
                <div key={i} className="rounded-lg border border-slate-100 bg-slate-50/60 p-2 text-[12px]">
                  <div className="font-medium text-slate-700">{f.metric} <span className="font-normal text-slate-400">· {f.metricGroup}</span></div>
                  <div className="text-slate-500">{f.institution} · {f.program} · {f.cohort}{f.term ? ` · ${f.term}` : ""}{f.year ? ` · ${f.year}` : ""}</div>
                  <div className="mt-0.5 tabular-nums text-slate-600">value {fmtN(f.value)}{f.target != null ? ` · target ${fmtN(f.target)}` : ""}{f.actual != null ? ` · actual ${fmtN(f.actual)}` : ""}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Ctl({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>{children}</label>;
}
