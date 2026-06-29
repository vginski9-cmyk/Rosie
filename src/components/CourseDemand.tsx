"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { fetchCourseDemandStudents } from "@/lib/actions";

export interface DemandRow {
  code: string; name: string; totalStudents: number;
  programs: { programId: string; programName: string; family: string | null; students: number; cohorts: number }[];
  sectionsScheduled: number; seatsScheduled: number; typicalCap: number; sectionsNeeded: number;
}
type Student = { id: string; name: string; program: { id: string; name: string }; cohort: { name: string } | null };

export function CourseDemand({ rows, institutionId }: { rows: DemandRow[]; institutionId: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const [students, setStudents] = useState<Record<string, Student[]>>({});
  const [, startTransition] = useTransition();

  const toggle = (code: string) => {
    const next = open === code ? null : code;
    setOpen(next);
    if (next && !students[next]) startTransition(async () => {
      const list = await fetchCourseDemandStudents(next, institutionId);
      setStudents((s) => ({ ...s, [next]: list as Student[] }));
    });
  };

  if (rows.length === 0) return <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-400">No courses are shared across more than one program yet.</p>;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <th className="px-3 py-2 text-left font-semibold">Course</th>
            <th className="px-3 py-2 text-center font-semibold">Programs</th>
            <th className="px-3 py-2 text-center font-semibold">Total demand</th>
            <th className="px-3 py-2 text-center font-semibold">Sections needed</th>
            <th className="px-3 py-2 text-center font-semibold">Scheduled</th>
            <th className="px-3 py-2 text-left font-semibold">Capacity gap</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => {
            const gap = r.totalStudents - r.seatsScheduled;
            const isOpen = open === r.code;
            return (
              <>
                <tr key={r.code} className="cursor-pointer hover:bg-slate-50/60" onClick={() => toggle(r.code)}>
                  <td className="px-3 py-2">
                    <span className="font-medium text-slate-800">{r.code}</span>
                    <span className="ml-1 text-slate-400">{r.name}</span>
                    <span className="ml-1 text-slate-300">{isOpen ? "▾" : "▸"}</span>
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums text-slate-600">{r.programs.length}</td>
                  <td className="px-3 py-2 text-center tabular-nums font-semibold text-slate-800">{r.totalStudents}</td>
                  <td className="px-3 py-2 text-center tabular-nums text-slate-600">{r.sectionsNeeded} <span className="text-[10px] text-slate-400">@{r.typicalCap}</span></td>
                  <td className="px-3 py-2 text-center tabular-nums text-slate-600">{r.sectionsScheduled} <span className="text-[10px] text-slate-400">({r.seatsScheduled} seats)</span></td>
                  <td className="px-3 py-2">
                    {gap > 0
                      ? <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-700">+{gap} seats short</span>
                      : <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">covered</span>}
                  </td>
                </tr>
                {isOpen && (
                  <tr key={r.code + "-d"} className="bg-slate-50/60">
                    <td colSpan={6} className="px-3 py-3">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Demand by program</div>
                          <div className="space-y-1">
                            {r.programs.map((p) => (
                              <div key={p.programId} className="flex items-center justify-between gap-2 text-[12px]">
                                <Link href={`/programs/${p.programId}/students`} className="text-slate-700 hover:text-rose-700 hover:underline">{p.programName}</Link>
                                <span className="tabular-nums text-slate-500">{p.students} students{p.cohorts ? ` · ${p.cohorts} active cohort${p.cohorts === 1 ? "" : "s"}` : ""}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Students enrolled ({students[r.code]?.length ?? "…"})</div>
                          {students[r.code] ? (
                            <div className="flex flex-wrap gap-1">
                              {students[r.code].slice(0, 60).map((s) => (
                                <Link key={s.id} href={`/students/${s.id}`} className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600 ring-1 ring-slate-200 hover:text-rose-700" title={`${s.program.name}${s.cohort ? ` · ${s.cohort.name}` : ""}`}>{s.name}</Link>
                              ))}
                              {students[r.code].length > 60 && <span className="px-2 py-0.5 text-[11px] text-slate-400">+{students[r.code].length - 60} more</span>}
                            </div>
                          ) : <p className="text-[11px] text-slate-400">loading…</p>}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
