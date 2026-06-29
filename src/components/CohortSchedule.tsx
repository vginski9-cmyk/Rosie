"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moveMeeting } from "@/lib/actions";

export interface CohortMeeting {
  id: string; courseId: string; courseCode: string | null; courseName: string;
  termIndex: number; termName: string;
  kind: string; sectionIndex: number; sectionCount: number; seats: number;
  dayOfWeek: string; startTime: string; endTime: string; lengthHours: number;
  facilityId: string | null; facilityName: string | null; facilityKind: string | null;
  staffPersonId: string | null; staffName: string | null;
  weekStartMs: number; weekEndMs: number; conflict: boolean;
}
export interface SchedRoom { id: string; name: string; kind: string; capacity: number | null }

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const KIND_LABEL: Record<string, string> = { CLASS: "Lecture", LAB: "Lab", CLINICAL: "Clinical" };
const KIND_BADGE: Record<string, string> = { CLASS: "bg-sky-100 text-sky-700", LAB: "bg-violet-100 text-violet-700", CLINICAL: "bg-orange-100 text-orange-700" };
const fmt = (t: string) => { const [h, m] = t.split(":").map(Number); const ap = h >= 12 ? "p" : "a"; const hh = h % 12 || 12; return m ? `${hh}:${String(m).padStart(2, "0")}${ap}` : `${hh}${ap}`; };

export function CohortSchedule({ meetings, rooms, conflictCount }: { meetings: CohortMeeting[]; rooms: SchedRoom[]; conflictCount: number }) {
  const router = useRouter();
  const [editing, setEditing] = useState<CohortMeeting | null>(null);
  const [pending, startTransition] = useTransition();
  const move = (id: string, patch: Parameters<typeof moveMeeting>[1]) => { setEditing(null); startTransition(async () => { await moveMeeting(id, patch); router.refresh(); }); };

  // Group by term → course; within a course list its kind/section meetings.
  const byTerm = useMemo(() => {
    const terms = new Map<number, { name: string; courses: Map<string, { code: string | null; name: string; rows: CohortMeeting[] }> }>();
    for (const m of meetings) {
      const t = terms.get(m.termIndex) ?? { name: m.termName, courses: new Map() };
      const c = t.courses.get(m.courseId) ?? { code: m.courseCode, name: m.courseName, rows: [] };
      c.rows.push(m); t.courses.set(m.courseId, c); terms.set(m.termIndex, t);
    }
    return [...terms.entries()].sort((a, b) => a[0] - b[0]);
  }, [meetings]);

  // Staffing rollup: per instructor, weekly contact hours across this cohort.
  const staffing = useMemo(() => {
    const m = new Map<string, { name: string; hours: number; meetings: number }>();
    for (const x of meetings) {
      if (!x.staffPersonId) continue;
      const e = m.get(x.staffPersonId) ?? { name: x.staffName ?? "—", hours: 0, meetings: 0 };
      e.hours += x.lengthHours; e.meetings += 1; m.set(x.staffPersonId, e);
    }
    return [...m.values()].sort((a, b) => b.hours - a.hours);
  }, [meetings]);

  const roomed = meetings.filter((m) => m.facilityId).length;
  const unroomed = meetings.filter((m) => !m.facilityId && m.kind !== "CLINICAL").length;

  if (meetings.length === 0) return <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-400">No scheduled meetings for this offering yet.</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="rounded-full bg-slate-100 px-2 py-0.5">{meetings.length} meetings · {roomed} roomed</span>
        {unroomed > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">{unroomed} need a room</span>}
        {conflictCount > 0
          ? <span className="rounded-full bg-rose-600 px-2 py-0.5 font-medium text-white">{conflictCount} conflicts</span>
          : <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700">conflict-free</span>}
        {pending && <span className="text-slate-400">saving…</span>}
        <span className="text-slate-400">— sections, rooms &amp; staff are one booking; editing here updates the master calendar.</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
        <div className="space-y-4">
          {byTerm.map(([termIndex, term]) => (
            <div key={termIndex} className="rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">{term.name}</div>
              <div className="divide-y divide-slate-50">
                {[...term.courses.values()].map((c) => (
                  <div key={c.name} className="px-3 py-2">
                    <div className="text-[13px] font-medium text-slate-800">{c.code ? `${c.code} · ` : ""}{c.name}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {c.rows.sort((a, b) => a.kind.localeCompare(b.kind) || a.sectionIndex - b.sectionIndex).map((m) => (
                        <button key={m.id} onClick={() => setEditing(m)}
                          className={`group flex items-center gap-1.5 rounded-lg border px-2 py-1 text-left text-[11px] hover:border-rose-300 ${m.conflict ? "border-rose-300 bg-rose-50" : "border-slate-200 bg-slate-50/50"}`}>
                          <span className={`rounded px-1 py-0.5 text-[9px] font-medium ${KIND_BADGE[m.kind] ?? "bg-slate-200"}`}>{KIND_LABEL[m.kind] ?? m.kind}{m.sectionCount > 1 ? ` ${m.sectionIndex}/${m.sectionCount}` : ""}</span>
                          <span className="text-slate-600">{m.dayOfWeek} {fmt(m.startTime)}</span>
                          <span className={m.facilityName ? "text-slate-500" : "text-amber-600"}>{m.facilityName ?? "⚠ no room"}</span>
                          <span className="text-slate-400">{m.seats} seats</span>
                          {m.staffName && <span className="text-slate-400">· {m.staffName}</span>}
                          {m.conflict && <span className="text-rose-600">⚠</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Staffing rollup for this offering */}
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Staffing (weekly hrs)</h3>
          <div className="space-y-1.5">
            {staffing.map((s) => (
              <div key={s.name} className="flex items-center justify-between text-[12px]">
                <span className="truncate text-slate-700">{s.name}</span>
                <span className="tabular-nums text-slate-400">{Math.round(s.hours)}h · {s.meetings}</span>
              </div>
            ))}
            {staffing.length === 0 && <p className="text-[11px] text-slate-400">No staff assigned.</p>}
          </div>
        </div>
      </div>

      {editing && <Editor meeting={editing} rooms={rooms} onClose={() => setEditing(null)} onSave={move} />}
    </div>
  );
}

function Editor({ meeting, rooms, onClose, onSave }: { meeting: CohortMeeting; rooms: SchedRoom[]; onClose: () => void; onSave: (id: string, p: { dayOfWeek?: string; startTime?: string; facilityId?: string | null }) => void }) {
  const [day, setDay] = useState(meeting.dayOfWeek);
  const [time, setTime] = useState(meeting.startTime);
  const [room, setRoom] = useState(meeting.facilityId ?? "");
  const offCampus = meeting.kind === "CLINICAL";
  const eligible = rooms.filter((r) => (meeting.kind === "LAB" ? r.kind === "LAB" || r.kind === "SIM" : r.kind === "CLASSROOM" || r.kind === "OTHER"));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-slate-800">{meeting.courseCode ?? meeting.courseName} · {KIND_LABEL[meeting.kind] ?? meeting.kind}{meeting.sectionCount > 1 ? ` ${meeting.sectionIndex}/${meeting.sectionCount}` : ""}</h3>
        <p className="text-xs text-slate-500">{meeting.seats} students · {meeting.lengthHours}h{meeting.staffName ? ` · ${meeting.staffName}` : ""}</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Day</span>
            <select value={day} onChange={(e) => setDay(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">{DAYS.map((d) => <option key={d} value={d}>{d}</option>)}</select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Start</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
          </label>
          {!offCampus && (
            <label className="col-span-2 block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Room</span>
              <select value={room} onChange={(e) => setRoom(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
                <option value="">— unroomed —</option>
                {eligible.map((r) => <option key={r.id} value={r.id} disabled={r.capacity != null && meeting.seats > r.capacity}>{r.name} (cap {r.capacity ?? "—"}){r.capacity != null && meeting.seats > r.capacity ? " — too small" : ""}</option>)}
              </select>
            </label>
          )}
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button onClick={() => onSave(meeting.id, { dayOfWeek: day, startTime: time, facilityId: offCampus ? undefined : (room || null) })} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700">Save</button>
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">Cancel</button>
        </div>
      </div>
    </div>
  );
}
