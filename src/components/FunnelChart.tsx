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

/** Enrollment through ONE term of the program — rendered as a strip inside the
 *  funnel under "Enrolled", so the whole journey (recruit → every term →
 *  graduate → productive) reads top to bottom. */
export interface TermEnrollment {
  label: string;        // "Term 1 — Fall"
  target: number;
  actual?: number | null;
  current?: boolean;    // the term the cohort is in right now
}

export function FunnelChart({ stages, programId, termEnrollment }: { stages: FunnelStageInput[]; programId?: string; termEnrollment?: TermEnrollment[] }) {
  const analysis = analyzeFunnel(stages);
  const maxVal = Math.max(1, ...analysis.map((a) => Math.max(a.target ?? 0, a.actual ?? 0)));
  const widthPct = (v?: number | null) => `${Math.max(14, ((v ?? 0) / maxVal) * 100)}%`;
  const maxTerm = Math.max(1, ...(termEnrollment ?? []).map((t) => t.target));

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
                  <div className="text-[10px] text-slate-400">
                    {fmt.pct(a.targetConversion)} plan conv.
                    {a.actualConversion != null && (
                      <span className={a.actualConversion < a.targetConversion ? " text-rose-500" : " text-emerald-600"}> · {fmt.pct(a.actualConversion)} actual</span>
                    )}
                  </div>
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
          const wrapped = programId ? (
            <Link href={`/programs/${programId}/students?stage=${a.key}`} className="block rounded-lg px-1 py-0.5 hover:bg-slate-50">
              {row}
            </Link>
          ) : (
            <div>{row}</div>
          );
          return (
            <div key={a.key}>
              {wrapped}
              {/* Enrollment through EVERY term, right under "Enrolled (Term 1)" */}
              {a.key === "enrolled" && termEnrollment && termEnrollment.length > 1 && (
                <div className="my-1 flex items-center gap-3 px-1">
                  <div className="w-44 shrink-0 text-right">
                    <div className="text-[11px] font-medium leading-tight text-slate-500">…enrollment through each term</div>
                    <div className="text-[10px] text-slate-400">planned attrition, term by term</div>
                  </div>
                  <div className="flex flex-1 items-stretch justify-center gap-1.5">
                    {termEnrollment.map((t, i) => {
                      const prev = i > 0 ? termEnrollment[i - 1] : null;
                      const conv = prev && prev.target > 0 ? Math.round((t.target / prev.target) * 100) : null;
                      return (
                        <div key={i} className={`rounded-lg px-2.5 py-1.5 text-center ring-1 ${t.current ? "bg-emerald-600 text-white ring-emerald-700" : "bg-emerald-50 text-emerald-900 ring-emerald-200"}`}
                          style={{ minWidth: `${Math.max(12, (t.target / maxTerm) * 100 / termEnrollment.length)}%` }}
                          title={`${t.label} — target ${t.target} enrolled${t.actual != null ? ` · actual ${t.actual}` : ""}${conv != null ? ` · ${conv}% retained from the prior term` : ""}${t.current ? " · current term" : ""}`}>
                          <div className="text-lg font-bold tabular-nums leading-tight">{t.actual != null ? `${fmt.num(t.actual)}/` : ""}{fmt.num(t.target)}</div>
                          <div className={`text-[10px] leading-tight ${t.current ? "text-emerald-100" : "text-emerald-700"}`}>{t.label}{t.current ? " · now" : ""}</div>
                          {conv != null && <div className={`text-[9px] ${t.current ? "text-emerald-200" : "text-emerald-500"}`}>{conv}% stay</div>}
                        </div>
                      );
                    })}
                  </div>
                  <div className="w-28 shrink-0" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-center gap-6 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1"><span className="h-3 w-6 rounded ring-1 ring-slate-300" /> target (plan)</span>
        <span className="inline-flex items-center gap-1"><span className="h-3 w-6 rounded bg-slate-500" /> actual reached</span>
        {programId && <span className="text-rose-600">click any stage to see the students in it</span>}
      </div>

    </div>
  );
}
