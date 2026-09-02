"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moveMeeting, saveSessionOverride, clearSessionOverride } from "@/lib/actions";
import {
  CAPACITY_HEADERS, CAPACITY_FORMULAS, computeColumns, usHoliday,
  type WorkloadAssumptions, type SessionInput,
} from "@/lib/capacitymodel";
import { SessionFieldGrid, harvestOptions, type FieldRow } from "@/components/SessionFields";
import type { EditableField } from "@/lib/sessionfields";

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
  programId, cohortId, terms, meetings, overrides, rooms, people, employers, enrollmentByTerm, assumptions, holidays = {},
}: {
  /** Institution-coded holidays & breaks (ISO → label) — checked before the U.S. defaults. */
  holidays?: Record<string, string>;
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
  // Drill-down navigation: terms → courses → sessions (first term open by default).
  const [openTerms, setOpenTerms] = useState<Set<string>>(() => new Set(terms[0] ? [terms[0].id] : []));
  const [openCourses, setOpenCourses] = useState<Set<string>>(new Set());
  const [openSessions, setOpenSessions] = useState<Set<string>>(new Set());

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
  // SAVED state, for row ordering — rows keep their place while you edit
  // (they re-sort chronologically once Save row commits), so the row you're
  // typing in never jumps out from under you.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const savedRows = useMemo(() => buildRows(), [terms, overrides, meetings]);

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

  // ── Roll-up analytics: hours per student by kind, delivery mix, clinical settings ──
  type Mix = { hrs: { CLASS: number; LAB: number; CLINICAL: number }; modes: Record<string, number>; settings: Map<string, { sessions: number; hrs: number }>; sessions: number };
  const modeOf = (dm: string | null) => { const v = (dm ?? "").toLowerCase(); return v.includes("online") ? "online" : v.includes("hybrid") ? "hybrid" : "in-person"; };
  const emptyMix = (): Mix => ({ hrs: { CLASS: 0, LAB: 0, CLINICAL: 0 }, modes: { "in-person": 0, hybrid: 0, online: 0 }, settings: new Map(), sessions: 0 });
  const mixOf = (rs: RowState[]): Mix => {
    const m = emptyMix();
    for (const r of rs) {
      const k = (r.kind in m.hrs ? r.kind : "CLASS") as keyof Mix["hrs"];
      m.hrs[k] += r.lengthHours ?? 0; m.sessions += 1; m.modes[modeOf(r.deliveryMode)] += 1;
      if (r.kind === "CLINICAL") { const key = r.rotationType ?? "(setting not set)"; const cur = m.settings.get(key) ?? { sessions: 0, hrs: 0 }; cur.sessions += 1; cur.hrs += r.lengthHours ?? 0; m.settings.set(key, cur); }
    }
    return m;
  };
  const addMix = (a: Mix, b: Mix): Mix => {
    const m = emptyMix();
    for (const k of ["CLASS", "LAB", "CLINICAL"] as const) m.hrs[k] = a.hrs[k] + b.hrs[k];
    for (const k of Object.keys(m.modes)) m.modes[k] = (a.modes[k] ?? 0) + (b.modes[k] ?? 0);
    m.sessions = a.sessions + b.sessions;
    for (const src of [a.settings, b.settings]) for (const [k, v] of src) { const cur = m.settings.get(k) ?? { sessions: 0, hrs: 0 }; cur.sessions += v.sessions; cur.hrs += v.hrs; m.settings.set(k, cur); }
    return m;
  };
  const courseMix = new Map<string, Mix>();
  const termMix = new Map<string, Mix>();
  for (const t of terms) {
    let tm = emptyMix();
    for (const c of t.courses) { const cm = mixOf(c.sessions.map((s) => rows.get(s.id)!).filter(Boolean)); courseMix.set(c.id, cm); tm = addMix(tm, cm); }
    termMix.set(t.id, tm);
  }
  const allMix = [...termMix.values()].reduce(addMix, emptyMix());
  const hrsTot = (m: Mix) => m.hrs.CLASS + m.hrs.LAB + m.hrs.CLINICAL;

  const MixStrip = ({ m, size = "sm" }: { m: Mix; size?: "sm" | "lg" }) => (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 ${size === "lg" ? "text-sm" : "text-[11px]"}`}>
      <span className="inline-flex items-center gap-1 text-slate-700"><span className="h-2 w-2 rounded-full bg-sky-500" /><strong>{n1(m.hrs.CLASS)}h</strong> class</span>
      <span className="inline-flex items-center gap-1 text-slate-700"><span className="h-2 w-2 rounded-full bg-violet-500" /><strong>{n1(m.hrs.LAB)}h</strong> lab</span>
      <span className="inline-flex items-center gap-1 text-slate-700"><span className="h-2 w-2 rounded-full bg-rose-500" /><strong>{n1(m.hrs.CLINICAL)}h</strong> clinical</span>
      <span className="font-semibold text-slate-900">{n1(hrsTot(m))}h total / student</span>
      <span className="text-slate-300">|</span>
      <span className="text-slate-600">{n0(m.sessions)} sessions: <strong>{n0(m.modes["in-person"])}</strong> in-person · <strong>{n0(m.modes.hybrid)}</strong> hybrid · <strong>{n0(m.modes.online)}</strong> online</span>
      {m.settings.size > 0 && (
        <>
          <span className="text-slate-300">|</span>
          <span className="text-slate-600">clinical settings: {[...m.settings.entries()].map(([k, v]) => `${k} (${n0(v.sessions)} sessions · ${n1(v.hrs)}h)`).join(" · ")}</span>
        </>
      )}
    </div>
  );

  // Drop-down choices harvested from everything this program already uses.
  const dataOptions = harvestOptions([...rows.values()] as unknown as Partial<FieldRow>[]);
  const toggleSet = (set: Set<string>, id: string) => { const n = new Set(set); n.has(id) ? n.delete(id) : n.add(id); return n; };

  return (
    <div className="space-y-6">
      {pending && <div className="text-xs text-slate-400">saving…</div>}

      {/* ── Whole-instantiation analytics ─────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">This instantiation — what a student sits through, and how it&apos;s delivered</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(["CLASS", "LAB", "CLINICAL"] as const).map((k) => (
            <div key={k} className="rounded-lg bg-slate-50 p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">{KIND_LABEL[k]} hours / student</div>
              <div className={`text-2xl font-bold tabular-nums ${k === "CLASS" ? "text-sky-700" : k === "LAB" ? "text-violet-700" : "text-rose-700"}`}>{n1(allMix.hrs[k])}h</div>
            </div>
          ))}
          <div className="rounded-lg bg-slate-800 p-3 text-white">
            <div className="text-[10px] uppercase tracking-wide text-slate-300">Total hours / student</div>
            <div className="text-2xl font-bold tabular-nums">{n1(hrsTot(allMix))}h</div>
          </div>
        </div>
        <div className="mt-3"><MixStrip m={allMix} size="lg" /></div>
        {/* Per-term roll-up */}
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wide text-slate-400">
                <th className="py-1.5 pr-3 font-semibold">Term</th>
                <th className="py-1.5 pr-3 text-right font-semibold text-sky-700">Class h</th>
                <th className="py-1.5 pr-3 text-right font-semibold text-violet-700">Lab h</th>
                <th className="py-1.5 pr-3 text-right font-semibold text-rose-700">Clinical h</th>
                <th className="py-1.5 pr-3 text-right font-semibold">Total h</th>
                <th className="py-1.5 pr-3 text-right font-semibold">In-person</th>
                <th className="py-1.5 pr-3 text-right font-semibold">Hybrid</th>
                <th className="py-1.5 pr-3 text-right font-semibold">Online</th>
                <th className="py-1.5 font-semibold">Clinical settings</th>
              </tr>
            </thead>
            <tbody>
              {terms.map((t) => { const m = termMix.get(t.id) ?? emptyMix(); return (
                <tr key={t.id} className="border-b border-slate-100 tabular-nums">
                  <td className="py-1.5 pr-3 font-medium text-slate-700">{t.name}</td>
                  <td className="py-1.5 pr-3 text-right">{n1(m.hrs.CLASS)}</td>
                  <td className="py-1.5 pr-3 text-right">{n1(m.hrs.LAB)}</td>
                  <td className="py-1.5 pr-3 text-right">{n1(m.hrs.CLINICAL)}</td>
                  <td className="py-1.5 pr-3 text-right font-semibold">{n1(hrsTot(m))}</td>
                  <td className="py-1.5 pr-3 text-right">{n0(m.modes["in-person"])}</td>
                  <td className="py-1.5 pr-3 text-right">{n0(m.modes.hybrid)}</td>
                  <td className="py-1.5 pr-3 text-right">{n0(m.modes.online)}</td>
                  <td className="py-1.5 text-slate-600">{[...m.settings.entries()].map(([k, v]) => `${k} (${n0(v.sessions)})`).join(" · ") || "—"}</td>
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-blue-300 bg-blue-50" /> editable for THIS offering (Save stores only what differs from the template)</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-emerald-300 bg-emerald-50" /> live formula at this offering&apos;s enrollment target</span>
        <span className="inline-flex items-center gap-1"><span className="rounded-full bg-amber-200 px-1.5 text-[9px] font-semibold text-amber-800">edited</span> overrides the template</span>
        <span className="inline-flex items-center gap-1 text-rose-600">⚠ holiday collision</span>
        <span className="ml-auto text-slate-400">Click a term → its courses drop down → click a course → its sessions → click a session to edit every field, no scrolling.</span>
      </div>

      {/* ── Terms → courses → sessions, as drop-downs ─────────────────────── */}
      {terms.map((t) => {
        const enrollment = enrollmentByTerm[t.index] ?? 0;
        const courseTallies = new Map<string, Tally>();
        for (const c of t.courses) courseTallies.set(c.id, tallyOf(c.sessions.map((s) => rows.get(s.id)!).filter(Boolean), enrollment, assumptions));
        const tt = [...courseTallies.values()].reduce(addTally, emptyTally());
        const secTot = tt.sec.CLASS + tt.sec.LAB + tt.sec.CLINICAL;
        const tm = termMix.get(t.id) ?? emptyMix();
        const tOpen = openTerms.has(t.id);
        return (
        <section key={t.id} className="overflow-hidden rounded-xl border border-rose-200 bg-white shadow-sm">
          <button onClick={() => setOpenTerms((o) => toggleSet(o, t.id))} className="flex w-full flex-wrap items-center justify-between gap-4 bg-gradient-to-br from-rose-50/70 to-white px-5 py-4 text-left hover:from-rose-100/70">
            <div>
              <div className="text-lg font-semibold text-slate-900">{tOpen ? "▾" : "▸"} {t.name} <span className="text-sm font-normal text-slate-500">· {t.courses.length} course{t.courses.length === 1 ? "" : "s"}</span></div>
              <div className="text-sm text-slate-500">
                {t.startDate ? <>starts <strong className="text-slate-700">{fmtDate(new Date(t.startDate + "T00:00:00Z"))}</strong></> : "no date yet — set it on the offering page"}
                {" "}· {(t.endWeek ?? 16) - (t.startWeek ?? 1) + 1} instructional weeks
              </div>
              <div className="mt-1"><MixStrip m={tm} /></div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-extrabold tabular-nums text-rose-700">{n0(enrollment)}</div>
              <div className="text-[10px] uppercase tracking-wide text-slate-400">enrollment target</div>
              <div className="mt-1 text-[11px] text-slate-600">{n0(secTot)} sections · faculty <strong className="text-rose-700">{n2(tt.facFte)}</strong> FTE{tt.precFte > 0 && <> · preceptors <strong className="text-rose-700">{n2(tt.precFte)}</strong> FTE</>}</div>
            </div>
          </button>

          {tOpen && (
          <div className="space-y-3 border-t border-rose-100 p-4">
          {t.courses.map((c) => {
            const kinds = [...new Set(c.sessions.map((s) => s.kind))];
            const ct = courseTallies.get(c.id) ?? emptyTally();
            const cm = courseMix.get(c.id) ?? emptyMix();
            const cSecTot = ct.sec.CLASS + ct.sec.LAB + ct.sec.CLINICAL;
            const cOpen = openCourses.has(c.id);
            const ordered = c.sessions
              .map((s) => savedRows.get(s.id)!)
              .filter(Boolean)
              .sort((a, b) => {
                const wa = a.week ?? 999, wb = b.week ?? 999;
                if (wa !== wb) return wa - wb;
                const da = a.dayOfWeek != null ? DAY_OFFSET[a.dayOfWeek] ?? 8 : 8;
                const db = b.dayOfWeek != null ? DAY_OFFSET[b.dayOfWeek] ?? 8 : 8;
                if (da !== db) return da - db;
                const ta = a.startTime ?? "99:99", tb = b.startTime ?? "99:99";
                if (ta !== tb) return ta.localeCompare(tb);
                return a.kind.localeCompare(b.kind) || a.number - b.number;
              })
              .map((s) => rows.get(s.id) ?? s);
            return (
              <div key={c.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <button onClick={() => setOpenCourses((o) => toggleSet(o, c.id))} className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50">
                  <div>
                    <div className="font-semibold text-slate-800">{cOpen ? "▾" : "▸"} {c.code ? `${c.code} · ` : ""}{c.name}
                      <span className="ml-2 text-xs font-normal text-slate-400">{kinds.map((k) => `${c.sessions.filter((s) => s.kind === k).length} ${KIND_LABEL[k].toLowerCase()}`).join(" · ")}</span>
                      {c.startDate && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">runs {fmtDate(new Date(c.startDate + "T00:00:00Z"))}{c.endDate ? ` → ${fmtDate(new Date(c.endDate + "T00:00:00Z"))}` : ""}</span>}
                    </div>
                    <div className="mt-1"><MixStrip m={cm} /></div>
                  </div>
                  <div className="text-right text-[11px] text-slate-600">
                    <div>@ {n0(enrollment)}: <strong>{n0(cSecTot)}</strong> sections ({n0(ct.sec.CLASS)}/{n0(ct.sec.LAB)}/{n0(ct.sec.CLINICAL)}) · {n1(ct.space)} space hrs</div>
                    <div>fac <strong className="text-rose-700">{n2(ct.facFte)}</strong> FTE{ct.precFte > 0 && <> · prec <strong className="text-rose-700">{n2(ct.precFte)}</strong> FTE</>}</div>
                  </div>
                </button>

                {cOpen && (
                <div className="border-t border-slate-100">
                {/* Weekly booking per kind/section — day · time · location · staff. Same record as the master calendar. */}
                <div className="space-y-1.5 border-b border-slate-100 bg-slate-50/50 px-4 py-2.5">
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

                {/* Sessions: one summary line each; click to open the full editable card — every workbook column, no scrolling. */}
                <div className="divide-y divide-slate-100">
                  {ordered.map((r) => {
                    const comp = computeColumns(r as unknown as SessionInput, enrollment, assumptions);
                    const anchor = c.startDate ?? t.startDate;
                    const d = sessionDateObj(anchor, r.week, r.dayOfWeek);
                    const holiday = d && r.dayOfWeek != null ? holidays[d.toISOString().slice(0, 10)] ?? usHoliday(d) : null;
                    const m = meetingsFor(c.id, r.kind)[0] ?? null;
                    const offCampus = r.kind === "CLINICAL";
                    const bookedLoc = m ? (offCampus ? (m.employerName ? `@ ${m.employerName}` : "@ site TBD") : (m.facilityName ?? "no room")) : "—";
                    const isDirty = dirty.has(r.id);
                    const sOpen = openSessions.has(r.id);
                    const calcVal: Record<string, string> = {
                      C: num(comp.C, 1), X: num(comp.X), Y: comp.divByZero ? "#DIV/0!" : num(comp.Y, 0), Z: num(comp.Z),
                      AA: num(comp.AA), AB: num(comp.AB), AC: num(comp.AC), AD: num(comp.AD, 3), AE: num(comp.AE),
                    };
                    const seqVal: Record<string, string> = { A: `Term ${t.index}`, B: t.name, D: c.code ?? "—", E: c.name, G: String(r.number) };
                    return (
                      <div key={r.id} className={holiday ? "bg-rose-50/60" : r.overridden ? "bg-amber-50/40" : ""}>
                        {/* summary line */}
                        <button onClick={() => setOpenSessions((o) => toggleSet(o, r.id))} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-left text-xs hover:bg-slate-50">
                          <span className="w-4 text-slate-400">{sOpen ? "▾" : "▸"}</span>
                          <span className="w-36 font-medium text-slate-700">{d ? (r.dayOfWeek != null ? fmtDate(d) : `wk of ${fmtDate(d)}`) : "no date"}</span>
                          <span className="w-14 font-mono text-slate-500">{fmtTime(r.startTime)}</span>
                          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${KIND_BADGE[r.kind]}`}>{KIND_LABEL[r.kind]} #{r.number}</span>
                          <span className="min-w-0 flex-1 truncate text-slate-800">{r.title ?? <span className="text-slate-300">untitled</span>}</span>
                          <span className="tabular-nums text-slate-500">{r.lengthHours}h · cap {r.maxStudents}{r.deliveryMode ? ` · ${r.deliveryMode}` : ""}{offCampus && r.rotationType ? ` · @ ${r.rotationType}` : ""}</span>
                          <span className="tabular-nums text-emerald-800">{calcVal.Y} sec · {num(comp.Z, 1)} fac h{offCampus ? ` · ${num(comp.AC, 0)} prec h` : ""}</span>
                          {holiday && <span className="rounded-full bg-rose-200 px-1.5 py-0.5 text-[9px] font-semibold text-rose-800">⚠ {holiday}</span>}
                          {r.overridden && <span className="rounded-full bg-amber-200 px-1.5 py-0.5 text-[9px] font-semibold text-amber-800">edited</span>}
                          {isDirty && <span className="rounded-full bg-rose-600 px-1.5 py-0.5 text-[9px] font-semibold text-white">unsaved</span>}
                        </button>

                        {/* the full editable card — every workbook column, labeled, wrapped */}
                        {sOpen && (
                          <div className="border-t border-slate-100 px-4 py-3">
                            <SessionFieldGrid
                              row={r as unknown as FieldRow}
                              seq={{ A: seqVal.A, B: seqVal.B, D: seqVal.D, E: seqVal.E, G: seqVal.G }}
                              enrollment={enrollment} assumptions={assumptions} editableKind={false} dataOptions={dataOptions}
                              onChange={(f: EditableField, v) => setField(r.id, f as keyof RowState, v)}
                              before={(
                                <>
                                  {/* this offering: real date + start time */}
                                  <label className="block">
                                    <span className="block text-[10px] font-semibold leading-tight text-amber-700"><span className="mr-1 rounded bg-amber-100 px-1 font-mono text-[9px]">this offering</span>Date this session happens (sets week of term + day)</span>
                                    {anchor ? (
                                      <input type="date" value={d && r.dayOfWeek != null ? d.toISOString().slice(0, 10) : ""} onChange={(e) => {
                                        if (!e.target.value) return;
                                        const picked = new Date(e.target.value + "T00:00:00Z"); const a0 = new Date(anchor + "T00:00:00Z");
                                        let diff = Math.round((picked.getTime() - a0.getTime()) / 86400000); if (diff < 0) diff = 0;
                                        setField(r.id, "week", Math.floor(diff / 7) + 1); setField(r.id, "dayOfWeek", ALL_DAYS[diff % 7]);
                                      }} className={inp} />
                                    ) : <span className="block text-xs text-slate-400">term not dated yet — set the offering dates first</span>}
                                  </label>
                                  <label className="block">
                                    <span className="block text-[10px] font-semibold leading-tight text-amber-700"><span className="mr-1 rounded bg-amber-100 px-1 font-mono text-[9px]">this offering</span>Start time</span>
                                    <input type="time" value={r.startTime ?? ""} onChange={(e) => setField(r.id, "startTime", e.target.value || null)} className={inp} />
                                  </label>
                                </>
                              )}
                              after={(
                                <div className="block">
                                  <span className="block text-[10px] font-semibold leading-tight text-amber-700"><span className="mr-1 rounded bg-amber-100 px-1 font-mono text-[9px]">booked</span>Location and instructor / preceptor on the weekly booking</span>
                                  <span className={`block text-xs ${m && ((offCampus && !m.employerId) || (!offCampus && !m.facilityId)) ? "font-medium text-amber-600" : "text-slate-600"}`}>{bookedLoc}</span>
                                  <span className={`block text-xs ${m?.staffName ? "text-slate-600" : "text-amber-600"}`}>{m?.staffName ?? "unassigned — assign in the weekly pattern above"}</span>
                                </div>
                              )}
                            />
                            <div className="mt-3 flex items-center gap-3">
                              <form action={async (fd) => { await saveSessionOverride(cohortId, r.id, programId, fd); setDirty((dd) => { const n = new Set(dd); n.delete(r.id); return n; }); router.refresh(); }}>
                                {OVERRIDE_FIELDS.map((f) => <input key={String(f)} type="hidden" name={String(f)} value={r[f] == null ? "" : String(r[f])} readOnly />)}
                                <button className={`rounded-lg px-3 py-1.5 text-xs font-medium ${isDirty ? "bg-rose-600 text-white hover:bg-rose-700" : "bg-slate-100 text-slate-400"}`}>Save this session for this offering</button>
                              </form>
                              {r.overridden && (
                                <button onClick={async () => { await clearSessionOverride(cohortId, r.id, programId); router.refresh(); }} className="text-[11px] text-amber-700 hover:underline" title="remove this offering's override — back to the template">
                                  <span className="rounded-full bg-amber-200 px-1.5 py-0.5 font-semibold text-amber-800">edited</span> clear → template
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                </div>
                )}
              </div>
            );
          })}
          {t.courses.length === 0 && <p className="text-sm text-slate-400">No courses in this term.</p>}
          </div>
          )}
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
