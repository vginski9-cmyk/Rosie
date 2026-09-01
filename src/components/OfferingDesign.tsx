"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moveMeeting, saveSessionOverride, clearSessionOverride } from "@/lib/actions";

// Design & sequence for ONE instantiation. The template is the boilerplate;
// this page is where a specific offering gets configured:
//  · every session in the order it actually happens (week → day → time),
//    with its REAL date;
//  · per-session overrides (week / day / time / notes) that apply to THIS
//    offering only — the template and every other offering stay untouched;
//  · the weekly booking pattern per course×kind (day · time · room or partner
//    site · staff) — the same MeetingPattern the master calendar shows.

export interface DsSession {
  id: string; kind: string; number: number; title: string | null;
  deliveryMode: string | null; location: string | null;
  lengthHours: number; maxStudents: number;
  week: number | null; dayOfWeek: string | null; startTime: string | null;
  notes: string | null; rotationType: string | null; clinicalMode: string | null;
}
export interface DsOverride { sessionId: string; week: number | null; dayOfWeek: string | null; startTime: string | null; notes: string | null }
export interface DsMeeting {
  id: string; courseId: string; kind: string; sectionIndex: number; sectionCount: number; seats: number;
  dayOfWeek: string; startTime: string; lengthHours: number;
  facilityId: string | null; facilityName: string | null;
  employerId: string | null; employerName: string | null;
  staffPersonId: string | null; staffName: string | null;
}
export interface DsCourse { id: string; code: string | null; name: string; sessions: DsSession[] }
export interface DsTerm { id: string; index: number; name: string; startWeek: number | null; endWeek: number | null; startDate: string | null; courses: DsCourse[] }
export interface DsRoom { id: string; name: string; kind: string; capacity: number | null }
export interface DsPerson { id: string; name: string; role: string }
export interface DsEmployer { id: string; name: string; setting: string | null }

const DAY_OFFSET: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const KIND_LABEL: Record<string, string> = { CLASS: "Class", LAB: "Lab", CLINICAL: "Clinical" };
const KIND_BADGE: Record<string, string> = { CLASS: "bg-sky-100 text-sky-700", LAB: "bg-violet-100 text-violet-700", CLINICAL: "bg-rose-100 text-rose-700" };
const fmtTime = (t: string | null) => {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "p" : "a"; const hh = h % 12 || 12;
  return m ? `${hh}:${String(m).padStart(2, "0")}${ap}` : `${hh}${ap}`;
};
const fmtDate = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function OfferingDesign({
  programId, cohortId, terms, meetings, overrides, rooms, people, employers,
}: {
  programId: string;
  cohortId: string;
  terms: DsTerm[];
  meetings: DsMeeting[];
  overrides: DsOverride[];
  rooms: DsRoom[];
  people: DsPerson[];
  employers: DsEmployer[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingSession, setEditingSession] = useState<string | null>(null);

  const ovBySession = new Map(overrides.map((o) => [o.sessionId, o]));
  const meetingsFor = (courseId: string, kind: string) =>
    meetings.filter((m) => m.courseId === courseId && m.kind === kind).sort((a, b) => a.sectionIndex - b.sectionIndex);

  const save = (id: string, patch: Parameters<typeof moveMeeting>[1]) => {
    setEditingId(null);
    startTransition(async () => { await moveMeeting(id, patch); router.refresh(); });
  };

  // Effective values for a session: override > weekly booking pattern > template.
  const effective = (courseId: string, sess: DsSession) => {
    const ov = ovBySession.get(sess.id);
    const m = meetingsFor(courseId, sess.kind)[0] ?? null;
    return {
      week: ov?.week ?? sess.week,
      day: ov?.dayOfWeek ?? m?.dayOfWeek ?? sess.dayOfWeek,
      time: ov?.startTime ?? m?.startTime ?? sess.startTime,
      notes: ov?.notes ?? sess.notes,
      overridden: !!ov,
      meeting: m,
    };
  };

  const sessionDateObj = (termStart: string | null, week: number | null, day: string | null): Date | null => {
    if (!termStart || !week) return null;
    const base = new Date(termStart + "T00:00:00Z");
    const off = day != null ? DAY_OFFSET[day] : undefined;
    return new Date(base.getTime() + ((week - 1) * 7 + (off ?? 0)) * 86400000);
  };

  return (
    <div className="space-y-8">
      {pending && <div className="text-xs text-slate-400">saving…</div>}
      {terms.map((t) => (
        <section key={t.id} className="space-y-4">
          <div className="flex flex-wrap items-baseline gap-3 border-b border-slate-200 pb-2">
            <h2 className="text-lg font-semibold">{t.name}</h2>
            <span className="text-sm text-slate-500">
              {t.startDate ? <>starts <strong className="text-slate-700">{fmtDate(new Date(t.startDate + "T00:00:00Z"))}</strong></> : "no date yet — set it on the offering page"}
              {" "}· {(t.endWeek ?? 16) - (t.startWeek ?? 1) + 1} instructional weeks
            </span>
          </div>

          {t.courses.map((c) => {
            const kinds = [...new Set(c.sessions.map((s) => s.kind))];
            // WHAT-HAPPENS-WHEN order: week → day → time → kind → number.
            const ordered = [...c.sessions].sort((a, b) => {
              const ea = effective(c.id, a), eb = effective(c.id, b);
              const wa = ea.week ?? 999, wb = eb.week ?? 999;
              if (wa !== wb) return wa - wb;
              const da = ea.day != null ? DAY_OFFSET[ea.day] ?? 8 : 8;
              const db = eb.day != null ? DAY_OFFSET[eb.day] ?? 8 : 8;
              if (da !== db) return da - db;
              const ta = ea.time ?? "99:99", tb = eb.time ?? "99:99";
              if (ta !== tb) return ta.localeCompare(tb);
              return a.kind.localeCompare(b.kind) || a.number - b.number;
            });
            return (
              <div key={c.id} className="rounded-xl border border-slate-200 bg-white">
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
                  <span className="font-semibold text-slate-800">{c.code ? `${c.code} · ` : ""}{c.name}</span>
                  <span className="text-xs text-slate-400">
                    {kinds.map((k) => `${c.sessions.filter((s) => s.kind === k).length} ${KIND_LABEL[k].toLowerCase()} sessions`).join(" · ")}
                  </span>
                </div>

                {/* The weekly pattern for each kind — THIS offering's booking. Edit = updates the master calendar. */}
                <div className="space-y-1.5 border-b border-slate-100 px-4 py-2.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Weekly pattern for this offering — day · time · location · staff (one booking per section)</div>
                  {kinds.map((k) => {
                    const ms = meetingsFor(c.id, k);
                    if (ms.length === 0) {
                      return <div key={k} className="text-xs text-slate-400"><span className={`mr-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${KIND_BADGE[k]}`}>{KIND_LABEL[k]}</span>not calendarized yet</div>;
                    }
                    return ms.map((m) => {
                      const isEditing = editingId === m.id;
                      const offCampus = m.kind === "CLINICAL";
                      const locName = offCampus ? (m.employerName ?? "site TBD") : (m.facilityName ?? "no room");
                      const locWarn = offCampus ? !m.employerId : !m.facilityId;
                      return isEditing ? (
                        <MeetingEditor key={m.id} m={m} rooms={rooms} people={people} employers={employers}
                          onCancel={() => setEditingId(null)} onSave={(patch) => save(m.id, patch)} />
                      ) : (
                        <div key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${KIND_BADGE[m.kind]}`}>{KIND_LABEL[m.kind]}{m.sectionCount > 1 ? ` §${m.sectionIndex}` : ""}</span>
                          <span className="tabular-nums font-medium text-slate-700">{m.dayOfWeek} {fmtTime(m.startTime)} · {m.lengthHours}h</span>
                          <span className={locWarn ? "font-medium text-amber-600" : "text-slate-600"}>{offCampus ? "@ " : ""}{locName}</span>
                          <span className={m.staffName ? "text-slate-600" : "font-medium text-amber-600"}>{m.staffName ?? (offCampus ? "no preceptor" : "no instructor")}</span>
                          <span className="text-slate-400">{m.seats} seats</span>
                          <button onClick={() => setEditingId(m.id)} className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-rose-100 hover:text-rose-700">edit</button>
                        </div>
                      );
                    });
                  })}
                </div>

                {/* Every session, in the order it actually happens, with its REAL date — click a row to override THIS offering's copy */}
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                        <th className="px-3 py-2 font-semibold">Date</th>
                        <th className="px-3 py-2 text-right font-semibold">Wk</th>
                        <th className="px-3 py-2 font-semibold">Day</th>
                        <th className="px-3 py-2 font-semibold">Time</th>
                        <th className="px-3 py-2 font-semibold">Kind</th>
                        <th className="px-3 py-2 font-semibold">Session title</th>
                        <th className="px-3 py-2 text-right font-semibold">Len (h)</th>
                        <th className="px-3 py-2 font-semibold">Location</th>
                        <th className="px-3 py-2 font-semibold">Instructor / preceptor</th>
                        <th className="px-3 py-2 font-semibold">Notes</th>
                        <th className="px-3 py-2 font-semibold" title="override this session for THIS offering only"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {ordered.map((sess) => {
                        const eff = effective(c.id, sess);
                        const m = eff.meeting;
                        const offCampus = sess.kind === "CLINICAL";
                        const d = sessionDateObj(t.startDate, eff.week, eff.day);
                        const loc = m
                          ? (offCampus ? (m.employerName ? `@ ${m.employerName}` : "@ site TBD") : (m.facilityName ?? "no room"))
                          : (sess.location ?? "—");
                        const staff = m?.staffName ?? null;
                        if (editingSession === sess.id) {
                          return (
                            <tr key={sess.id} className="border-b border-rose-100 bg-rose-50/50 align-top">
                              <td colSpan={11} className="px-3 py-2">
                                <form
                                  action={async (fd) => { setEditingSession(null); await saveSessionOverride(cohortId, sess.id, programId, fd); router.refresh(); }}
                                  className="flex flex-wrap items-end gap-2"
                                >
                                  <span className="self-center text-[11px] font-medium text-slate-600">{KIND_LABEL[sess.kind]} #{sess.number} · {sess.title ?? "untitled"} — override for THIS offering only:</span>
                                  <label className="block">
                                    <span className="mb-0.5 block text-[9px] font-semibold uppercase tracking-wide text-slate-400">Week</span>
                                    <input name="week" type="number" min={1} defaultValue={eff.week ?? ""} className="w-16 rounded border border-slate-300 px-1.5 py-1 text-right" />
                                  </label>
                                  <label className="block">
                                    <span className="mb-0.5 block text-[9px] font-semibold uppercase tracking-wide text-slate-400">Day</span>
                                    <select name="dayOfWeek" defaultValue={eff.day ?? ""} className="rounded border border-slate-300 px-1.5 py-1">
                                      <option value="">(pattern)</option>
                                      {ALL_DAYS.map((dd) => <option key={dd} value={dd}>{dd}</option>)}
                                    </select>
                                  </label>
                                  <label className="block">
                                    <span className="mb-0.5 block text-[9px] font-semibold uppercase tracking-wide text-slate-400">Start time</span>
                                    <input name="startTime" type="time" defaultValue={eff.time ?? ""} className="rounded border border-slate-300 px-1.5 py-1" />
                                  </label>
                                  <label className="block min-w-[16rem] flex-1">
                                    <span className="mb-0.5 block text-[9px] font-semibold uppercase tracking-wide text-slate-400">Notes (this offering)</span>
                                    <input name="notes" defaultValue={eff.notes ?? ""} className="w-full rounded border border-slate-300 px-1.5 py-1" />
                                  </label>
                                  <button className="rounded bg-rose-600 px-2.5 py-1 font-medium text-white hover:bg-rose-700">Save override</button>
                                  {eff.overridden && (
                                    <button type="button" onClick={async () => { setEditingSession(null); await clearSessionOverride(cohortId, sess.id, programId); router.refresh(); }} className="rounded border border-slate-300 px-2 py-1 text-slate-500 hover:bg-white">Clear → template</button>
                                  )}
                                  <button type="button" onClick={() => setEditingSession(null)} className="rounded border border-slate-300 px-2 py-1 text-slate-500 hover:bg-white">Cancel</button>
                                </form>
                              </td>
                            </tr>
                          );
                        }
                        return (
                          <tr key={sess.id} onClick={() => setEditingSession(sess.id)} title="click to adjust this session for THIS offering" className={`cursor-pointer border-b border-slate-50 align-top hover:bg-rose-50/40 ${eff.overridden ? "bg-amber-50/60" : ""}`}>
                            <td className="whitespace-nowrap px-3 py-1.5 font-medium text-slate-700">{d ? (eff.day != null ? fmtDate(d) : `wk of ${fmtDate(d)}`) : "—"}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{eff.week ?? "—"}</td>
                            <td className="px-3 py-1.5 text-slate-600">{eff.day ?? "—"}</td>
                            <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-slate-600">{fmtTime(eff.time)}</td>
                            <td className="px-3 py-1.5"><span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${KIND_BADGE[sess.kind]}`}>{KIND_LABEL[sess.kind]}</span></td>
                            <td className="max-w-[24rem] px-3 py-1.5 text-slate-700">{sess.title ?? "—"}{sess.rotationType ? <span className="ml-1 text-slate-400">· {sess.rotationType}</span> : null}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{sess.lengthHours}</td>
                            <td className={`whitespace-nowrap px-3 py-1.5 ${m && ((offCampus && !m.employerId) || (!offCampus && !m.facilityId)) ? "font-medium text-amber-600" : "text-slate-600"}`}>{loc}</td>
                            <td className={`whitespace-nowrap px-3 py-1.5 ${staff ? "text-slate-600" : "text-amber-600"}`}>{staff ?? "unassigned"}</td>
                            <td className="max-w-[14rem] px-3 py-1.5 text-slate-400">{eff.notes ?? ""}</td>
                            <td className="px-3 py-1.5">{eff.overridden ? <span className="rounded-full bg-amber-200 px-1.5 py-0.5 text-[9px] font-semibold text-amber-800" title="this offering overrides the template here">edited</span> : <span className="text-slate-300">✎</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
          {t.courses.length === 0 && <p className="text-sm text-slate-400">No courses in this term.</p>}
        </section>
      ))}
    </div>
  );
}

function MeetingEditor({ m, rooms, people, employers, onCancel, onSave }: {
  m: DsMeeting; rooms: DsRoom[]; people: DsPerson[]; employers: DsEmployer[];
  onCancel: () => void; onSave: (p: { dayOfWeek?: string; startTime?: string; facilityId?: string | null; employerId?: string | null; staffPersonId?: string | null }) => void;
}) {
  const [day, setDay] = useState(m.dayOfWeek);
  const [time, setTime] = useState(m.startTime);
  const [room, setRoom] = useState(m.facilityId ?? "");
  const [site, setSite] = useState(m.employerId ?? "");
  const [staff, setStaff] = useState(m.staffPersonId ?? "");
  const offCampus = m.kind === "CLINICAL";
  const staffPool = offCampus ? people.filter((p) => p.role === "preceptor") : people.filter((p) => p.role !== "preceptor");
  const eligible = rooms.filter((r) => (m.kind === "LAB" ? r.kind === "LAB" || r.kind === "SIM" : r.kind === "CLASSROOM" || r.kind === "OTHER"));
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg bg-rose-50/60 p-2 text-xs ring-1 ring-rose-200">
      <span className={`self-center rounded-full px-2 py-0.5 text-[10px] font-medium ${KIND_BADGE[m.kind]}`}>{KIND_LABEL[m.kind]}{m.sectionCount > 1 ? ` §${m.sectionIndex}` : ""}</span>
      <label className="block">
        <span className="mb-0.5 block text-[9px] font-semibold uppercase tracking-wide text-slate-400">Day</span>
        <select value={day} onChange={(e) => setDay(e.target.value)} className="rounded border border-slate-300 px-1.5 py-1">
          {ALL_DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="mb-0.5 block text-[9px] font-semibold uppercase tracking-wide text-slate-400">Start</span>
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="rounded border border-slate-300 px-1.5 py-1" />
      </label>
      {offCampus ? (
        <label className="block">
          <span className="mb-0.5 block text-[9px] font-semibold uppercase tracking-wide text-slate-400">Clinical site</span>
          <select value={site} onChange={(e) => setSite(e.target.value)} className="max-w-[14rem] rounded border border-slate-300 px-1.5 py-1">
            <option value="">— site TBD —</option>
            {employers.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </label>
      ) : (
        <label className="block">
          <span className="mb-0.5 block text-[9px] font-semibold uppercase tracking-wide text-slate-400">Room</span>
          <select value={room} onChange={(e) => setRoom(e.target.value)} className="max-w-[14rem] rounded border border-slate-300 px-1.5 py-1">
            <option value="">— unroomed —</option>
            {eligible.map((r) => <option key={r.id} value={r.id} disabled={r.capacity != null && m.seats > r.capacity}>{r.name} (cap {r.capacity ?? "—"})</option>)}
          </select>
        </label>
      )}
      <label className="block">
        <span className="mb-0.5 block text-[9px] font-semibold uppercase tracking-wide text-slate-400">{offCampus ? "Preceptor" : "Instructor"}</span>
        <select value={staff} onChange={(e) => setStaff(e.target.value)} className="max-w-[12rem] rounded border border-slate-300 px-1.5 py-1">
          <option value="">— unassigned —</option>
          {staffPool.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <button onClick={() => onSave({ dayOfWeek: day, startTime: time, facilityId: offCampus ? undefined : (room || null), employerId: offCampus ? (site || null) : undefined, staffPersonId: staff || null })} className="rounded bg-rose-600 px-2.5 py-1 font-medium text-white hover:bg-rose-700">Save</button>
      <button onClick={onCancel} className="rounded border border-slate-300 px-2 py-1 text-slate-500 hover:bg-white">Cancel</button>
    </div>
  );
}
