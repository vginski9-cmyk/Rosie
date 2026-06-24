"use client";

import { analyzeFunnel, type StageKey } from "@/lib/funnel";
import { fmt } from "@/lib/format";

export interface FunnelStageInput {
  key: StageKey;
  label: string;
  target?: number | null;
  actual?: number | null;
}

export function FunnelChart({ stages }: { stages: FunnelStageInput[] }) {
  const analysis = analyzeFunnel(stages);
  const maxVal = Math.max(1, ...analysis.map((a) => Math.max(a.target ?? 0, a.actual ?? 0)));
  const pct = (v?: number | null) => `${Math.max(2, ((v ?? 0) / maxVal) * 100)}%`;

  return (
    <div className="space-y-6">
      {/* The actual funnel — centered, tapering */}
      <div className="space-y-1.5">
        {analysis.map((a) => {
          const innerPct = a.target && a.actual != null ? `${Math.min(100, (a.actual / a.target) * 100)}%` : "0%";
          return (
            <div key={a.key} className="flex items-center gap-3">
              <div className="w-48 shrink-0 text-right text-[13px] leading-tight text-slate-600">{a.label}</div>
              <div className="relative flex-1">
                <div className="relative mx-auto flex h-12 items-center justify-center rounded-md" style={{ width: pct(a.target), background: `${a.color}26` }}>
                  <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 rounded-md" style={{ width: innerPct, background: a.color }} />
                  <span className="relative z-10 text-xs font-semibold text-slate-800">
                    {fmt.num(a.actual)} <span className="font-normal text-slate-400">/ {fmt.num(a.target)}</span>
                  </span>
                </div>
              </div>
              <div className="w-24 shrink-0 text-left text-[11px] leading-tight">
                {a.attainment != null ? (
                  <span className={a.attainment < 1 ? "text-rose-600" : "text-emerald-600"}>{fmt.pct(a.attainment)} of goal</span>
                ) : <span className="text-slate-300">—</span>}
                {a.targetConversion != null && <div className="text-slate-400">{fmt.pct(a.targetConversion)} convert</div>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-center gap-6 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1"><span className="h-3 w-6 rounded bg-slate-300/40" /> target (plan)</span>
        <span className="inline-flex items-center gap-1"><span className="h-3 w-6 rounded bg-rose-500" /> actual</span>
      </div>

      {/* Detail table */}
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Stage</th>
              <th className="th text-right">Target</th>
              <th className="th text-right">Actual</th>
              <th className="th text-right">Plan conv.</th>
              <th className="th text-right">Actual conv.</th>
              <th className="th text-right">Attainment</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {analysis.map((a) => (
              <tr key={a.key}>
                <td className="td font-medium">{a.label}</td>
                <td className="td text-right">{fmt.num(a.target, 0)}</td>
                <td className="td text-right">{fmt.num(a.actual, 0)}</td>
                <td className="td text-right text-slate-400">{a.targetConversion != null ? fmt.pct(a.targetConversion) : "—"}</td>
                <td className="td text-right">{a.actualConversion != null ? <span className={a.targetConversion != null && a.actualConversion < a.targetConversion ? "text-rose-600" : "text-emerald-600"}>{fmt.pct(a.actualConversion)}</span> : "—"}</td>
                <td className="td text-right">{a.attainment != null ? <span className={a.attainment < 1 ? "text-rose-600" : "text-emerald-600"}>{fmt.pct(a.attainment)}</span> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
