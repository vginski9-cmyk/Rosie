"use client";

import { useMemo, useState } from "react";
import {
  expandSchedule, summarize, gridByWeekDay, staffLoads, DAY_ORDER,
  type ScheduleSession, type Shift,
} from "@/lib/schedule";

export interface TermTemplate {
  id: string;
  index: number;
  name: string;
  sessions: ScheduleSession[];
}
export interface RosterPerson {
  id: string;
  name: string;
  role: string;
  employerName?: string | null;
}

const KIND_STYLE: Record<string, { dot: string; chip: string; text: string }> = {
  CLASS: { dot: "bg-sky-500", chip: "bg-sky-100 text-sky-800", text: "text-sky-700" },
  LAB: { dot: "bg-violet-500", chip: "bg-violet-100 text-violet-800", text: "text-violet-700" },
  CLINICAL: { dot: "bg-rose-500", chip: "bg-rose-100 text-rose-800", text: "text-rose-700" },
};
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

export function ScheduleBoard({ terms, roster, defaultEnrollment }: { terms: TermTemplate[]; roster: RosterPerson[]; defaultEnrollment: number }) {
  const [termId, setTermId] = useState(terms[0]?.id ?? "");
  const [enrollment, setEnrollment] = useState(Math.max(1, defaultEnrollment || 40));
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [week, setWeek] = useState(1);

  const term = terms.find((t) => t.id === termId) ?? terms[0];
  const shifts = useMemo(() => (term ? expandSchedule(term.sessions, enrollment) : []), [term, enrollment]);
  const summary = useMemo(() => summarize(shifts), [shifts]);
  const grid = useMemo(() => gridByWeekDay(shifts), [shifts]);
  const loads = useMemo(() => staffLoads(shifts, assignments), [shifts, assignments]);

  const instructors = roster.filter((p) => p.role === "instructor" || p.role === "coordinator");
  const preceptors = roster.filter((p) => p.role === "preceptor");
  const personName = (id: string) => roster.find((p) => p.id === id)?.name ?? "—";

  // Double-booking: a person assigned to >1 shift on the same week+day.
  const conflicts = useMemo(() => {
    const seen = new Map<string, number>();
    for (const s of shifts) for (const pid of assignments[s.id] ?? []) {
      const key = `${pid}|${s.week}|${s.day}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k));
  }, [shifts, assignments]);

  const totalSlots = summary.instructorSlots + summary.preceptorSlots;
  const filledSlots = shifts.reduce((n, s) => n + Math.min(s.staffPerShift, (assignments[s.id] ?? []).length), 0);

  function assign(shift: Shift, personId: string) {
    if (!personId) return;
    setAssignments((prev) => {
      const cur = prev[shift.id] ?? [];
      if (cur.includes(personId) || cur.length >= shift.staffPerShift) return prev;
      return { ...prev, [shift.id]: [...cur, personId] };
    });
  }
  function unassign(shiftId: string, personId: string) {
    setAssignments((prev) => ({ ...prev, [shiftId]: (prev[shiftId] ?? []).filter((p) => p !== personId) }));
  }
  function autoFill() {
    // Round-robin fill from the matching roster, avoiding same-day double-booking.
    setAssignments(() => {
      const next: Record<string, string[]> = {};
      const dayUse = new Map<string, Set<string>>(); // week|day -> personIds used
      const rr = { instructor: 0, preceptor: 0 };
      for (const s of shifts) {
        const pool = s.staffType === "preceptor" ? preceptors : instructors;
        if (pool.length === 0) continue;
        const dayKey = `${s.week}|${s.day}`;
        if (!dayUse.has(dayKey)) dayUse.set(dayKey, new Set());
        const used = dayUse.get(dayKey)!;
        const picks: string[] = [];
        for (let k = 0; k < s.staffPerShift; k++) {
          let tries = 0;
          let pick = pool[rr[s.staffType] % pool.length].id;
          while ((used.has(pick) || picks.includes(pick)) && tries < pool.length) {
            rr[s.staffType]++; pick = pool[rr[s.staffType] % pool.length].id; tries++;
          }
          rr[s.staffType]++;
          picks.push(pick); used.add(pick);
        }
        next[s.id] = picks;
      }
      return next;
    });
  }

  const weekShifts = (grid.get(week) ?? new Map<string, Shift[]>());

  return (
    <div className="space-y-8">
      {/* Controls */}
      <div className="flex flex-wrap items-end justify-between gap-6 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-end gap-5">
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Term</span>
            <select value={termId} onChange={(e) => { setTermId(e.target.value); setWeek(1); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              {terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Cohort enrollment</span>
            <div className="flex items-center gap-3">
              <input type="range" min={1} max={120} value={enrollment} onChange={(e) => setEnrollment(Number(e.target.value))} className="h-2 w-44 accent-rose-600" />
              <input type="number" min={1} value={enrollment} onChange={(e) => setEnrollment(Math.max(1, Number(e.target.value)))} className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-lg font-semibold" />
            </div>
          </label>
        </div>
        <button onClick={autoFill} className="btn-primary">Auto-assign all shifts</button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Total shifts / term" value={summary.totalShifts} />
        <Stat label="Class" value={summary.classShifts} dot="bg-sky-500" />
        <Stat label="Lab" value={summary.labShifts} dot="bg-violet-500" />
        <Stat label="Clinical" value={summary.clinicalShifts} dot="bg-rose-500" />
        <Stat label="Instructor slots" value={summary.instructorSlots} />
        <Stat label="Preceptor slots" value={summary.preceptorSlots} />
      </div>
      <div className="flex items-center gap-3 text-sm">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full bg-emerald-500" style={{ width: `${totalSlots ? (filledSlots / totalSlots) * 100 : 0}%` }} />
        </div>
        <span className="tabular-nums text-slate-600"><strong>{filledSlots}</strong> / {totalSlots} staff slots assigned</span>
        {conflicts.size > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">{conflicts.size} double-booked</span>}
      </div>

      {/* Calendar overview: weeks × days */}
      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{term?.name} — shift calendar (click a week to staff it)</h3>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2 font-semibold">Week</th>
                {DAYS.map((d) => <th key={d} className="px-4 py-2 font-semibold">{d}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summary.weeks.map((wk) => (
                <tr key={wk} className={`cursor-pointer hover:bg-slate-50 ${wk === week ? "bg-rose-50/50" : ""}`} onClick={() => setWeek(wk)}>
                  <td className="px-4 py-3 font-semibold text-slate-700">Week {wk}</td>
                  {DAYS.map((d) => {
                    const cell = grid.get(wk)?.get(d) ?? [];
                    const counts = { CLASS: 0, LAB: 0, CLINICAL: 0 } as Record<string, number>;
                    cell.forEach((s) => (counts[s.kind] += 1));
                    return (
                      <td key={d} className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {(["CLASS", "LAB", "CLINICAL"] as const).map((k) => counts[k] > 0 && (
                            <span key={k} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${KIND_STYLE[k].chip}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${KIND_STYLE[k].dot}`} />{counts[k]}
                            </span>
                          ))}
                          {cell.length === 0 && <span className="text-xs text-slate-300">—</span>}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Week staffing board + roster load */}
      <section className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Week {week} — assign who works each shift</h3>
          <div className="space-y-5">
            {DAYS.filter((d) => (weekShifts.get(d) ?? []).length > 0).map((d) => (
              <div key={d}>
                <div className="mb-2 text-sm font-semibold text-slate-700">{dayLabel(d)}</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(weekShifts.get(d) ?? []).map((s) => {
                    const assigned = assignments[s.id] ?? [];
                    const pool = s.staffType === "preceptor" ? preceptors : instructors;
                    const full = assigned.length >= s.staffPerShift;
                    return (
                      <div key={s.id} className={`rounded-xl border p-3 ${full ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200 bg-white"}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${KIND_STYLE[s.kind].chip}`}>{s.kind}</span>
                              <span className="font-mono text-xs text-slate-500">{s.courseCode}</span>
                              {s.sections > 1 && <span className="text-[11px] text-slate-400">sec {s.sectionIndex}/{s.sections}</span>}
                            </div>
                            <div className="mt-1 text-sm font-medium leading-snug text-slate-800">{s.title}</div>
                            <div className="text-[11px] text-slate-500">{s.lengthHours}h{s.location ? ` · ${s.location}` : ""}{s.rotationType ? ` · ${s.rotationType}` : ""}</div>
                          </div>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${full ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{assigned.length}/{s.staffPerShift}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {assigned.map((pid) => {
                            const conflict = conflicts.has(`${pid}|${s.week}|${s.day}`);
                            return (
                              <span key={pid} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${conflict ? "bg-amber-100 text-amber-800" : "bg-slate-900 text-white"}`}>
                                {personName(pid)}
                                <button onClick={() => unassign(s.id, pid)} className="opacity-60 hover:opacity-100">×</button>
                              </span>
                            );
                          })}
                          {!full && (
                            <select value="" onChange={(e) => assign(s, e.target.value)} className="rounded-md border border-slate-300 px-1.5 py-0.5 text-[11px]">
                              <option value="">+ assign {s.staffType}…</option>
                              {pool.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {[...weekShifts.values()].flat().length === 0 && <p className="text-sm text-slate-400">No shifts scheduled in week {week}.</p>}
          </div>
        </div>

        {/* Roster load */}
        <div>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Who&apos;s working (whole term)</h3>
          <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
            {loads.length === 0 && <p className="text-xs text-slate-400">No one assigned yet. Use Auto-assign, or pick staff per shift.</p>}
            {loads.map((l) => {
              const p = roster.find((r) => r.id === l.personId);
              return (
                <div key={l.personId} className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2 last:border-0">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{p?.name}</div>
                    <div className="text-[11px] capitalize text-slate-400">{p?.role}{p?.employerName ? ` · ${p.employerName}` : ""}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold tabular-nums">{l.shifts} shifts</div>
                    <div className="text-[11px] text-slate-400">{l.hours.toLocaleString()} hrs</div>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-slate-400">{instructors.length} instructors · {preceptors.length} preceptors in the roster.</p>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, dot }: { label: string; value: number; dot?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {dot && <span className={`h-2 w-2 rounded-full ${dot}`} />}{label}
      </div>
      <div className="mt-1 text-3xl font-semibold tabular-nums text-slate-900">{value.toLocaleString()}</div>
    </div>
  );
}

function dayLabel(d: string) {
  const full: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday" };
  return full[d] ?? d;
}
