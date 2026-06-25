"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  expandSchedule, summarize, gridByWeekDay, gridByMonth, staffLoadDetail, studentsForShift, shiftHoursFor, formatTime12,
  type ScheduleSession, type Shift, type SectionStudent,
} from "@/lib/schedule";
import { SectionManager } from "@/components/SectionManager";

export interface TermTemplate {
  id: string;
  index: number;
  name: string;
  startDateISO?: string | null;
  weeks: number;
  sessions: ScheduleSession[];
}
export interface RosterPerson {
  id: string;
  name: string;
  role: string;
  employerName?: string | null;
}

const KIND_STYLE: Record<string, { dot: string; chip: string; bar: string }> = {
  CLASS: { dot: "bg-sky-500", chip: "bg-sky-100 text-sky-800", bar: "bg-sky-500" },
  LAB: { dot: "bg-violet-500", chip: "bg-violet-100 text-violet-800", bar: "bg-violet-500" },
  CLINICAL: { dot: "bg-rose-500", chip: "bg-rose-100 text-rose-800", bar: "bg-rose-500" },
};
const STAGE_DOT: Record<string, string> = {
  enrolled: "bg-emerald-500", completing: "bg-lime-500", licensed: "bg-amber-500", placed: "bg-rose-500", productive: "bg-red-600",
};
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday" };
type View = "calendar" | "grid" | "staffing" | "sections";

export function ScheduleBoard({ terms, roster, students, defaultEnrollment }: { terms: TermTemplate[]; roster: RosterPerson[]; students: SectionStudent[]; defaultEnrollment: number }) {
  const [termId, setTermId] = useState(terms[0]?.id ?? "");
  const [enrollment, setEnrollment] = useState(Math.max(1, defaultEnrollment || 40));
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [week, setWeek] = useState(1);
  const [view, setView] = useState<View>("calendar");
  const [kinds, setKinds] = useState<Set<string>>(new Set(["CLASS", "LAB", "CLINICAL"]));
  const [courseFilter, setCourseFilter] = useState("all");
  const [q, setQ] = useState("");
  const [drawer, setDrawer] = useState<{ title: string; shifts: Shift[] } | null>(null);

  const term = terms.find((t) => t.id === termId) ?? terms[0];
  const allShifts = useMemo(() => (term ? expandSchedule(term.sessions, enrollment, { termStart: term.startDateISO }) : []), [term, enrollment]);

  // Default staffing comes from the seeded plan (incl. co-teaching splits); a
  // per-shift override layers on top once the user edits it.
  const effectiveAssignments = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const s of allShifts) m[s.id] = assignments[s.id] ?? s.staff.map((x) => x.personId);
    return m;
  }, [allShifts, assignments]);

  const courseOptions = useMemo(() => {
    const m = new Map<string, string>();
    allShifts.forEach((s) => m.set(s.courseCode, s.courseName));
    return [...m.entries()].sort();
  }, [allShifts]);

  const shifts = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return allShifts.filter((s) =>
      kinds.has(s.kind) &&
      (courseFilter === "all" || s.courseCode === courseFilter) &&
      (!needle || `${s.courseCode} ${s.title} ${s.location ?? ""} ${s.rotationType ?? ""}`.toLowerCase().includes(needle)),
    );
  }, [allShifts, kinds, courseFilter, q]);

  const summary = useMemo(() => summarize(shifts), [shifts]);
  const grid = useMemo(() => gridByWeekDay(shifts), [shifts]);
  const months = useMemo(() => gridByMonth(shifts), [shifts]);
  const loads = useMemo(() => staffLoadDetail(allShifts, effectiveAssignments, term?.weeks ?? 16), [allShifts, effectiveAssignments, term]);

  const instructors = roster.filter((p) => p.role === "instructor" || p.role === "coordinator");
  const preceptors = roster.filter((p) => p.role === "preceptor");
  const personName = (id: string) => roster.find((p) => p.id === id)?.name ?? "—";

  const conflicts = useMemo(() => {
    const seen = new Map<string, number>();
    for (const s of allShifts) for (const pid of effectiveAssignments[s.id] ?? []) {
      const key = `${pid}|${s.dateISO ?? `${s.week}-${s.day}`}|${s.startTime ?? ""}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k));
  }, [allShifts, effectiveAssignments]);

  const totalSlots = summary.instructorSlots + summary.preceptorSlots;
  const filledSlots = shifts.reduce((n, s) => n + Math.min(s.staffPerShift, (effectiveAssignments[s.id] ?? []).length), 0);

  function assign(shift: Shift, personId: string) {
    if (!personId) return;
    setAssignments((prev) => {
      const cur = prev[shift.id] ?? shift.staff.map((s) => s.personId);
      if (cur.includes(personId)) return prev;
      return { ...prev, [shift.id]: [...cur, personId] };
    });
  }
  const unassign = (shift: Shift, personId: string) =>
    setAssignments((prev) => ({ ...prev, [shift.id]: (prev[shift.id] ?? shift.staff.map((s) => s.personId)).filter((p) => p !== personId) }));

  function autoFill() {
    setAssignments(() => {
      const next: Record<string, string[]> = {};
      const dayUse = new Map<string, Set<string>>();
      const rr = { instructor: 0, preceptor: 0 };
      for (const s of allShifts) {
        const pool = s.staffType === "preceptor" ? preceptors : instructors;
        if (!pool.length) continue;
        const dayKey = `${s.dateISO ?? `${s.week}-${s.day}`}|${s.startTime ?? ""}`;
        if (!dayUse.has(dayKey)) dayUse.set(dayKey, new Set());
        const used = dayUse.get(dayKey)!;
        const picks: string[] = [];
        for (let k = 0; k < s.staffPerShift; k++) {
          let tries = 0;
          let pick = pool[rr[s.staffType] % pool.length].id;
          while ((used.has(pick) || picks.includes(pick)) && tries < pool.length) { rr[s.staffType]++; pick = pool[rr[s.staffType] % pool.length].id; tries++; }
          rr[s.staffType]++; picks.push(pick); used.add(pick);
        }
        next[s.id] = picks;
      }
      return next;
    });
  }
  const resetStaffing = () => setAssignments({});

  function toggleKind(k: string) {
    setKinds((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n.size ? n : prev; });
  }

  const openShift = (s: Shift) => setDrawer({ title: `${s.courseCode} · ${s.title}`, shifts: [s] });
  const openDay = (label: string, dayShifts: Shift[]) => dayShifts.length && setDrawer({ title: label, shifts: dayShifts });

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-end justify-between gap-5 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-end gap-5">
          <Field label="Term">
            <select value={termId} onChange={(e) => { setTermId(e.target.value); setWeek(1); }} className="input-sm w-44">
              {terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Cohort enrollment">
            <div className="flex items-center gap-3">
              <input type="range" min={1} max={120} value={enrollment} onChange={(e) => setEnrollment(Number(e.target.value))} className="h-2 w-40 accent-rose-600" />
              <input type="number" min={1} value={enrollment} onChange={(e) => setEnrollment(Math.max(1, Number(e.target.value)))} className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-lg font-semibold" />
            </div>
          </Field>
        </div>
        <div className="flex items-end gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-sm">
            {(["calendar", "grid", "staffing", "sections"] as View[]).map((v) => (
              <button key={v} onClick={() => setView(v)} className={`px-3 py-2 capitalize ${view === v ? "bg-rose-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>{v === "calendar" ? "Month calendar" : v === "grid" ? "Term grid" : v === "sections" ? "Sections" : "Staffing"}</button>
            ))}
          </div>
          <button onClick={autoFill} className="btn-primary">Auto-assign</button>
          {Object.keys(assignments).length > 0 && <button onClick={resetStaffing} className="btn-ghost text-xs">Reset to plan</button>}
        </div>
      </div>

      {/* Filters */}
      {view !== "sections" && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Filter</span>
          {(["CLASS", "LAB", "CLINICAL"] as const).map((k) => (
            <button key={k} onClick={() => toggleKind(k)} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${kinds.has(k) ? KIND_STYLE[k].chip : "bg-white text-slate-400 line-through"}`}>
              <span className={`h-2 w-2 rounded-full ${KIND_STYLE[k].dot}`} />{k.toLowerCase()}
            </button>
          ))}
          <select value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)} className="input-sm w-48">
            <option value="all">All courses</option>
            {courseOptions.map(([code, name]) => <option key={code} value={code}>{code} — {name}</option>)}
          </select>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title / location / rotation…" className="input-sm w-64" />
          {(q || courseFilter !== "all" || kinds.size < 3) && <button onClick={() => { setQ(""); setCourseFilter("all"); setKinds(new Set(["CLASS", "LAB", "CLINICAL"])); }} className="text-xs text-rose-700 hover:underline">clear</button>}
          <span className="ml-auto text-xs text-slate-500">{shifts.length} shifts shown · click any to drill in</span>
        </div>
      )}

      {view === "sections" ? (
        <SectionManager sessions={term?.sessions ?? []} students={students} defaultEnrollment={enrollment} />
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Shifts (filtered)" value={summary.totalShifts} />
            <Stat label="Class" value={summary.classShifts} dot="bg-sky-500" />
            <Stat label="Lab" value={summary.labShifts} dot="bg-violet-500" />
            <Stat label="Clinical" value={summary.clinicalShifts} dot="bg-rose-500" />
            <Stat label="Instructor slots" value={summary.instructorSlots} />
            <Stat label="Preceptor slots" value={summary.preceptorSlots} />
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-emerald-500" style={{ width: `${totalSlots ? (filledSlots / totalSlots) * 100 : 0}%` }} /></div>
            <span className="tabular-nums text-slate-600"><strong>{filledSlots}</strong> / {totalSlots} slots assigned</span>
            {conflicts.size > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">{conflicts.size} double-booked</span>}
          </div>

          <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
            <div>
              {view === "calendar" && <MonthCalendar months={months} assignments={effectiveAssignments} personName={personName} openShift={openShift} openDay={openDay} />}
              {view === "grid" && <TermGrid weeks={summary.weeks} grid={grid} week={week} setWeek={setWeek} openDay={openDay} />}
              {view === "staffing" && (
                <StaffingBoard
                  weeks={summary.weeks} week={week} setWeek={setWeek} grid={grid}
                  assignments={effectiveAssignments} assign={assign} unassign={unassign} conflicts={conflicts}
                  instructors={instructors} preceptors={preceptors} personName={personName} openShift={openShift}
                />
              )}
            </div>

            {/* Staff workload analytics */}
            <div>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Staff workload (whole term)</h3>
              <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
                {loads.length === 0 && <p className="text-xs text-slate-400">No staffing yet.</p>}
                {loads.map((l) => {
                  const p = roster.find((r) => r.id === l.personId);
                  const max = loads[0]?.contactHours || 1;
                  return (
                    <div key={l.personId} className="border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{p?.name}</div>
                          <div className="text-[11px] capitalize text-slate-400">{p?.role}{p?.employerName ? ` · ${p.employerName}` : ""}</div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-sm font-semibold tabular-nums">{l.contactHours.toLocaleString()} hrs</div>
                          <div className="text-[11px] text-slate-400">{l.weeklyAvgHours.toFixed(1)}/wk · {l.shifts} shifts</div>
                        </div>
                      </div>
                      <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-slate-100" title={`class ${l.classHours} · lab ${l.labHours} · clinical ${l.clinicalHours} hrs`}>
                        <div className="bg-sky-500" style={{ width: `${(l.classHours / max) * 100}%` }} />
                        <div className="bg-violet-500" style={{ width: `${(l.labHours / max) * 100}%` }} />
                        <div className="bg-rose-500" style={{ width: `${(l.clinicalHours / max) * 100}%` }} />
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] tabular-nums">
                        <span className="inline-flex items-center gap-1 text-sky-600"><span className="h-2 w-2 rounded-sm bg-sky-500" />class {l.classHours.toLocaleString()}h</span>
                        <span className="inline-flex items-center gap-1 text-violet-600"><span className="h-2 w-2 rounded-sm bg-violet-500" />lab {l.labHours.toLocaleString()}h</span>
                        <span className="inline-flex items-center gap-1 text-rose-600"><span className="h-2 w-2 rounded-sm bg-rose-500" />clinical {l.clinicalHours.toLocaleString()}h</span>
                        <span className="text-slate-400">· {l.distinctDays} days</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] text-slate-400">{instructors.length} instructors · {preceptors.length} preceptors · co-taught sessions split contact hours between instructors.</p>
            </div>
          </div>
        </>
      )}

      {drawer && (
        <ShiftDrawer
          title={drawer.title} shifts={drawer.shifts} students={students}
          assignments={effectiveAssignments} assign={assign} unassign={unassign}
          instructors={instructors} preceptors={preceptors} personName={personName}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  );
}

/* ---------- Detail drawer ---------- */
function ShiftDrawer({ title, shifts, students, assignments, assign, unassign, instructors, preceptors, personName, onClose }: {
  title: string; shifts: Shift[]; students: SectionStudent[]; assignments: Record<string, string[]>;
  assign: (s: Shift, p: string) => void; unassign: (s: Shift, p: string) => void;
  instructors: RosterPerson[]; preceptors: RosterPerson[]; personName: (id: string) => string; onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <div className="relative z-10 h-full w-full max-w-md overflow-y-auto border-l border-slate-200 bg-white shadow-xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">✕</button>
        </div>
        <div className="space-y-5 p-5">
          {shifts.map((s) => (
            <ShiftDetail key={s.id} shift={s} students={students} assignments={assignments} assign={assign} unassign={unassign} instructors={instructors} preceptors={preceptors} personName={personName} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ShiftDetail({ shift: s, students, assignments, assign, unassign, instructors, preceptors, personName }: {
  shift: Shift; students: SectionStudent[]; assignments: Record<string, string[]>;
  assign: (s: Shift, p: string) => void; unassign: (s: Shift, p: string) => void;
  instructors: RosterPerson[]; preceptors: RosterPerson[]; personName: (id: string) => string;
}) {
  const assigned = assignments[s.id] ?? [];
  const pool = s.staffType === "preceptor" ? preceptors : instructors;
  const roster = studentsForShift(s, students);
  const hoursLabel = (pid: string) => {
    const planned = s.staff.find((p) => p.personId === pid);
    return planned ? `${planned.contactHours}h${planned.segment ? ` · ${planned.segment}` : ""}` : `${s.lengthHours}h`;
  };
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="flex items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${KIND_STYLE[s.kind].chip}`}>{s.kind}</span>
        <span className="font-mono text-xs text-slate-500">{s.courseCode}</span>
        {s.sections > 1 && <span className="text-[11px] text-slate-400">section {s.sectionIndex} of {s.sections}</span>}
      </div>
      <div className="mt-1.5 text-base font-semibold leading-snug text-slate-900">{s.title}</div>
      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] text-slate-600">
        <div><span className="text-slate-400">When </span>{s.dateLabel ?? `Week ${s.week}, ${s.day}`}</div>
        <div><span className="text-slate-400">Time </span>{s.startTime ? `${formatTime12(s.startTime)}–${formatTime12(s.endTime)}` : "—"}</div>
        <div><span className="text-slate-400">Where </span>{s.location ?? "—"}</div>
        <div><span className="text-slate-400">Length </span>{s.lengthHours}h</div>
        {s.rotationType && <div className="col-span-2"><span className="text-slate-400">Rotation </span>{s.rotationType}{s.clinicalMode ? ` · ${s.clinicalMode}` : ""}</div>}
      </div>

      {s.homework && (
        <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          <span className="font-semibold">Assignment / homework: </span>{s.homework}
        </div>
      )}

      {/* Instructors with split hours */}
      <div className="mt-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Staffing ({s.staffType})</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {assigned.map((pid) => (
            <span key={pid} className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2 py-0.5 text-[11px] text-white">
              {personName(pid)} <span className="opacity-70">{hoursLabel(pid)}</span>
              <button onClick={() => unassign(s, pid)} className="opacity-60 hover:opacity-100">×</button>
            </span>
          ))}
          <select value="" onChange={(e) => assign(s, e.target.value)} className="rounded-md border border-slate-300 px-1.5 py-0.5 text-[11px]">
            <option value="">+ add {s.staffType}…</option>
            {pool.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      {/* Student roster for this section */}
      <div className="mt-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Students in this section ({roster.length})</div>
        {roster.length === 0 ? (
          <p className="mt-1 text-[12px] text-slate-400">No enrolled students mapped to this section yet.</p>
        ) : (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {roster.map((st) => (
              <Link key={st.id} href={`/students/${st.id}`} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700 hover:bg-rose-100 hover:text-rose-700">
                <span className={`h-1.5 w-1.5 rounded-full ${STAGE_DOT[st.stageKey ?? ""] ?? "bg-slate-400"}`} />{st.name}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Month calendar ---------- */
function MonthCalendar({ months, assignments, personName, openShift, openDay }: { months: Map<string, { label: string; days: Map<string, Shift[]> }>; assignments: Record<string, string[]>; personName: (id: string) => string; openShift: (s: Shift) => void; openDay: (label: string, shifts: Shift[]) => void }) {
  if (months.size === 0) return <p className="text-sm text-slate-400">No dated sessions to show. (Add a term start date.)</p>;
  return (
    <div className="space-y-8">
      {[...months.entries()].map(([key, m]) => {
        const [y, mo] = key.split("-").map(Number);
        const first = new Date(Date.UTC(y, mo - 1, 1));
        const lead = first.getUTCDay();
        const daysIn = new Date(Date.UTC(y, mo, 0)).getUTCDate();
        const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => i + 1)];
        while (cells.length % 7 !== 0) cells.push(null);
        return (
          <div key={key}>
            <h3 className="mb-2 text-lg font-semibold">{m.label}</h3>
            <div className="grid grid-cols-7 overflow-hidden rounded-xl border border-slate-200 text-sm">
              {WD.map((d) => <div key={d} className="border-b border-slate-200 bg-slate-50 px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">{d}</div>)}
              {cells.map((day, i) => {
                const iso = day ? `${y}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}` : null;
                const dayShifts = iso ? (m.days.get(iso) ?? []) : [];
                const weekend = i % 7 === 0 || i % 7 === 6;
                return (
                  <div key={i} className={`min-h-[112px] border-b border-r border-slate-100 p-1.5 ${weekend ? "bg-slate-50/40" : "bg-white"}`}>
                    {day && (
                      <button disabled={dayShifts.length === 0} onClick={() => openDay(dayShifts[0]?.dateLabel ?? `Day ${day}`, dayShifts)} className="mb-1 ml-auto block text-right text-[11px] font-medium text-slate-400 hover:text-rose-600 disabled:hover:text-slate-400">{day}</button>
                    )}
                    <div className="space-y-1">
                      {dayShifts.slice(0, 4).map((s) => {
                        const who = (assignments[s.id] ?? []).map(personName);
                        return (
                          <button key={s.id} onClick={() => openShift(s)} className={`block w-full rounded px-1.5 py-1 text-left text-[10px] leading-tight hover:ring-1 hover:ring-rose-300 ${KIND_STYLE[s.kind].chip}`} title="click for details">
                            <div className="font-semibold">{formatTime12(s.startTime)} · {s.courseCode}</div>
                            <div className="truncate">{s.title}</div>
                            {who.length > 0 && <div className="truncate text-[9px] opacity-80">▸ {who.join(", ")}</div>}
                          </button>
                        );
                      })}
                      {dayShifts.length > 4 && <button onClick={() => openDay(dayShifts[0]?.dateLabel ?? "Day", dayShifts)} className="px-1 text-[10px] text-rose-600 hover:underline">+{dayShifts.length - 4} more</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Term grid (week × day) — clickable cells ---------- */
function TermGrid({ weeks, grid, week, setWeek, openDay }: { weeks: number[]; grid: Map<number, Map<string, Shift[]>>; week: number; setWeek: (w: number) => void; openDay: (label: string, shifts: Shift[]) => void }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full border-collapse text-sm">
        <thead><tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500"><th className="px-4 py-2 font-semibold">Week</th>{DAYS.map((d) => <th key={d} className="px-4 py-2 font-semibold">{d}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">
          {weeks.map((wk) => (
            <tr key={wk} className={wk === week ? "bg-rose-50/50" : ""}>
              <td className="cursor-pointer px-4 py-3 font-semibold text-slate-700" onClick={() => setWeek(wk)}>Week {wk}</td>
              {DAYS.map((d) => {
                const cell = grid.get(wk)?.get(d) ?? [];
                const counts = { CLASS: 0, LAB: 0, CLINICAL: 0 } as Record<string, number>;
                cell.forEach((s) => (counts[s.kind] += 1));
                const label = cell[0]?.dateLabel ?? `Week ${wk}, ${DAY_FULL[d]}`;
                return (
                  <td key={d} className={`px-4 py-3 align-top ${cell.length ? "cursor-pointer hover:bg-rose-50/40" : ""}`} onClick={() => openDay(label, cell)}>
                    <div className="flex flex-wrap gap-1">
                      {(["CLASS", "LAB", "CLINICAL"] as const).map((k) => counts[k] > 0 && <span key={k} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${KIND_STYLE[k].chip}`}><span className={`h-1.5 w-1.5 rounded-full ${KIND_STYLE[k].dot}`} />{counts[k]}</span>)}
                      {cell.length === 0 && <span className="text-xs text-slate-300">—</span>}
                    </div>
                    {cell.length > 0 && <div className="mt-1 truncate text-[10px] text-slate-400">{cell[0].courseCode} {cell[0].title}{cell.length > 1 ? ` +${cell.length - 1}` : ""}</div>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="bg-slate-50 px-4 py-2 text-[11px] text-slate-400">Click any day cell to see every session that day — what&apos;s covered, who&apos;s teaching, and which students attend.</p>
    </div>
  );
}

/* ---------- Staffing board ---------- */
function StaffingBoard({ weeks, week, setWeek, grid, assignments, assign, unassign, conflicts, instructors, preceptors, personName, openShift }: {
  weeks: number[]; week: number; setWeek: (w: number) => void; grid: Map<number, Map<string, Shift[]>>;
  assignments: Record<string, string[]>; assign: (s: Shift, p: string) => void; unassign: (s: Shift, p: string) => void; conflicts: Set<string>;
  instructors: RosterPerson[]; preceptors: RosterPerson[]; personName: (id: string) => string; openShift: (s: Shift) => void;
}) {
  const weekShifts = grid.get(week) ?? new Map<string, Shift[]>();
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1">
        {weeks.map((w) => <button key={w} onClick={() => setWeek(w)} className={`rounded-md px-2.5 py-1 text-xs font-medium ${w === week ? "bg-rose-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>Wk {w}</button>)}
      </div>
      <div className="space-y-5">
        {DAYS.filter((d) => (weekShifts.get(d) ?? []).length > 0).map((d) => (
          <div key={d}>
            <div className="mb-2 text-sm font-semibold text-slate-700">{DAY_FULL[d]}{(weekShifts.get(d) ?? [])[0]?.dateLabel ? ` · ${(weekShifts.get(d) ?? [])[0].dateLabel}` : ""}</div>
            <div className="grid gap-3 sm:grid-cols-2">
              {(weekShifts.get(d) ?? []).map((s) => {
                const assigned = assignments[s.id] ?? [];
                const pool = s.staffType === "preceptor" ? preceptors : instructors;
                const full = assigned.length >= s.staffPerShift;
                return (
                  <div key={s.id} className={`rounded-xl border p-3 ${full ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200 bg-white"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <button onClick={() => openShift(s)} className="min-w-0 text-left">
                        <div className="flex items-center gap-2">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${KIND_STYLE[s.kind].chip}`}>{s.kind}</span>
                          <span className="font-mono text-xs text-slate-500">{s.courseCode}</span>
                          {s.startTime && <span className="text-[11px] text-slate-500">{formatTime12(s.startTime)}–{formatTime12(s.endTime)}</span>}
                          {s.sections > 1 && <span className="text-[11px] text-slate-400">sec {s.sectionIndex}/{s.sections}</span>}
                        </div>
                        <div className="mt-1 text-sm font-medium leading-snug text-slate-800 hover:text-rose-700">{s.title}</div>
                        <div className="text-[11px] text-slate-500">{s.lengthHours}h{s.location ? ` · ${s.location}` : ""}{s.rotationType ? ` · ${s.rotationType}` : ""}{s.homework ? " · has homework" : ""}</div>
                      </button>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${full ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{assigned.length}/{s.staffPerShift}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {assigned.map((pid) => {
                        const conflict = conflicts.has(`${pid}|${s.dateISO ?? `${s.week}-${s.day}`}|${s.startTime ?? ""}`);
                        const planned = s.staff.find((p) => p.personId === pid);
                        return <span key={pid} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${conflict ? "bg-amber-100 text-amber-800" : "bg-slate-900 text-white"}`}>{personName(pid)}{planned ? <span className="opacity-70">{planned.contactHours}h</span> : null}<button onClick={() => unassign(s, pid)} className="opacity-60 hover:opacity-100">×</button></span>;
                      })}
                      <select value="" onChange={(e) => assign(s, e.target.value)} className="rounded-md border border-slate-300 px-1.5 py-0.5 text-[11px]"><option value="">+ {s.staffType}…</option>{pool.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {[...weekShifts.values()].flat().length === 0 && <p className="text-sm text-slate-400">No shifts in week {week} with the current filters.</p>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>{children}</label>;
}
function Stat({ label, value, dot }: { label: string; value: number; dot?: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">{dot && <span className={`h-2 w-2 rounded-full ${dot}`} />}{label}</div><div className="mt-0.5 text-2xl font-semibold tabular-nums text-slate-900">{value.toLocaleString()}</div></div>;
}
