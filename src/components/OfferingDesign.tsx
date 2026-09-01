"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moveMeeting, saveSessionOverride, clearSessionOverride } from "@/lib/actions";
import {
  CAPACITY_HEADERS, CAPACITY_FORMULAS, computeColumns, usHoliday,
  type WorkloadAssumptions, type SessionInput,
} from "@/lib/capacitymodel";
import { SHEET_COLS, SHEET_FIELD_OF, SHEET_NUM_FIELDS } from "@/components/SessionSheet";

// Design & sequence for ONE instantiation — the EXACT same Raw Data &
// Calculations schema as the template's sheet (columns A–AE, same headers,
// same blue-input / green-formula cells), except column C (Enrollment) is
// THIS offering's per-term enrollment target from its pipeline, and every
// formula column computes at that enrollment. Save row stores only the
// fields that differ from the template (a per-offering override). Rows are
// ordered by when they actually happen (week → day → time), each with its
// real date; holiday collisions are flagged so the configurer can move them.

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
const num = (v: number | null, dp = 2) =>
  v == null ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: dp });
const n0 = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 });
const n1 = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 1 });
const n2 = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });

/** One editable row = the template session with this offering's overrides applied. */
type RowState = DsSession & { overridden: boolean };

/** What a set of rows needs at this offering's enrollment — the template's tallies, at reality. */
interface Tally {
  ps: { CLASS: number; LAB: number; CLINICAL: number };
  sec: { CLASS: number; LAB: number; CLINICAL: number };
  space: number; facHrs: number; facFte: number; precHrs: number; precFte: number;
}
const emptyTally = (): Tally => ({ ps: { CLASS: 0, LAB: 0, CLINICAL: 0 }, sec: { CLASS: 0, LAB: 0, CLINICAL: 0 }, space: 0, facHrs: 0, facFte: 0, precHrs: 0, precFte: 0 });
const tallyOf = (rs: RowState[], enrollment: number, a: WorkloadAssumptions): Tally => {
  const t = emptyTally();
  for (const r of rs) {
    const k = (r.kind in t.ps ? r.kind : "CLASS") as keyof Tally["ps"];
    t.ps[k] += r.lengthHours ?? 0;
    const c = computeColumns(r as unknown as SessionInput, enrollment, a);
    if (c.divByZero) continue;
    t.sec[k] += c.Y ?? 0; t.space += c.X ?? 0;
    t.facHrs += c.Z ?? 0; t.facFte += c.AA ?? 0;
    t.precHrs += c.AC ?? 0; t.precFte += c.AD ?? 0;
  }
  return t;
};
const addTally = (a: Tally, b: Tally): Tally => ({
  ps: { CLASS: a.ps.CLASS + b.ps.CLASS, LAB: a.ps.LAB + b.ps.LAB, CLINICAL: a.ps.CLINICAL + b.ps.CLINICAL },
  sec: { CLASS: a.sec.CLASS + b.sec.CLASS, LAB: a.sec.LAB + b.sec.LAB, CLINICAL: a.sec.CLINICAL + b.sec.CLINICAL },
  space: a.space + b.space, facHrs: a.facHrs + b.facHrs, facFte: a.facFte + b.facFte,
  precHrs: a.precHrs + b.precHrs, precFte: a.precFte + b.precFte,
});

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
  /** Per-term enrollment target (1-based index) — drives column C and every formula. */
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

  const OVERRIDE_FIELDS = ["week", "dayOfWeek", "startTime", "notes", "title", "deliveryMode", "location", "lengthHours", "maxStudents", "facultyNeeded", "facultyContactPolicy", "supportStaffNeeded", "supportContactPolicy", "preceptorsNeeded", "preceptorContactPolicy", "rotationType", "clinicalMode"] as (keyof RowState)[];

  return (
    <div className="space-y-8">
      {pending && <div className="text-xs text-slate-400">saving…</div>}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-blue-300 bg-blue-50" /> editable for THIS offering (Save row stores only what differs from the template)</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-emerald-300 bg-emerald-50" /> live formula at this offering&apos;s enrollment target (column C)</span>
        <span className="inline-flex items-center gap-1"><span className="rounded-full bg-amber-200 px-1.5 text-[9px] font-semibold text-amber-800">edited</span> row overrides the template</span>
        <span className="inline-flex items-center gap-1 text-rose-600">⚠ holiday collision — move it</span>
      </div>

      {terms.map((t) => {
        const enrollment = enrollmentByTerm[t.index] ?? 0;
        // The template's tallies, computed at THIS offering's enrollment target.
        const courseTallies = new Map<string, Tally>();
        for (const c of t.courses) {
          courseTallies.set(c.id, tallyOf(c.sessions.map((s) => rows.get(s.id)!).filter(Boolean), enrollment, assumptions));
        }
        const tt = [...courseTallies.values()].reduce(addTally, emptyTally());
        const secTot = tt.sec.CLASS + tt.sec.LAB + tt.sec.CLINICAL;
        return (
        <section key={t.id} className="space-y-4">
          <div className="rounded-xl border border-rose-200 bg-gradient-to-br from-rose-50/60 to-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">{t.name}</h2>
                <span className="text-sm text-slate-500">
                  {t.startDate ? <>starts <strong className="text-slate-700">{fmtDate(new Date(t.startDate + "T00:00:00Z"))}</strong></> : "no date yet — set it on the offering page"}
                  {" "}· {(t.endWeek ?? 16) - (t.startWeek ?? 1) + 1} instructional weeks
                </span>
              </div>
              <div className="text-right">
                <div className="text-3xl font-extrabold tabular-nums text-rose-700">{n0(enrollment)}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-400" title="Derived from this offering's pipeline targets — this is column C for every session row below">enrollment target (column C)</div>
              </div>
            </div>
            {/* What this term NEEDS at that enrollment — same math as the template sheet, at reality. */}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-white/80 px-3 py-2 text-[11px] ring-1 ring-rose-100">
              <span className="font-semibold uppercase tracking-wide text-rose-500">Needed @ {n0(enrollment)}</span>
              <span className="text-slate-600">{n0(secTot)} sections <span className="text-slate-400">({n0(tt.sec.CLASS)} class / {n0(tt.sec.LAB)} lab / {n0(tt.sec.CLINICAL)} clinical)</span></span>
              <span className="text-slate-600">{n1(tt.space)} space hrs</span>
              <span className="text-slate-600">faculty <strong className="tabular-nums text-slate-800">{n1(tt.facHrs)}h</strong> → <strong className="tabular-nums text-rose-700">{n2(tt.facFte)}</strong> FTE</span>
              <span className="text-slate-600">preceptors <strong className="tabular-nums text-slate-800">{n1(tt.precHrs)}h</strong> → <strong className="tabular-nums text-rose-700">{n2(tt.precFte)}</strong> FTE</span>
            </div>
          </div>

          {t.courses.map((c) => {
            const kinds = [...new Set(c.sessions.map((s) => s.kind))];
            const courseRows = c.sessions.map((s) => rows.get(s.id)!).filter(Boolean);
            const ct = courseTallies.get(c.id) ?? emptyTally();
            const psTot = ct.ps.CLASS + ct.ps.LAB + ct.ps.CLINICAL;
            const cSecTot = ct.sec.CLASS + ct.sec.LAB + ct.sec.CLINICAL;
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

                {/* Per-course tallies — per student + delivery footprint @ this offering's enrollment (mirrors the template page). */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-[11px]">
                  <span className="font-semibold uppercase tracking-wide text-slate-400">Per student</span>
                  <span className="inline-flex items-center gap-1 text-slate-600"><span className="h-1.5 w-1.5 rounded-full bg-sky-500" />{n1(ct.ps.CLASS)}h class</span>
                  <span className="inline-flex items-center gap-1 text-slate-600"><span className="h-1.5 w-1.5 rounded-full bg-violet-500" />{n1(ct.ps.LAB)}h lab</span>
                  <span className="inline-flex items-center gap-1 text-slate-600"><span className="h-1.5 w-1.5 rounded-full bg-rose-500" />{n1(ct.ps.CLINICAL)}h clinical</span>
                  <span className="font-semibold text-slate-700">{n1(psTot)}h total</span>
                  <span className="mx-1 text-slate-300">|</span>
                  <span className="font-semibold uppercase tracking-wide text-rose-500">@ {n0(enrollment)}</span>
                  <span className="text-slate-600">{n0(cSecTot)} sections ({n0(ct.sec.CLASS)}/{n0(ct.sec.LAB)}/{n0(ct.sec.CLINICAL)})</span>
                  <span className="text-slate-600">{n1(ct.space)} space hrs</span>
                  <span className="text-slate-600">fac <strong className="text-rose-700">{n2(ct.facFte)}</strong> FTE</span>
                  {ct.precFte > 0 && <span className="text-slate-600">prec <strong className="text-rose-700">{n2(ct.precFte)}</strong> FTE</span>}
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

                {/* The Raw Data & Calculations sheet — the template's exact columns (A–AE),
                    plus this offering's reality: real Date/Time up front, booked location
                    & staff at the end. C = this offering's enrollment target. */}
                <div className="overflow-x-auto">
                  <table className="border-collapse text-[11px]" style={{ minWidth: "236rem" }}>
                    <thead>
                      <tr className="bg-slate-800 text-left text-slate-100">
                        <th className="border-r border-slate-700 px-1.5 py-1.5 align-bottom font-medium" style={{ minWidth: "9rem" }}>
                          <span className="block font-mono text-[9px] text-amber-300">this offering</span>
                          <span className="leading-tight">Date</span>
                        </th>
                        <th className="border-r border-slate-700 px-1.5 py-1.5 align-bottom font-medium" style={{ minWidth: "6rem" }}>
                          <span className="block font-mono text-[9px] text-amber-300">this offering</span>
                          <span className="leading-tight">Start time</span>
                        </th>
                        {SHEET_COLS.map(({ c: col, w }) => (
                          <th key={col} className="border-r border-slate-700 px-1.5 py-1.5 align-bottom font-medium" style={{ minWidth: w }}>
                            <span className="block font-mono text-[9px] text-emerald-300">{col}{["A", "B", "D", "E", "G"].includes(col) ? " · seq" : SHEET_FIELD_OF[col] ? "" : " · fx"}</span>
                            <span className="leading-tight">{CAPACITY_HEADERS[col as keyof typeof CAPACITY_HEADERS]}</span>
                          </th>
                        ))}
                        <th className="border-r border-slate-700 px-1.5 py-1.5 align-bottom font-medium" style={{ minWidth: "10rem" }}>
                          <span className="block font-mono text-[9px] text-amber-300">this offering</span>
                          <span className="leading-tight">Booked location · staff</span>
                        </th>
                        <th className="px-1.5 py-1.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {ordered.map((r) => {
                        const comp = computeColumns(r as unknown as SessionInput, enrollment, assumptions);
                        const d = sessionDateObj(c.startDate ?? t.startDate, r.week, r.dayOfWeek);
                        const holiday = d && r.dayOfWeek != null ? usHoliday(d) : null;
                        const m = meetingsFor(c.id, r.kind)[0] ?? null;
                        const offCampus = r.kind === "CLINICAL";
                        const bookedLoc = m ? (offCampus ? (m.employerName ? `@ ${m.employerName}` : "@ site TBD") : (m.facilityName ?? "no room")) : "—";
                        const isDirty = dirty.has(r.id);
                        const calcVal: Record<string, string> = {
                          C: num(comp.C, 1), X: num(comp.X), Y: comp.divByZero ? "#DIV/0!" : num(comp.Y, 0), Z: num(comp.Z),
                          AA: num(comp.AA), AB: num(comp.AB), AC: num(comp.AC), AD: num(comp.AD, 3), AE: num(comp.AE),
                        };
                        const seqVal: Record<string, string> = {
                          A: `Term ${t.index}`, B: t.name, D: c.code ?? "—", E: c.name, G: String(r.number),
                        };
                        return (
                          <tr key={r.id} className={`border-b border-slate-100 align-top ${holiday ? "bg-rose-50/60" : r.overridden ? "bg-amber-50/50" : "hover:bg-slate-50/60"}`}>
                            <td className="whitespace-nowrap border-r border-slate-100 px-1.5 py-1 font-medium text-slate-700">
                              {d ? (r.dayOfWeek != null ? fmtDate(d) : `wk of ${fmtDate(d)}`) : "—"}
                              {holiday && <span className="ml-1 rounded-full bg-rose-200 px-1.5 py-0.5 text-[9px] font-semibold text-rose-800" title={`${holiday} — move this session (edit Q/R, then Save row)`}>⚠ {holiday}</span>}
                            </td>
                            <td className="border-r border-slate-100 px-1 py-0.5">
                              <input type="time" value={r.startTime ?? ""} onChange={(e) => setField(r.id, "startTime", e.target.value || null)} className={inp} />
                            </td>
                            {SHEET_COLS.map(({ c: col, kind }) => {
                              if (kind === "seq" || col === "G") {
                                return <td key={col} className="border-r border-slate-100 bg-slate-50/70 px-1.5 py-1 text-slate-500" title={CAPACITY_FORMULAS[col]}>{seqVal[col]}</td>;
                              }
                              if (kind === "calc") {
                                const err = col !== "C" && comp.divByZero;
                                const isEnroll = col === "C";
                                return (
                                  <td key={col} title={isEnroll ? "This offering's enrollment target for the term — from its pipeline" : CAPACITY_FORMULAS[col]} className={`border-r border-slate-100 px-1.5 py-1 text-right font-mono tabular-nums ${err ? "bg-rose-50 font-semibold text-rose-700" : isEnroll ? "bg-rose-50/70 font-semibold text-rose-800" : "bg-emerald-50/70 text-emerald-900"}`}>
                                    {calcVal[col]}
                                  </td>
                                );
                              }
                              if (col === "F") {
                                // Session type belongs to the template — shown, not overridable per offering.
                                return <td key={col} className="border-r border-slate-100 bg-slate-50/70 px-1.5 py-1"><span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${KIND_BADGE[r.kind]}`}>{KIND_LABEL[r.kind]}</span></td>;
                              }
                              const field = SHEET_FIELD_OF[col]! as keyof RowState;
                              const v = r[field];
                              return (
                                <td key={col} className="border-r border-slate-100 px-1 py-0.5">
                                  {col === "R" ? (
                                    <select value={(v as string | null) ?? ""} onChange={(e) => setField(r.id, "dayOfWeek", e.target.value || null)} className={inp}>
                                      <option value="">—</option>
                                      {ALL_DAYS.map((dd) => <option key={dd} value={dd}>{dd}</option>)}
                                    </select>
                                  ) : SHEET_NUM_FIELDS.has(col) ? (
                                    <input type="number" step="any" value={(v as number | null) ?? ""} onChange={(e) => setField(r.id, field, e.target.value === "" ? null : Number(e.target.value))} className={`${inp} text-right font-mono`} />
                                  ) : (
                                    <input value={(v as string | null) ?? ""} onChange={(e) => setField(r.id, field, e.target.value || null)} className={inp} />
                                  )}
                                </td>
                              );
                            })}
                            <td className="whitespace-nowrap border-r border-slate-100 px-2 py-1 text-slate-500">
                              <span className={m && ((offCampus && !m.employerId) || (!offCampus && !m.facilityId)) ? "font-medium text-amber-600" : ""}>{bookedLoc}</span>
                              <span className={`block ${m?.staffName ? "" : "text-amber-600"}`}>{m?.staffName ?? "unassigned"}</span>
                            </td>
                            <td className="whitespace-nowrap px-1.5 py-1">
                              <form action={async (fd) => { await saveSessionOverride(cohortId, r.id, programId, fd); setDirty((dd) => { const n = new Set(dd); n.delete(r.id); return n; }); router.refresh(); }}>
                                {OVERRIDE_FIELDS.map((f) => (
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
        );
      })}
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
