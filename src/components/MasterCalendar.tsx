"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { moveMeeting } from "@/lib/actions";

export interface CalMeeting {
  id: string;
  cohortId: string; cohortName: string;
  programId: string; programName: string; family: string | null;
  courseId: string; courseCode: string | null; courseName: string;
  kind: string; sectionIndex: number; sectionCount: number; seats: number;
  dayOfWeek: string; startTime: string; endTime: string; lengthHours: number;
  facilityId: string | null; facilityName: string | null; facilityKind: string | null;
  staffPersonId: string | null; staffName: string | null;
  termIndex: number; weekStartMs: number; weekEndMs: number; startLabel: string; endLabel: string;
}
export interface CalRoom { facilityId: string; name: string; kind: string; capacity: number | null; building: string | null; utilization: number; bookedHoursPeakWeek: number; openHoursPerWeek: number; meetingCount: number; distinctDays: number }
export interface CalConflict { kind: string; aId: string; bId: string; dayOfWeek: string; key: string; detail: string }
export interface RoomOpt { id: string; name: string; kind: string; capacity: number | null }

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const DAY_FULL: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday" };
const START_HOUR = 8, END_HOUR = 20, HOUR_PX = 44;
const PALETTE = ["bg-rose-500", "bg-sky-500", "bg-emerald-500", "bg-violet-500", "bg-amber-500", "bg-teal-500", "bg-fuchsia-500", "bg-indigo-500", "bg-orange-500", "bg-cyan-500"];
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const fmtTime = (t: string) => { const [h, m] = t.split(":").map(Number); const ap = h >= 12 ? "p" : "a"; const hh = h % 12 || 12; return m ? `${hh}:${String(m).padStart(2, "0")}${ap}` : `${hh}${ap}`; };
const KIND_LABEL: Record<string, string> = { CLASS: "Lecture", LAB: "Lab", CLINICAL: "Clinical" };

export function MasterCalendar({
  institutions, institutionId, rooms, meetings, conflicts, weeks, currentWeekMs, programs, summary,
}: {
  institutions: { id: string; name: string }[]; institutionId: string;
  rooms: CalRoom[]; meetings: CalMeeting[]; conflicts: CalConflict[];
  weeks: { ms: number; label: string }[]; currentWeekMs: number | null;
  programs: { id: string; name: string }[]; summary: { roomed: number; unroomed: number; clinical: number; peakUtil: number };
}) {
  const router = useRouter();
  const [weekMs, setWeekMs] = useState<number>(currentWeekMs ?? weeks[0]?.ms ?? 0);
  const [fProgram, setFProgram] = useState("");
  const [fRoom, setFRoom] = useState("");
  const [fKind, setFKind] = useState("");
  const [conflictsOnly, setConflictsOnly] = useState(false);
  const [editing, setEditing] = useState<CalMeeting | null>(null);

  const programColor = useMemo(() => {
    const m = new Map<string, string>();
    programs.forEach((p, i) => m.set(p.id, PALETTE[i % PALETTE.length]));
    return m;
  }, [programs]);

  const conflictIds = useMemo(() => { const s = new Set<string>(); for (const c of conflicts) { s.add(c.aId); s.add(c.bId); } return s; }, [conflicts]);
  const weekIdx = weeks.findIndex((w) => w.ms === weekMs);

  // Meetings active in the selected week, after filters. Clinicals are off-campus
  // (shown in a separate strip, they don't compete for rooms).
  const inWeek = useMemo(() => meetings.filter((m) => m.weekStartMs && m.weekStartMs <= weekMs && weekMs < m.weekEndMs), [meetings, weekMs]);
  const filtered = useMemo(() => inWeek.filter((m) => {
    if (fProgram && m.programId !== fProgram) return false;
    if (fRoom && m.facilityId !== fRoom) return false;
    if (fKind && m.kind !== fKind) return false;
    if (conflictsOnly && !conflictIds.has(m.id)) return false;
    return true;
  }), [inWeek, fProgram, fRoom, fKind, conflictsOnly, conflictIds]);

  const campus = filtered.filter((m) => m.kind !== "CLINICAL");
  const clinical = filtered.filter((m) => m.kind === "CLINICAL");

  // Per-day lane packing so overlapping blocks sit side by side.
  const dayLayout = (day: string) => {
    const items = campus.filter((m) => m.dayOfWeek === day).sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
    const laneEnds: number[] = [];
    const placed = items.map((m) => {
      const s = toMin(m.startTime), e = s + m.lengthHours * 60;
      let lane = laneEnds.findIndex((end) => end <= s);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(e); } else laneEnds[lane] = e;
      return { m, s, e, lane };
    });
    return { placed, lanes: Math.max(1, laneEnds.length) };
  };

  const gridHeight = (END_HOUR - START_HOUR) * HOUR_PX;
  const conflictsForWeek = conflicts.filter((c) => { const a = meetings.find((m) => m.id === c.aId); return a && a.weekStartMs <= weekMs && weekMs < a.weekEndMs; });

  const save = (patch: Parameters<typeof moveMeeting>[1]) => {
    if (!editing) return;
    const id = editing.id;
    setEditing(null);
    startMove(id, patch);
  };
  const [pending, startTransition] = useTransition();
  const startMove = (id: string, patch: Parameters<typeof moveMeeting>[1]) => {
    startTransition(async () => { await moveMeeting(id, patch); router.refresh(); });
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Institution</span>
          <select value={institutionId} onChange={(e) => router.push(`/calendar?inst=${e.target.value}`)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            {institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Program</span>
          <select value={fProgram} onChange={(e) => setFProgram(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            <option value="">All programs</option>
            {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Room</span>
          <select value={fRoom} onChange={(e) => setFRoom(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            <option value="">All rooms</option>
            {rooms.map((r) => <option key={r.facilityId} value={r.facilityId}>{r.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Type</span>
          <select value={fKind} onChange={(e) => setFKind(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            <option value="">All</option>
            <option value="CLASS">Lecture</option><option value="LAB">Lab</option><option value="CLINICAL">Clinical</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 pb-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={conflictsOnly} onChange={(e) => setConflictsOnly(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300" />
          Conflicts only
        </label>
        {(fProgram || fRoom || fKind || conflictsOnly) && <button onClick={() => { setFProgram(""); setFRoom(""); setFKind(""); setConflictsOnly(false); }} className="pb-1.5 text-xs text-slate-400 hover:text-rose-600">clear</button>}
        <div className="ml-auto flex items-center gap-2">
          <button disabled={weekIdx <= 0} onClick={() => setWeekMs(weeks[weekIdx - 1].ms)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm disabled:opacity-30">←</button>
          <select value={weekMs} onChange={(e) => setWeekMs(Number(e.target.value))} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            {weeks.map((w) => <option key={w.ms} value={w.ms}>Week of {w.label}</option>)}
          </select>
          <button disabled={weekIdx >= weeks.length - 1} onClick={() => setWeekMs(weeks[weekIdx + 1].ms)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm disabled:opacity-30">→</button>
        </div>
      </div>

      {/* Summary */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="rounded-full bg-slate-100 px-2 py-0.5">{campus.length} campus meetings this week</span>
        <span className="rounded-full bg-orange-100 px-2 py-0.5 text-orange-700">{clinical.length} clinical (off-campus)</span>
        {summary.unroomed > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">{summary.unroomed} unroomed — needs space</span>}
        {conflictsForWeek.length > 0
          ? <span className="rounded-full bg-rose-600 px-2 py-0.5 font-medium text-white">{conflictsForWeek.length} conflicts this week</span>
          : <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700">no conflicts this week</span>}
        {pending && <span className="text-slate-400">saving…</span>}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
        {/* Timetable */}
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex min-w-[680px]">
            {/* time gutter */}
            <div className="w-12 shrink-0 pt-7">
              {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => (
                <div key={i} style={{ height: HOUR_PX }} className="relative -top-2 text-right text-[10px] text-slate-400">{fmtTime(`${START_HOUR + i}:00`)}</div>
              ))}
            </div>
            {/* day columns */}
            {DAYS.map((day) => {
              const { placed, lanes } = dayLayout(day);
              return (
                <div key={day} className="flex-1 border-l border-slate-100">
                  <div className="sticky top-0 mb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">{day}</div>
                  <div className="relative" style={{ height: gridHeight }}>
                    {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => (
                      <div key={i} style={{ top: i * HOUR_PX, height: HOUR_PX }} className="absolute inset-x-0 border-t border-slate-50" />
                    ))}
                    {placed.map(({ m, s, lane }) => {
                      const top = ((s - START_HOUR * 60) / 60) * HOUR_PX;
                      const height = Math.max(18, m.lengthHours * HOUR_PX - 2);
                      const color = programColor.get(m.programId) ?? "bg-slate-500";
                      const conflict = conflictIds.has(m.id);
                      const w = 100 / lanes;
                      return (
                        <button key={m.id} onClick={() => setEditing(m)}
                          style={{ top, height, left: `${lane * w}%`, width: `calc(${w}% - 2px)` }}
                          className={`absolute overflow-hidden rounded-md px-1 py-0.5 text-left text-white ${color} ${conflict ? "ring-2 ring-rose-600 ring-offset-1" : ""} hover:brightness-110`}>
                          <span className="block truncate text-[10px] font-semibold leading-tight">{m.courseCode ?? m.courseName}{m.sectionCount > 1 ? ` §${m.sectionIndex}` : ""}</span>
                          <span className="block truncate text-[9px] leading-tight opacity-90">{m.facilityName ?? "⚠ no room"}</span>
                          <span className="block truncate text-[9px] leading-tight opacity-75">{fmtTime(m.startTime)} · {m.cohortName}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          {/* Off-campus clinical strip */}
          {clinical.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-orange-500">Clinical rotations (off-campus)</div>
              <div className="flex flex-wrap gap-1.5">
                {clinical.map((m) => (
                  <button key={m.id} onClick={() => setEditing(m)} className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] text-orange-700 hover:bg-orange-200">
                    {m.dayOfWeek} {fmtTime(m.startTime)} · {m.courseCode ?? m.courseName} · {m.cohortName}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Room utilization rail */}
        <div className="space-y-2">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Room utilization (peak week)</h3>
            <div className="space-y-2">
              {rooms.map((r) => {
                const pct = Math.round(r.utilization * 100);
                const bar = pct >= 85 ? "bg-rose-500" : pct >= 50 ? "bg-amber-500" : pct > 0 ? "bg-emerald-500" : "bg-slate-200";
                return (
                  <button key={r.facilityId} onClick={() => setFRoom(fRoom === r.facilityId ? "" : r.facilityId)} className={`block w-full text-left ${fRoom === r.facilityId ? "rounded-lg ring-1 ring-rose-300" : ""}`}>
                    <span className="flex items-center justify-between text-[11px]">
                      <span className="truncate font-medium text-slate-700">{r.name}</span>
                      <span className="tabular-nums text-slate-400">{pct}%</span>
                    </span>
                    <span className="mt-0.5 block h-1.5 w-full overflow-hidden rounded-full bg-slate-100"><span className={`block h-full ${bar}`} style={{ width: `${pct}%` }} /></span>
                    <span className="block text-[9px] text-slate-400">{r.kind.toLowerCase()} · cap {r.capacity ?? "—"} · {r.bookedHoursPeakWeek}/{r.openHoursPerWeek}h · {r.meetingCount} mtgs</span>
                  </button>
                );
              })}
              {rooms.every((r) => r.utilization === 0) && <p className="text-[11px] text-slate-400">No campus bookings.</p>}
            </div>
          </div>
        </div>
      </div>

      {/* Conflicts panel */}
      {conflictsForWeek.length > 0 && (
        <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4">
          <h3 className="text-sm font-semibold text-rose-700">{conflictsForWeek.length} scheduling conflicts this week</h3>
          <div className="mt-2 space-y-1">
            {conflictsForWeek.slice(0, 30).map((c, i) => {
              const a = meetings.find((m) => m.id === c.aId), b = meetings.find((m) => m.id === c.bId);
              if (!a || !b) return null;
              return (
                <div key={i} className="flex flex-wrap items-center gap-2 text-[12px]">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${c.kind === "room" ? "bg-rose-200 text-rose-800" : c.kind === "staff" ? "bg-violet-200 text-violet-800" : "bg-amber-200 text-amber-800"}`}>{c.kind}</span>
                  <button onClick={() => setEditing(a)} className="text-slate-700 hover:text-rose-700 hover:underline">{a.courseCode ?? a.courseName} ({a.cohortName})</button>
                  <span className="text-slate-400">↔</span>
                  <button onClick={() => setEditing(b)} className="text-slate-700 hover:text-rose-700 hover:underline">{b.courseCode ?? b.courseName} ({b.cohortName})</button>
                  <span className="text-slate-400">{c.detail}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {editing && <MoveEditor meeting={editing} rooms={rooms} onClose={() => setEditing(null)} onSave={save} />}
    </div>
  );
}

function MoveEditor({ meeting, rooms, onClose, onSave }: { meeting: CalMeeting; rooms: CalRoom[]; onClose: () => void; onSave: (p: { dayOfWeek?: string; startTime?: string; facilityId?: string | null }) => void }) {
  const [day, setDay] = useState(meeting.dayOfWeek);
  const [time, setTime] = useState(meeting.startTime);
  const [room, setRoom] = useState(meeting.facilityId ?? "");
  const offCampus = meeting.kind === "CLINICAL";
  const eligible = rooms.filter((r) => (meeting.kind === "LAB" ? r.kind === "LAB" || r.kind === "SIM" : r.kind === "CLASSROOM" || r.kind === "OTHER"));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-800">{meeting.courseCode ?? meeting.courseName} {meeting.sectionCount > 1 ? `· section ${meeting.sectionIndex}/${meeting.sectionCount}` : ""}</h3>
            <p className="text-xs text-slate-500">{KIND_LABEL[meeting.kind] ?? meeting.kind} · {meeting.cohortName} · {meeting.programName}{meeting.staffName ? ` · ${meeting.staffName}` : ""}</p>
            <p className="text-[11px] text-slate-400">{meeting.seats} students · {meeting.lengthHours}h · runs {meeting.startLabel} → {meeting.endLabel}</p>
          </div>
          <Link href={`/programs/${meeting.programId}/offerings/${meeting.cohortId}`} className="text-xs text-rose-600 hover:underline">offering ↦</Link>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Day</span>
            <select value={day} onChange={(e) => setDay(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
              {DAYS.map((d) => <option key={d} value={d}>{DAY_FULL[d]}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Start time</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
          </label>
          {!offCampus && (
            <label className="col-span-2 block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Room</span>
              <select value={room} onChange={(e) => setRoom(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
                <option value="">— unroomed —</option>
                {eligible.map((r) => <option key={r.facilityId} value={r.facilityId} disabled={r.capacity != null && meeting.seats > r.capacity}>{r.name} (cap {r.capacity ?? "—"}){r.capacity != null && meeting.seats > r.capacity ? " — too small" : ""}</option>)}
              </select>
            </label>
          )}
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button onClick={() => onSave({ dayOfWeek: day, startTime: time, facilityId: offCampus ? undefined : (room || null) })} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700">Move</button>
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">Cancel</button>
        </div>
      </div>
    </div>
  );
}
