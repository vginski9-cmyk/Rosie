"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { STAGES, STAGE_INDEX, type StageKey } from "@/lib/funnel";

export interface RosterStudent {
  id: string;
  name: string;
  email: string | null;
  status: string;
  stageKey: string | null;
  gpa: number | null;
  attendedCount: number;
  missedCount: number;
  grades: number;
  assessments: number;
}

const STATUS_COLOR: Record<string, string> = {
  prospect: "bg-slate-100 text-slate-600",
  applicant: "bg-sky-100 text-sky-700",
  admitted: "bg-indigo-100 text-indigo-700",
  enrolled: "bg-emerald-100 text-emerald-700",
  completed: "bg-amber-100 text-amber-700",
  placed: "bg-rose-100 text-rose-700",
  withdrawn: "bg-slate-200 text-slate-500",
};

export function StudentRoster({ programId, students }: { programId: string; students: RosterStudent[] }) {
  const [stage, setStage] = useState<StageKey | null>(null);
  const [q, setQ] = useState("");

  // Honor a ?stage= deep-link from the funnel (filtering is client-side so it
  // works even on the static demo, where query-param routing doesn't).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const s = params.get("stage");
    if (s && s in STAGE_INDEX) setStage(s as StageKey);
  }, []);

  const reachedIndex = (s: RosterStudent) =>
    s.stageKey && s.stageKey in STAGE_INDEX ? STAGE_INDEX[s.stageKey as StageKey] : -1;
  const reachedCount = (key: StageKey) => students.filter((s) => reachedIndex(s) >= STAGE_INDEX[key]).length;

  const needle = q.trim().toLowerCase();
  const filtered = students.filter((s) =>
    (stage == null || reachedIndex(s) >= STAGE_INDEX[stage]) &&
    (!needle || s.name.toLowerCase().includes(needle) || (s.email ?? "").toLowerCase().includes(needle)),
  );
  const stageLabel = stage ? STAGES.find((s) => s.key === stage)?.label : null;

  return (
    <div className="space-y-6">
      {/* Funnel-stage filter rail — click a stage to drill into the people in it */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setStage(null)}
          className={`rounded-lg px-3 py-2 text-sm font-medium ring-1 ring-inset transition-colors ${!stage ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"}`}
        >
          All <span className="tabular-nums opacity-70">{students.length}</span>
        </button>
        {STAGES.map((s) => {
          const n = reachedCount(s.key);
          const active = stage === s.key;
          return (
            <button
              key={s.key}
              onClick={() => setStage(active ? null : s.key)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium ring-1 ring-inset transition-colors ${active ? "text-white" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"}`}
              style={active ? { background: s.color, borderColor: s.color } : undefined}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: active ? "#fff" : s.color }} />
              {s.label}
              <span className="tabular-nums opacity-70">{n}</span>
            </button>
          );
        })}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name / email…" className="ml-auto rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </div>

      {(stage || q) && (
        <div className="rounded-lg bg-slate-50 px-4 py-2 text-sm text-slate-600">
          Showing <strong>{filtered.length}</strong> students
          {stage ? <> who reached <strong>{stageLabel}</strong> or beyond</> : null}
          {q ? <> matching “{q}”</> : null}.{" "}
          <button onClick={() => { setStage(null); setQ(""); }} className="text-rose-700 hover:underline">clear</button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3 font-semibold">Student</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Furthest stage</th>
              <th className="px-4 py-3 text-right font-semibold">GPA</th>
              <th className="px-4 py-3 text-right font-semibold">Attended</th>
              <th className="px-4 py-3 text-right font-semibold">Missed</th>
              <th className="px-4 py-3 text-right font-semibold">Grades</th>
              <th className="px-4 py-3 text-right font-semibold">Assessments</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-sm">
            {filtered.map((s) => {
              const st = STAGES.find((x) => x.key === s.stageKey);
              return (
                <tr key={s.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <Link href={`/students/${s.id}`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{s.name}</Link>
                    {s.email && <div className="text-[11px] text-slate-400">{s.email}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_COLOR[s.status] ?? "bg-slate-100 text-slate-600"}`}>{s.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    {st ? (
                      <span className="inline-flex items-center gap-1.5 text-slate-600">
                        <span className="h-2 w-2 rounded-full" style={{ background: st.color }} />
                        {st.label}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">{s.gpa != null ? s.gpa.toFixed(2) : "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{s.attendedCount || "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{s.missedCount ? <span className="text-rose-600">{s.missedCount}</span> : <span className="text-slate-300">0</span>}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-500">{s.grades || "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-500">{s.assessments || "—"}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-400">No students match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
