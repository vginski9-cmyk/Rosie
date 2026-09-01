"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moveMeeting, saveSessionOverride, clearSessionOverride } from "@/lib/actions";
import { computeColumns, usHoliday, type WorkloadAssumptions, type SessionInput } from "@/lib/capacitymodel";

// Design & sequence for ONE instantiation — as configurable as the template's
// sheet, without touching the template. Every input column is editable inline;
// edits recalculate the formula columns instantly at THIS offering's
// enrollment; Save row stores only the fields that differ from the template
// (a per-offering override). Rows are ordered by when they actually happen
// (week → day → time), each with its real date; holiday collisions are
// flagged so the configurer can move them.

export interface DsSession {
  id: string; kind: string; number: number; title: string | null;
  deliveryMode: string | null; location: string | null;
  lengthHours: number; maxStudents: number;
  facultyNeeded: number; facultyContactPolicy: number | null;
  supportStaffNeeded: number; supportContactPolicy: number | null;
  preceptorsNeeded: number; preceptorContactPolicy: number | null;
  week: number | null; dayOfWeek: string | null; startTime: string | null;
  notes: string | null; rotationType: string | null; clinicalMode: string | null;
}
export interface DsOverride {
  sessionId: string; week: number | null; dayOfWeek: string | null; startTime: string | null; notes: string | null;
  title: string | null; deliveryMode: string | null; location: string | null;
  lengthHours: number | null; maxStudents: number | null;
  facultyNeeded: number | null; facultyContactPolicy: number | null;
  supportStaffNeeded: number | null; supportContactPolicy: number | null;
  preceptorsNeeded: number | null; preceptorContactPolicy: number | null;
  rotationType: string | null; clinicalMode: string | null;
}
export interface DsMeeting {
  id: string; courseId: string; kind: string; sectionIndex: number; sectionCount: number; seats: number;
  dayOfWeek: string; startTime: string; lengthHours: number;
  facilityId: string | null; facilityName: string | null;
  employerId: string | null; employerName: string | null;
  staffPersonId: string | null; staffName: string | null;
}
export interface DsCourse { id: string; code: string | null; name: string; startDate: string | null; endDate: string | null; sessions: DsSession[] }
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
const n1 = (v: number | null) => (v == null ? "—" : (Math.round(v * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 }));

/** One editable row = the template session with this offering's overrides applied. */
type RowState = DsSession & { overridden: boolean };

export function OfferingDesign({
  programId, cohortId, terms, meetings, overrides, rooms, people, employers, enrollmentByTerm, assumptions,
}: {
  programId: string;
  cohortId: string;
  terms: DsTerm[];
  meetings: DsMeeting[];
  overrides: DsOverride[];
  rooms: DsRoom[];
  people: DsPerson[];
  employers: DsEmployer[];
  /** Per-term enrollment target (1-based index) — drives the computed columns. */
  enrollmentByTerm: Record<number, number>;
  assumptions: WorkloadAssumptions;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);

  // Local editable copy of every session (override-merged) so formula columns
  // recalculate as you type — like the template sheet, but per offering.
  const buildRows = (): Map<string, RowState> => {
    const ov = new Map(overrides.map((o) => [o.sessionId, o]));
    const m = new Map<string, RowState>();
    for (const t of terms) for (const c of t.courses) for (const s of c.sessions) {
      const o = ov.get(s.id);
      const mt = meetings.find((x) => x.courseId === c.id && x.kind === s.kind);
      m.set(s.id, {
        ...s,
        title: o?.title ?? s.title,
        deliveryMode: o?.deliveryMode ?? s.deliveryMode,
        location: o?.location ?? s.location,
        lengthHours: o?.lengthHours ?? s.lengthHours,
        maxStudents: o?.maxStudents ?? s.maxStudents,
        facultyNeeded: o?.facultyNeeded ?? s.facultyNeeded,
        facultyContactPolicy: o?.facultyContactPolicy ?? s.facultyContactPolicy,
        supportStaffNeeded: o?.supportStaffNeeded ?? s.supportStaffNeeded,
        supportContactPolicy: o?.supportContactPolicy ?? s.supportContactPolicy,
        preceptorsNeeded: o?.preceptorsNeeded ?? s.preceptorsNeeded,
        preceptorContactPolicy: o?.preceptorContactPolicy ?? s.preceptorContactPolicy,
        week: o?.week ?? s.week,
        dayOfWeek: o?.dayOfWeek ?? mt?.dayOfWeek ?? s.dayOfWeek,
        startTime: o?.startTime ?? mt?.startTime ?? s.startTime,
        notes: o?.notes ?? s.notes,
        rotationType: o?.rotationType ?? s.rotationType,
        clinicalMode: o?.clinicalMode ?? s.clinicalMode,
        overridden: !!o,
      });
    }
    return m;
  };
  const [rows, setRows] = useState<Map<string, RowState>>(buildRows);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setRows(buildRows()); setDirty(new Set()); }, [terms, overrides, meetings]);

  const setField = (id: string, field: keyof RowState, value: unknown) => {
    setRows((m) => { const n = new Map(m); const r = n.get(id); if (r) n.set(id, { ...r, [field]: value }); return n; });
    setDirty((d) => new Set(d).add(id));
  };

  const meetingsFor = (courseId: string, kind: string) =>
    meetings.filter((m) => m.courseId === courseId && m.kind === kind).sort((a, b) => a.sectionIndex - b.sectionIndex);

  const saveMeeting = (id: string, patch: Parameters<typeof moveMeeting>[1]) => {
    setEditingId(null);
    startTransition(async () => { await moveMeeting(id, patch); router.refresh(); });
  };

  const sessionDateObj = (termStart: string | null, week: number | null, day: string | null): Date | null => {
    if (!termStart || !week) return null;
    const base = new Date(termStart + "T00:00:00Z");
    const off = day != null ? DAY_OFFSET[day] : undefined;
    return new Date(base.getTime() + ((week - 1) * 7 + (off ?? 0)) * 86400000);
  };

  const inp = "w-full rounded border border-blue-200 bg-blue-50/70 px-1 py-0.5 text-[11px] text-blue-900 focus:bg-white focus:outline-blue-500";
  const calc = "rounded bg-emerald-50/80 px-1.5 py-0.5 text-right font-mono tabular-nums text-emerald-900";

  return (
    <div className="space-y-8">
      {pending && <div className="text-xs text-slate-400">saving…</div>}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-blue-300 bg-blue-50" /> editable for THIS offering (Save row stores only what differs from the template)</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-emerald-300 bg-emerald-50" /> live formula at this offering&apos;s enrollment</span>
        <span className="inline-flex items-center gap-1"><span className="rounded-full bg-amber-200 px-1.5 text-[9px] font-semibold text-amber-800">edited</span> row overrides the template</span>
        <span className="inline-flex items-center gap-1 text-rose-600">⚠ holiday collision — move it</span>
      </div>

      {terms.map((t) => (
        <section key={t.id} className="space-y-4">
          <div className="flex flex-wrap items-baseline gap-3 border-b border-slate-200 pb-2">
            <h2 className="text-lg font-semibold">{t.name}</h2>
            <span className="text-sm text-slate-500">
              {t.startDate ? <>starts <strong className="text-slate-700">{fmtDate(new Date(t.startDate + "T00:00:00Z"))}</strong></> : "no date yet — set it on the offering page"}
              {" "}· {(t.endWeek ?? 16) - (t.startWeek ?? 1) + 1} instructional weeks · enrollment {enrollmentByTerm[t.index] ?? "—"}
            </span>
          </div>

          {t.courses.map((c) => {
            const kinds = [...new Set(c.sessions.map((s) => s.kind))];
            const courseRows = c.sessions.map((s) => rows.get(s.id)!).filter(Boolean);
            const ordered = [...courseRows].sort((a, b) => {
              const wa = a.week ?? 999, wb = b.week ?? 999;
              if (wa !== wb) return wa - wb;
              const da = a.dayOfWeek != null ? DAY_OFFSET[a.dayOfWeek] ?? 8 : 8;
              const db = b.dayOfWeek != null ? DAY_OFFSET[b.dayOfWeek] ?? 8 : 8;
              if (da !== db) return da - db;
              const ta = a.startTime ?? "99:99", tb = b.startTime ?? "99:99";
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
                  {c.startDate && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700" title="this offering runs this course on its own window (set on the offering page)">
                      runs {fmtDate(new Date(c.startDate + "T00:00:00Z"))}{c.endDate ? ` → ${fmtDate(new Date(c.endDate + "T00:00:00Z"))}` : ""}
                    </span>
                  )}
                </div>

                {/* Weekly booking per kind/section — day · time · location · staff. Same record as the master calendar. */}
                <div className="space-y-1.5 border-b border-slate-100 px-4 py-2.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Weekly pattern for this offering — location &amp; staff live here (one booking per section)</div>
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
                          onCancel={() => setEditingId(null)} onSave={(patch) => saveMeeting(m.id, patch)} />
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

                {/* The fully-editable session sheet, in the order things actually happen */}
                <div className="overflow-x-auto">
                  <table className="min-w-[86rem] text-[11px]">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                        <th className="px-2 py-2 font-semibold">Date</th>
                        <th className="px-2 py-2 font-semibold">Wk</th>
                        <th className="px-2 py-2 font-semibold">Day</th>
                        <th className="px-2 py-2 font-semibold">Time</th>
                        <th className="px-2 py-2 font-semibold">Kind</th>
                        <th className="px-2 py-2 font-semibold">Session title</th>
                        <th className="px-2 py-2 font-semibold">Delivery</th>
                        <th className="px-2 py-2 font-semibold" title="Session length (in hours)">Len</th>
                        <th className="px-2 py-2 font-semibold" title="Max number of students that ONE session can accommodate">Cap</th>
                        <th className="px-2 py-2 font-semibold" title="Number of faculty required to teach full session">Fac</th>
                        <th className="px-2 py-2 font-semibold" title="Contact hour policy for faculty">FacPol</th>
                        <th className="px-2 py-2 font-semibold" title="Number of preceptors required">Prec</th>
                        <th className="px-2 py-2 font-semibold" title="Contact hour policy for preceptors">PrecPol</th>
                        <th className="px-2 py-2 font-semibold">Rotation</th>
                        <th className="px-2 py-2 font-semibold">Notes</th>
                        <th className="px-2 py-2 text-right font-semibold" title="= ROUNDUP(enrollment ÷ Cap)">Sec</th>
                        <th className="px-2 py-2 text-right font-semibold" title="= Len × Fac × Sec">FacHr</th>
                        <th className="px-2 py-2 text-right font-semibold" title="= Sec × Prec × Len × PrecPol">PrecHr</th>
                        <th className="px-2 py-2 font-semibold">Location · staff</th>
                        <th className="px-2 py-2 font-semibold" />
                      </tr>
                    </thead>
                    <tbody>
                      {ordered.map((r) => {
                        const enrollment = enrollmentByTerm[t.index] ?? 0;
                        const comp = computeColumns(r as unknown as SessionInput, enrollment, assumptions);
                        const d = sessionDateObj(c.startDate ?? t.startDate, r.week, r.dayOfWeek);
                        const holiday = d && r.dayOfWeek != null ? usHoliday(d) : null;
                        const m = meetingsFor(c.id, r.kind)[0] ?? null;
                        const offCampus = r.kind === "CLINICAL";
                        const loc = m ? (offCampus ? (m.employerName ? `@ ${m.employerName}` : "@ site TBD") : (m.facilityName ?? "no room")) : (r.location ?? "—");
                        const isDirty = dirty.has(r.id);
                        return (
                          <tr key={r.id} className={`border-b border-slate-50 align-top ${holiday ? "bg-rose-50/60" : r.overridden ? "bg-amber-50/50" : ""}`}>
                            <td className="whitespace-nowrap px-2 py-1 font-medium text-slate-700">
                              {d ? (r.dayOfWeek != null ? fmtDate(d) : `wk of ${fmtDate(d)}`) : "—"}
                              {holiday && <span className="ml-1 rounded-full bg-rose-200 px-1.5 py-0.5 text-[9px] font-semibold text-rose-800" title={`${holiday} — move this session (edit Wk/Day, then Save row)`}>⚠ {holiday}</span>}
                            </td>
                            <td className="w-12 px-1 py-0.5"><input type="number" min={1} value={r.week ?? ""} onChange={(e) => setField(r.id, "week", e.target.value === "" ? null : Number(e.target.value))} className={`${inp} text-right`} /></td>
                            <td className="w-16 px-1 py-0.5">
                              <select value={r.dayOfWeek ?? ""} onChange={(e) => setField(r.id, "dayOfWeek", e.target.value || null)} className={inp}>
                                <option value="">—</option>
                                {ALL_DAYS.map((dd) => <option key={dd} value={dd}>{dd}</option>)}
                              </select>
                            </td>
                            <td className="w-24 px-1 py-0.5"><input type="time" value={r.startTime ?? ""} onChange={(e) => setField(r.id, "startTime", e.target.value || null)} className={inp} /></td>
                            <td className="px-2 py-1"><span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${KIND_BADGE[r.kind]}`}>{KIND_LABEL[r.kind]}</span></td>
                            <td className="min-w-[16rem] px-1 py-0.5"><input value={r.title ?? ""} onChange={(e) => setField(r.id, "title", e.target.value || null)} className={inp} /></td>
                            <td className="w-24 px-1 py-0.5"><input value={r.deliveryMode ?? ""} onChange={(e) => setField(r.id, "deliveryMode", e.target.value || null)} className={inp} /></td>
                            <td className="w-14 px-1 py-0.5"><input type="number" step="any" value={r.lengthHours ?? ""} onChange={(e) => setField(r.id, "lengthHours", Number(e.target.value) || 0)} className={`${inp} text-right`} /></td>
                            <td className="w-14 px-1 py-0.5"><input type="number" value={r.maxStudents ?? ""} onChange={(e) => setField(r.id, "maxStudents", Number(e.target.value) || 1)} className={`${inp} text-right`} /></td>
                            <td className="w-14 px-1 py-0.5"><input type="number" step="any" value={r.facultyNeeded ?? ""} onChange={(e) => setField(r.id, "facultyNeeded", Number(e.target.value) || 0)} className={`${inp} text-right`} /></td>
                            <td className="w-14 px-1 py-0.5"><input type="number" step="any" value={r.facultyContactPolicy ?? ""} onChange={(e) => setField(r.id, "facultyContactPolicy", e.target.value === "" ? null : Number(e.target.value))} className={`${inp} text-right`} /></td>
                            <td className="w-14 px-1 py-0.5"><input type="number" step="any" value={r.preceptorsNeeded ?? ""} onChange={(e) => setField(r.id, "preceptorsNeeded", Number(e.target.value) || 0)} className={`${inp} text-right`} /></td>
                            <td className="w-14 px-1 py-0.5"><input type="number" step="any" value={r.preceptorContactPolicy ?? ""} onChange={(e) => setField(r.id, "preceptorContactPolicy", e.target.value === "" ? null : Number(e.target.value))} className={`${inp} text-right`} /></td>
                            <td className="w-28 px-1 py-0.5"><input value={r.rotationType ?? ""} onChange={(e) => setField(r.id, "rotationType", e.target.value || null)} className={inp} /></td>
                            <td className="min-w-[10rem] px-1 py-0.5"><input value={r.notes ?? ""} onChange={(e) => setField(r.id, "notes", e.target.value || null)} className={inp} /></td>
                            <td className="px-2 py-1 text-right"><span className={calc} title="= ROUNDUP(enrollment ÷ Cap)">{comp.divByZero ? "#DIV/0!" : comp.Y}</span></td>
                            <td className="px-2 py-1 text-right"><span className={calc} title="= Len × Fac × Sec">{n1(comp.Z)}</span></td>
                            <td className="px-2 py-1 text-right"><span className={calc} title="= Sec × Prec × Len × PrecPol">{n1(comp.AC)}</span></td>
                            <td className="whitespace-nowrap px-2 py-1 text-slate-500">
                              <span className={m && ((offCampus && !m.employerId) || (!offCampus && !m.facilityId)) ? "font-medium text-amber-600" : ""}>{loc}</span>
                              <span className={`block ${m?.staffName ? "" : "text-amber-600"}`}>{m?.staffName ?? "unassigned"}</span>
                            </td>
                            <td className="whitespace-nowrap px-2 py-1">
                              <form action={async (fd) => { await saveSessionOverride(cohortId, r.id, programId, fd); setDirty((dd) => { const n = new Set(dd); n.delete(r.id); return n; }); router.refresh(); }}>
                                {(["week", "dayOfWeek", "startTime", "notes", "title", "deliveryMode", "lengthHours", "maxStudents", "facultyNeeded", "facultyContactPolicy", "supportStaffNeeded", "supportContactPolicy", "preceptorsNeeded", "preceptorContactPolicy", "rotationType", "clinicalMode"] as (keyof RowState)[]).map((f) => (
                                  <input key={String(f)} type="hidden" name={String(f)} value={r[f] == null ? "" : String(r[f])} readOnly />
                                ))}
                                <button className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${isDirty ? "bg-rose-600 text-white hover:bg-rose-700" : "bg-slate-100 text-slate-400"}`}>Save row</button>
                              </form>
                              {r.overridden && (
                                <button onClick={async () => { await clearSessionOverride(cohortId, r.id, programId); router.refresh(); }} className="mt-0.5 block text-[9px] text-amber-700 hover:underline" title="remove this offering's override — back to the template">
                                  <span className="rounded-full bg-amber-200 px-1.5 py-0.5 font-semibold text-amber-800">edited</span> clear
                                </button>
                              )}
                            </td>
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
