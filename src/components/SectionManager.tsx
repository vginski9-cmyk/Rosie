"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { roundUpInt } from "@/lib/service";
import type { ScheduleSession, SectionStudent } from "@/lib/schedule";

const STAGE_DOT: Record<string, string> = {
  enrolled: "bg-emerald-500", completing: "bg-lime-500", licensed: "bg-amber-500", placed: "bg-rose-500", productive: "bg-red-600",
};

/**
 * Manual section-override workbench. The cohort's named students are seated into
 * sections; you can move a student to another section or merge a small section
 * into another, collapsing it. The header shows how many sections you're running
 * vs. the capacity-minimal number, and the staffing that consolidating frees.
 */
export function SectionManager({ sessions, students, defaultEnrollment }: { sessions: ScheduleSession[]; students: SectionStudent[]; defaultEnrollment: number }) {
  // A representative sectioned session to pull a realistic capacity from.
  const sectioned = sessions.filter((s) => s.maxStudents > 0).sort((a, b) => a.maxStudents - b.maxStudents);
  const [cap, setCap] = useState(() => sectioned.find((s) => s.kind === "LAB")?.maxStudents ?? sectioned[0]?.maxStudents ?? 8);

  // Seat each student. Start from their assigned section group, but make sure we
  // surface the "tiny section" scenario: spread into a few sections.
  const initialSeat = useMemo(() => {
    const seat: Record<string, number> = {};
    students.forEach((s, i) => { seat[s.id] = Math.max(1, s.sectionIndex || ((i % 3) + 1)); });
    return seat;
  }, [students]);
  const [seat, setSeat] = useState<Record<string, number>>(initialSeat);

  const sectionsInUse = useMemo(() => {
    const set = new Set(Object.values(seat));
    return [...set].sort((a, b) => a - b);
  }, [seat]);

  const studentsIn = (sec: number) => students.filter((s) => seat[s.id] === sec);
  const total = students.length;
  const minSections = Math.max(1, roundUpInt(total / Math.max(1, cap)));

  const moveStudent = (id: string, to: number) => setSeat((p) => ({ ...p, [id]: to }));
  const mergeSection = (from: number, to: number) => setSeat((p) => {
    const next = { ...p };
    for (const s of students) if (next[s.id] === from) next[s.id] = to;
    return next;
  });
  const reset = () => setSeat(initialSeat);
  const autoConsolidate = () => setSeat(() => {
    // Greedy fill: pack students into the fewest sections at this capacity.
    const next: Record<string, number> = {};
    let sec = 1, n = 0;
    for (const s of students) {
      if (n >= cap) { sec += 1; n = 0; }
      next[s.id] = sec; n += 1;
    }
    return next;
  });

  if (total === 0) {
    return <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-400">No enrolled students to seat yet. Seed a cohort to use the section workbench.</p>;
  }

  const running = sectionsInUse.length;
  const freed = Math.max(0, running - minSections);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-rose-50/60 to-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-slate-700">Manual section override</div>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
              When a section is running with only a handful of students, consolidate it. Move students between sections or
              merge a small one into another — emptied sections collapse, and you free the instructor shifts they required.
              Capacity-minimal at <span className="font-mono">{cap}</span>/section is <strong>{minSections}</strong> section{minSections === 1 ? "" : "s"} for {total} students.
            </p>
          </div>
          <div className="flex items-end gap-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Capacity / section</span>
              <input type="number" min={1} value={cap} onChange={(e) => setCap(Math.max(1, Number(e.target.value)))} className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-right text-lg font-semibold" />
            </label>
            <button onClick={autoConsolidate} className="btn-primary">Auto-consolidate</button>
            <button onClick={reset} className="btn-ghost text-xs">Reset</button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
          <Metric label="Students" value={total} />
          <Metric label="Sections running" value={running} tone={running > minSections ? "warn" : "ok"} />
          <Metric label="Capacity-minimal" value={minSections} />
          <Metric label="Sections you can free" value={freed} tone={freed > 0 ? "warn" : "ok"} />
          {freed > 0 && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">Consolidating frees the instructor for {freed} section&apos;s worth of shifts every time this session runs.</span>}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sectionsInUse.map((sec) => {
          const list = studentsIn(sec);
          const over = list.length > cap;
          const tiny = list.length > 0 && list.length <= 3;
          const others = sectionsInUse.filter((x) => x !== sec);
          return (
            <div key={sec} className={`rounded-xl border p-4 ${over ? "border-amber-300 bg-amber-50/40" : tiny ? "border-rose-200 bg-rose-50/30" : "border-slate-200 bg-white"}`}>
              <div className="flex items-center justify-between">
                <div className="font-semibold text-slate-800">Section {sec}</div>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${over ? "bg-amber-200 text-amber-900" : "bg-slate-100 text-slate-600"}`}>{list.length}/{cap}</span>
              </div>
              {tiny && <div className="mt-1 text-[11px] font-medium text-rose-600">Under-filled — consider merging.</div>}
              {over && <div className="mt-1 text-[11px] font-medium text-amber-700">Over capacity.</div>}

              <div className="mt-3 space-y-1.5">
                {list.map((st) => (
                  <div key={st.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1">
                    <Link href={`/students/${st.id}`} className="inline-flex min-w-0 items-center gap-1.5 text-[12px] text-slate-700 hover:text-rose-700">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STAGE_DOT[st.stageKey ?? ""] ?? "bg-slate-400"}`} />
                      <span className="truncate">{st.name}</span>
                    </Link>
                    {others.length > 0 && (
                      <select value="" onChange={(e) => e.target.value && moveStudent(st.id, Number(e.target.value))} className="shrink-0 rounded border border-slate-300 px-1 py-0.5 text-[10px] text-slate-500">
                        <option value="">move →</option>
                        {others.map((o) => <option key={o} value={o}>Section {o}</option>)}
                        <option value={Math.max(0, ...sectionsInUse) + 1}>New section</option>
                      </select>
                    )}
                  </div>
                ))}
                {list.length === 0 && <p className="py-2 text-center text-[11px] text-slate-400">empty — will collapse</p>}
              </div>

              {others.length > 0 && list.length > 0 && (
                <div className="mt-3 border-t border-slate-100 pt-2">
                  <select value="" onChange={(e) => e.target.value && mergeSection(sec, Number(e.target.value))} className="w-full rounded-md border border-slate-300 px-2 py-1 text-[11px] text-slate-600">
                    <option value="">Merge this section into…</option>
                    {others.map((o) => <option key={o} value={o}>Section {o}</option>)}
                  </select>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${tone === "warn" ? "text-amber-600" : "text-slate-900"}`}>{value}</div>
    </div>
  );
}
