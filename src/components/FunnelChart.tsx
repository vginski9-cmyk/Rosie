"use client";

import Link from "next/link";
import { analyzeFunnel, type StageKey } from "@/lib/funnel";
import { fmt } from "@/lib/format";

export interface FunnelStageInput {
  key: StageKey;
  label: string;
  target?: number | null;
  actual?: number | null;
}

export function FunnelChart({ stages, programId }: { stages: FunnelStageInput[]; programId?: string }) {
  const analysis = analyzeFunnel(stages);
  const maxVal = Math.max(1, ...analysis.map((a) => Math.max(a.target ?? 0, a.actual ?? 0)));
  const widthPct = (v?: number | null) => `${Math.max(14, ((v ?? 0) / maxVal) * 100)}%`;

  return (
    <div className="space-y-6">
      {/* The actual funnel — centered, tapering, with numbers that pop */}
      <div className="space-y-2">
        {analysis.map((a) => {
          const innerPct = a.target && a.actual != null ? `${Math.min(100, (a.actual / a.target) * 100)}%` : "0%";
          const behind = a.attainment != null && a.attainment < 1;
          const row = (
            <div className="group flex items-center gap-3">
              {/* Left label */}
              <div className="w-44 shrink-0 text-right">
                <div className="text-[13px] font-medium leading-tight text-slate-700 group-hover:text-slate-900">{a.label}</div>
                {a.targetConversion != null && (
                  <div className="text-[10px] text-slate-400">{fmt.pct(a.targetConversion)} plan conv.</div>
                )}
              </div>

              {/* The tapering bar */}
              <div className="relative flex-1">
                <div
                  className="relative mx-auto flex h-16 items-center justify-center overflow-hidden rounded-lg ring-1 ring-inset transition-shadow group-hover:ring-2"
                  style={{ width: widthPct(a.target ?? a.actual), background: `${a.color}1f`, borderColor: a.color, color: a.color }}
                >
                  {/* fill = how much of target the actual reached */}
                  <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 rounded-lg opacity-90" style={{ width: innerPct, background: a.color }} />
                  {/* big numbers */}
                  <div className="relative z-10 flex items-baseline gap-1.5 drop-shadow-sm">
                    <span className="text-3xl font-extrabold tabular-nums text-white mix-blend-luminosity" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.35)" }}>
                      {fmt.num(a.actual)}
                    </span>
                    <span className="text-lg font-semibold tabular-nums text-slate-700">/ {fmt.num(a.target)}</span>
                  </div>
                </div>
              </div>

              {/* Right rail: attainment, big and color-coded */}
              <div className="w-28 shrink-0 text-left">
                {a.attainment != null ? (
                  <>
                    <div className={`text-xl font-bold tabular-nums ${behind ? "text-rose-600" : "text-emerald-600"}`}>
                      {fmt.pct(a.attainment)}
                    </div>
                    <div className="text-[10px] uppercase tracking-wide text-slate-400">of goal</div>
                  </>
                ) : (
                  <span className="text-slate-300">—</span>
                )}
                {programId && (
                  <div className="mt-0.5 text-[10px] font-medium text-rose-600 opacity-0 transition-opacity group-hover:opacity-100">
                    view students →
                  </div>
                )}
              </div>
            </div>
          );
          return programId ? (
            <Link key={a.key} href={`/programs/${programId}/students?stage=${a.key}`} className="block rounded-lg px-1 py-0.5 hover:bg-slate-50">
              {row}
            </Link>
          ) : (
            <div key={a.key}>{row}</div>
          );
        })}
      </div>

      <div className="flex items-center justify-center gap-6 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1"><span className="h-3 w-6 rounded ring-1 ring-slate-300" /> target (plan)</span>
        <span className="inline-flex items-center gap-1"><span className="h-3 w-6 rounded bg-slate-500" /> actual reached</span>
        {programId && <span className="text-rose-600">click any stage to see the students in it</span>}
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
              <tr key={a.key} className={programId ? "cursor-pointer hover:bg-slate-50" : ""}>
                <td className="td font-medium">
                  {programId ? (
                    <Link href={`/programs/${programId}/students?stage=${a.key}`} className="text-rose-700 hover:underline">{a.label}</Link>
                  ) : a.label}
                </td>
                <td className="td text-right">{fmt.num(a.target, 0)}</td>
                <td className="td text-right font-semibold">{fmt.num(a.actual, 0)}</td>
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
