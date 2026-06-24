"use client";

import { useMemo, useState } from "react";
import { programDemand, DEFAULT_CONFIG, type TermArchetype, type CapacityConfig } from "@/lib/capacity";
import { fmt } from "@/lib/format";

interface Props {
  terms: TermArchetype[];
  /** Default cohort size (e.g. proposed enrollment capacity to hit North Star). */
  defaultEnrollment: number;
  /** Per-term attrition multipliers (Term 1 = 1.0). */
}

const ATTRITION = [1.0, 0.94, 0.88, 0.82, 0.76, 0.7]; // gentle decline across terms

export function CapacityWorkbench({ terms, defaultEnrollment }: Props) {
  const [enrollment, setEnrollment] = useState(defaultEnrollment || 40);
  const [fteLoad, setFteLoad] = useState(DEFAULT_CONFIG.fteWeeklyContactHours);

  const cfg: CapacityConfig = { ...DEFAULT_CONFIG, fteWeeklyContactHours: fteLoad };

  const result = useMemo(() => {
    const byTerm: Record<number, number> = {};
    terms.forEach((t, i) => {
      byTerm[t.index] = Math.round(enrollment * (ATTRITION[i] ?? ATTRITION[ATTRITION.length - 1]));
    });
    return programDemand(terms, byTerm, enrollment, cfg);
  }, [terms, enrollment, fteLoad]);

  const t = result.totals;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-6">
        <label className="block">
          <span className="stat-label">Cohort enrollment (Term 1)</span>
          <div className="mt-1 flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={120}
              value={enrollment}
              onChange={(e) => setEnrollment(Number(e.target.value))}
              className="w-56 accent-rose-600"
            />
            <input
              type="number"
              min={1}
              value={enrollment}
              onChange={(e) => setEnrollment(Math.max(1, Number(e.target.value)))}
              className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
          </div>
        </label>
        <label className="block">
          <span className="stat-label">1 FTE = weekly contact hrs</span>
          <div className="mt-1">
            <input
              type="number"
              min={1}
              value={fteLoad}
              onChange={(e) => setFteLoad(Math.max(1, Number(e.target.value)))}
              className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
          </div>
        </label>
        <p className="max-w-sm text-xs text-slate-500">
          Sessions describe <strong>one student&apos;s</strong> required experience. Rosie scales them by enrollment
          (with attrition across terms) to compute the real delivery footprint — no manual scaling.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Total sections" value={fmt.num(t.sections)} sub="class + lab + clinical" />
        <Stat label="Class sections" value={fmt.num(t.classSections)} />
        <Stat label="Lab sections" value={fmt.num(t.labSections)} />
        <Stat label="WBL / clinical slots" value={fmt.num(t.wblSlots)} accent />
        <Stat label="Faculty FTE" value={fmt.fte(t.facultyFTE)} sub="concurrent across terms" />
        <Stat label="Preceptor slots" value={fmt.num(t.preceptorInstances)} />
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Term</th>
              <th className="th text-right">Enrolled</th>
              <th className="th text-right">Class</th>
              <th className="th text-right">Lab</th>
              <th className="th text-right">Clinical / WBL</th>
              <th className="th text-right">Faculty FTE</th>
              <th className="th text-right">Preceptors</th>
              <th className="th text-right">Room-hrs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {result.terms.map((td) => (
              <tr key={td.termId}>
                <td className="td font-medium">{td.name}</td>
                <td className="td text-right">{fmt.num(td.enrollment)}</td>
                <td className="td text-right">{fmt.num(td.totals.classSections)}</td>
                <td className="td text-right">{fmt.num(td.totals.labSections)}</td>
                <td className="td text-right font-medium text-rose-700">{fmt.num(td.totals.clinicalSections)}</td>
                <td className="td text-right">{fmt.fte(td.totals.facultyFTE)}</td>
                <td className="td text-right">{fmt.num(td.totals.preceptorInstances)}</td>
                <td className="td text-right text-slate-400">{fmt.num(td.totals.roomHours)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-slate-200 bg-slate-50">
            <tr>
              <td className="td font-semibold">Program total</td>
              <td className="td"></td>
              <td className="td text-right font-semibold">{fmt.num(t.classSections)}</td>
              <td className="td text-right font-semibold">{fmt.num(t.labSections)}</td>
              <td className="td text-right font-semibold text-rose-700">{fmt.num(t.clinicalSections)}</td>
              <td className="td text-right font-semibold">{fmt.fte(t.facultyFTE)}</td>
              <td className="td text-right font-semibold">{fmt.num(t.preceptorInstances)}</td>
              <td className="td text-right font-semibold text-slate-500">{fmt.num(t.roomHours)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`card card-pad ${accent ? "ring-1 ring-rose-200" : ""}`}>
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${accent ? "text-rose-700" : ""}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}
