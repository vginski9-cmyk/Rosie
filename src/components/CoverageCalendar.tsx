"use client";

// The coverage calendar, at three altitudes plus the month:
//   Semester — every week of every term at a glance (the shape of the load)
//   Month    — the wall calendar, one chip per shift
//   Week     — seven big columns, every shift with its time, drag between days
//   Day      — every shift individually, grouped by session, with inline
//              editors for weekday · time · location · staff, and the day's
//              numbers EXPLAINED (what 32 shifts / 320 students actually mean)
// Dragging uses dnd-kit (pointer-based, with a drag overlay) — a dropped chip
// moves that section's weekly booking, the same record the master calendar edits.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable, type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { moveShiftOccurrence, clearShiftMove } from "@/lib/actions";
import { usHoliday, type DatedInstance } from "@/lib/capacitymodel";
import type { CapacityCohort, ShiftMeeting, ShiftMoveInfo } from "@/components/CapacityBoard";

export interface CalRoom { id: string; name: string; kind: string; capacity: number | null }
export interface CalPerson { id: string; name: string; role: string }
export interface CalSite { id: string; name: string }

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_KEY: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6, Monday: 0, Tuesday: 1, Wednesday: 2, Thursday: 3, Friday: 4, Saturday: 5, Sunday: 6 };
const n0 = (v: number) => Math.round(v).toLocaleString();
const n1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1 });
const nz = (v: number | null | undefined) => v ?? 0;
const fmtDate = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const fmtDateM = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const fmtMD = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
const fmtT = (t: string | null) => {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "p" : "a"; const hh = h % 12 || 12;
  return m ? `${hh}:${String(m).padStart(2, "0")}${ap}` : `${hh}${ap}`;
};
const addDaysIso = (iso: string, n: number) => new Date(new Date(iso + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);

const KIND_CHIP: Record<string, string> = {
  CLASS: "border-l-4 border-sky-500 bg-sky-50 text-sky-900",
  LAB: "border-l-4 border-violet-500 bg-violet-50 text-violet-900",
  CLINICAL: "border-l-4 border-rose-500 bg-rose-50 text-rose-900",
};
const KIND_DOT: Record<string, string> = { CLASS: "bg-sky-500", LAB: "bg-violet-500", CLINICAL: "bg-rose-500" };
const KIND_LABEL: Record<string, string> = { CLASS: "class", LAB: "lab", CLINICAL: "clinical" };

/** One shift = one section of one session on one date. */
export interface Shift {
  key: string;
  dateIso: string;
  time: string | null;
  kind: string;
  courseCode: string | null; courseTitle: string; sessionTitle: string | null;
  cohortId: string; cohort: string; program: string;
  section: number; of: number;
  seats: number; lengthHours: number;
  setting: string | null;
  loc: string | null;
  staffName: string | null;
  meeting: ShiftMeeting | null;
  /** The template session this shift is an occurrence of — with the section, the key of a move. */
  sessionId: string;
  /** This occurrence's move, if it has been bumped. */
  move: ShiftMoveInfo | null;
  /** The date the weekly pattern would put this shift on (the key of a per-occurrence move). */
  originDate: string;
  moved: boolean;
  facultyPerSection: number;
  preceptorsPerSection: number;
  holiday: string | null;
  /** Groups shifts of the same SESSION (same students rotate through). */
  sessionKey: string;
  enrollment: number;
}

type ViewMode = "semester" | "month" | "week" | "day";

export function CoverageCalendar({ rows, cohorts, rooms = [], people = [], sites = [] }: {
  rows: DatedInstance[];
  cohorts: CapacityCohort[];
  rooms?: CalRoom[];
  people?: CalPerson[];
  sites?: CalSite[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [view, setView] = useState<ViewMode>("month");
  const [anchor, setAnchor] = useState<string | null>(null); // a dateIso; each view derives its window
  const [dragging, setDragging] = useState<Shift | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Per-section bookings: cohort|course|kind → sections in order.
  const meetingsIdx = useMemo(() => {
    const m = new Map<string, ShiftMeeting[]>();
    for (const c of cohorts) for (const mt of c.meetings ?? []) {
      const k = `${c.cohortId}|${mt.courseId}|${mt.kind}`;
      const l = m.get(k) ?? []; l.push(mt); m.set(k, l);
    }
    for (const l of m.values()) l.sort((a, b) => a.sectionIndex - b.sectionIndex);
    return m;
  }, [cohorts]);
  // Each cohort's institution-coded holidays & breaks (ISO → label).
  const holidayByCohort = useMemo(() => new Map(cohorts.map((c) => [c.cohortId, c.holidays ?? {}])), [cohorts]);
  // Per-occurrence moves, keyed by cohort | session | section | origin date — one chip each.
  const movesIdx = useMemo(() => {
    const m = new Map<string, ShiftMoveInfo>();
    for (const c of cohorts) for (const mv of c.moves ?? []) m.set(`${c.cohortId}|${mv.sessionId}|${mv.sectionIndex}|${mv.fromDate}`, mv);
    return m;
  }, [cohorts]);

  // Explode every dated session row into one shift per required section.
  const shifts: Shift[] = useMemo(() => {
    const out: Shift[] = [];
    for (const r of rows) {
      if (!r.monday) continue;
      const Y = Math.max(1, Math.round(nz(r.computed.Y)));
      const ms = r.courseId ? meetingsIdx.get(`${r.cohortId}|${r.courseId}|${r.session.kind}`) ?? [] : [];
      const seatsDefault = Math.max(1, Math.min(r.session.maxStudents ?? 1, Math.ceil(r.computed.C / Y)));
      for (let sIdx = 1; sIdx <= Y; sIdx++) {
        const m = ms.find((x) => x.sectionIndex === sIdx) ?? null;
        const day = m?.dayOfWeek ?? r.session.dayOfWeek;
        const off = day != null ? DAY_KEY[day] : undefined;
        if (off == null) continue; // async / no-day sessions don't land on a date
        const date = new Date(r.monday.getTime() + off * 86400000);
        const originIso = date.toISOString().slice(0, 10);
        // A per-occurrence move bumps THIS date only — the weekly pattern stays.
        const mv = movesIdx.get(`${r.cohortId}|${r.session.id}|${sIdx}|${originIso}`) ?? null;
        const placedIso = mv?.toDate ?? originIso;
        out.push({
          key: `${r.session.id}|${r.weekOfTerm}|${sIdx}|${r.cohortId}`,
          dateIso: placedIso,
          time: mv?.startTime ?? m?.startTime ?? r.session.startTime ?? null,
          kind: r.session.kind,
          courseCode: r.courseCode, courseTitle: r.courseTitle, sessionTitle: r.session.title,
          cohortId: r.cohortId, cohort: r.cohort, program: r.program,
          section: sIdx, of: Y,
          seats: m && m.seats > 0 ? m.seats : seatsDefault,
          lengthHours: r.session.lengthHours,
          setting: r.session.rotationType, loc: mv?.loc ?? m?.loc ?? r.session.location ?? null,
          staffName: mv?.staffName ?? m?.staffName ?? null,
          meeting: m,
          sessionId: r.session.id,
          move: mv,
          originDate: originIso,
          moved: !!mv,
          facultyPerSection: r.session.facultyNeeded ?? 0,
          preceptorsPerSection: r.session.kind === "CLINICAL" ? r.session.preceptorsNeeded ?? 0 : 0,
          holiday: holidayByCohort.get(r.cohortId)?.[placedIso] ?? usHoliday(new Date(placedIso + "T00:00:00Z")),
          sessionKey: `${r.cohortId}|${r.session.id}|${r.weekOfTerm}`,
          enrollment: r.computed.C,
        });
      }
    }
    return out.sort((a, b) => a.dateIso.localeCompare(b.dateIso) || (a.time ?? "99").localeCompare(b.time ?? "99") || a.section - b.section);
  }, [rows, meetingsIdx, movesIdx]);

  const byDate = useMemo(() => {
    const m = new Map<string, Shift[]>();
    for (const c of shifts) { const l = m.get(c.dateIso) ?? []; l.push(c); m.set(c.dateIso, l); }
    return m;
  }, [shifts]);
  const firstIso = shifts[0]?.dateIso ?? null;
  const cur = anchor ?? firstIso;

  const onDragStart = (e: DragStartEvent) => setDragging((e.active.data.current as { shift: Shift } | undefined)?.shift ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    const shift = (e.active.data.current as { shift: Shift } | undefined)?.shift;
    setDragging(null);
    const overIso = e.over?.id as string | undefined;
    if (!shift || !overIso || overIso === shift.dateIso) return;
    // Exactly this shift (this session, this section, this date) — nothing else moves.
    startTransition(async () => {
      await moveShiftOccurrence({ cohortId: shift.cohortId, sessionId: shift.sessionId, sectionIndex: shift.section, meetingId: shift.meeting?.id ?? null }, shift.originDate, { toDate: overIso });
      router.refresh();
    });
  };

  if (!shifts.length) return <p className="text-sm text-slate-400">No dated sessions in this slice — days come from the template&apos;s Week __ · day columns and each offering&apos;s real term dates.</p>;
  if (!cur) return null;

  const step = (dir: number) => {
    if (view === "day") setAnchor(addDaysIso(cur, dir));
    else if (view === "week") setAnchor(addDaysIso(cur, dir * 7));
    else if (view === "month") {
      const d = new Date(cur.slice(0, 7) + "-15T00:00:00Z");
      d.setUTCMonth(d.getUTCMonth() + dir);
      setAnchor(d.toISOString().slice(0, 10));
    } else {
      // semester view pages by term below; step jumps a quarter-year
      const d = new Date(cur + "T00:00:00Z");
      d.setUTCMonth(d.getUTCMonth() + dir * 4);
      setAnchor(d.toISOString().slice(0, 10));
    }
  };
  const openDay = (iso: string) => { setAnchor(iso); setView("day"); };

  const mondayOf = (iso: string) => addDaysIso(iso, -((new Date(iso + "T00:00:00Z").getUTCDay() + 6) % 7));
  const windowLabel =
    view === "day" ? fmtDate(cur)
    : view === "week" ? `Week of ${fmtDateM(mondayOf(cur))}`
    : view === "month" ? new Date(cur.slice(0, 7) + "-01T00:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
    : "All terms";

  return (
    // autoScroll off: with it on, starting a drag near the viewport edge scrolls the
    // page under the pointer, the grid slides away and the drop lands on nothing.
    <DndContext sensors={sensors} autoScroll={false} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="space-y-4">
        <section className="rounded-xl border border-slate-200 bg-white">
          {/* ── Header: altitude tabs · nav · legend ─────────────────────── */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-sm">
              {(["semester", "month", "week", "day"] as ViewMode[]).map((v) => (
                <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 capitalize ${view === v ? "bg-rose-600 font-medium text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>{v}</button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              {view !== "semester" && <button onClick={() => step(-1)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">←</button>}
              <span className="min-w-[14rem] text-center text-base font-semibold text-slate-800">{windowLabel}</span>
              {view !== "semester" && <button onClick={() => step(1)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">→</button>}
              {firstIso && cur !== firstIso && view !== "semester" && (
                <button onClick={() => setAnchor(firstIso)} className="text-xs text-slate-400 hover:text-rose-600">jump to first scheduled</button>
              )}
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-600">
              <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm bg-sky-500" /> Class</span>
              <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm bg-violet-500" /> Lab</span>
              <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm bg-rose-500" /> Clinical</span>
              {pending && <span className="text-slate-400">saving…</span>}
            </div>
          </div>
          {(view === "month" || view === "week") && (
            <p className="border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-xs text-slate-500">
              One chip per shift (§3 = section 3 of that session). <strong>Drag a chip onto another day</strong> and exactly that
              one shift moves to exactly that date — nothing else follows it, and the page stays put while you drag. Open the
              <strong> Day</strong> view to set a shift&apos;s date, time, location and staff precisely (or put it back on its weekly pattern).
            </p>
          )}

          {view === "semester" && <SemesterView rows={rows} byDate={byDate} openDay={openDay} />}
          {view === "month" && <MonthView cur={cur} byDate={byDate} openDay={openDay} />}
          {view === "week" && <WeekView cur={cur} byDate={byDate} openDay={openDay} />}
          {view === "day" && (
            <DayView
              dateIso={cur} shifts={byDate.get(cur) ?? []}
              rooms={rooms} people={people} sites={sites}
              onSaved={() => router.refresh()}
            />
          )}
        </section>
      </div>

      <DragOverlay>
        {dragging && (
          <div className={`rounded-r px-2 py-1 text-xs font-medium shadow-lg ${KIND_CHIP[dragging.kind]}`}>
            {fmtT(dragging.time)} · {dragging.courseCode ?? dragging.courseTitle}{dragging.of > 1 ? ` §${dragging.section}` : ""} · {n0(dragging.seats)} stu
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

// ─────────────────────────────── Draggable chip ───────────────────────────────
function ShiftChipEl({ shift, size }: { shift: Shift; size: "sm" | "md" }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: shift.key, data: { shift } });
  return (
    <div
      ref={setNodeRef} {...attributes} {...listeners}
      className={`select-none rounded-r ${KIND_CHIP[shift.kind] ?? "bg-slate-50"} cursor-grab touch-none active:cursor-grabbing ${isDragging ? "opacity-40" : ""} ${size === "sm" ? "px-1.5 py-0.5 text-[11px] leading-tight" : "px-2 py-1 text-xs"}`}
      title={`${fmtT(shift.time)} · ${shift.courseCode ?? shift.courseTitle}${shift.of > 1 ? ` — shift ${shift.section} of ${shift.of}` : ""}${shift.sessionTitle ? ` — ${shift.sessionTitle}` : ""} · ${n0(shift.seats)} students · ${shift.lengthHours}h${shift.setting ? ` @ ${shift.setting}` : ""}${shift.loc ? ` (${shift.loc})` : ""} · ${shift.staffName ?? (shift.kind === "CLINICAL" ? "no preceptor" : "no instructor")} · ${shift.cohort} — drag to another day, or open Day view to edit date/time/location/staff`}
    >
      <span className="font-semibold">{fmtT(shift.time)} {shift.courseCode ?? shift.courseTitle}{shift.of > 1 ? ` §${shift.section}` : ""}{shift.moved ? <span className="ml-1 rounded bg-amber-200 px-1 text-[9px] font-semibold text-amber-900" title={`moved from ${shift.originDate}`}>moved</span> : null}</span>
      <span className="block truncate opacity-80">{n0(shift.seats)} stu{shift.setting ? ` @ ${shift.setting}` : shift.loc ? ` · ${shift.loc}` : ""}</span>
    </div>
  );
}

// ─────────────────────────────── Month view ───────────────────────────────────
function MonthDayCell({ dateIso, shifts, openDay }: { dateIso: string; shifts: Shift[]; openDay: (iso: string) => void }) {
  const { isOver, setNodeRef } = useDroppable({ id: dateIso });
  const dayNum = Number(dateIso.slice(8, 10));
  const todayIso = new Date().toISOString().slice(0, 10);
  const holiday = shifts.find((c) => c.holiday)?.holiday ?? null;
  return (
    <div ref={setNodeRef} className={`min-h-[128px] border-b border-r border-slate-100 p-1.5 align-top ${isOver ? "bg-rose-50 ring-2 ring-inset ring-rose-400" : ""}`}>
      <div className="mb-1 flex items-center justify-between px-0.5">
        <button onClick={() => openDay(dateIso)} className={`text-xs font-semibold hover:text-rose-600 ${dateIso === todayIso ? "rounded-full bg-rose-600 px-1.5 text-white" : "text-slate-500"}`} title="open the day view">{dayNum}</button>
        {holiday && <span className="truncate text-[9px] font-semibold text-rose-600" title={holiday}>⚠ {holiday}</span>}
      </div>
      <div className="space-y-1">
        {/* every shift is its own chip — 16 shifts, 16 draggable instances */}
        {shifts.map((c) => <ShiftChipEl key={c.key} shift={c} size="sm" />)}
        {shifts.length > 0 && (
          <button onClick={() => openDay(dateIso)} className="w-full rounded bg-slate-100 px-1 py-0.5 text-left text-[10px] font-medium text-slate-500 hover:bg-slate-200">
            open day — set exact date · time · place · staff ↦
          </button>
        )}
      </div>
    </div>
  );
}

function MonthView({ cur, byDate, openDay }: { cur: string; byDate: Map<string, Shift[]>; openDay: (iso: string) => void }) {
  const ym = cur.slice(0, 7);
  const first = new Date(ym + "-01T00:00:00Z");
  const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  return (
    <>
      <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {WEEKDAYS.map((d) => <div key={d} className="py-2">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((iso, i) => iso
          ? <MonthDayCell key={iso} dateIso={iso} shifts={byDate.get(iso) ?? []} openDay={openDay} />
          : <div key={`b${i}`} className="min-h-[128px] border-b border-r border-slate-100 bg-slate-50/40" />)}
      </div>
    </>
  );
}

// ─────────────────────────────── Week view ────────────────────────────────────
function WeekDayCol({ dateIso, shifts, openDay }: { dateIso: string; shifts: Shift[]; openDay: (iso: string) => void }) {
  const { isOver, setNodeRef } = useDroppable({ id: dateIso });
  const holiday = shifts.find((c) => c.holiday)?.holiday ?? null;
  const students = studentsOnDay(shifts);
  return (
    <div ref={setNodeRef} className={`flex min-h-[340px] flex-col border-r border-slate-100 ${isOver ? "bg-rose-50 ring-2 ring-inset ring-rose-400" : ""}`}>
      <button onClick={() => openDay(dateIso)} className="border-b border-slate-100 bg-slate-50 px-2 py-2 text-left hover:bg-slate-100" title="open the day view">
        <span className="block text-xs font-semibold text-slate-700">{new Date(dateIso + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })} {fmtMD(dateIso)}</span>
        <span className="block text-[10px] text-slate-500">{shifts.length ? `${n0(shifts.length)} shifts · ${n0(students)} students` : "—"}{holiday ? ` · ⚠ ${holiday}` : ""}</span>
      </button>
      <div className="flex-1 space-y-1 p-1.5">
        {shifts.map((c) => <ShiftChipEl key={c.key} shift={c} size="md" />)}
      </div>
    </div>
  );
}

function WeekView({ cur, byDate, openDay }: { cur: string; byDate: Map<string, Shift[]>; openDay: (iso: string) => void }) {
  const monday = addDaysIso(cur, -((new Date(cur + "T00:00:00Z").getUTCDay() + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) => addDaysIso(monday, i));
  return (
    <div className="grid grid-cols-7">
      {days.map((iso) => <WeekDayCol key={iso} dateIso={iso} shifts={byDate.get(iso) ?? []} openDay={openDay} />)}
    </div>
  );
}

// ─────────────────────────────── Semester view ────────────────────────────────
function SemesterView({ rows, byDate, openDay }: { rows: DatedInstance[]; byDate: Map<string, Shift[]>; openDay: (iso: string) => void }) {
  // term → its calendar weeks (mondays), from the dated rows.
  const terms = useMemo(() => {
    const byTerm = new Map<number, { termName: string; semester: string; mondays: Set<string> }>();
    for (const r of rows) {
      if (!r.mondayIso) continue;
      const t = byTerm.get(r.termIndex) ?? { termName: r.termName, semester: `${r.semester} ${r.mondayIso.slice(0, 4)}`, mondays: new Set<string>() };
      t.mondays.add(r.mondayIso);
      byTerm.set(r.termIndex, t);
    }
    return [...byTerm.entries()].sort((a, b) => a[0] - b[0]).map(([idx, t]) => ({ idx, ...t, weeks: [...t.mondays].sort() }));
  }, [rows]);

  return (
    <div className="divide-y divide-slate-100">
      {terms.map((t) => (
        <div key={t.idx}>
          <div className="flex flex-wrap items-baseline gap-x-4 bg-slate-800 px-4 py-2 text-slate-100">
            <span className="text-sm font-semibold">{t.termName} — {t.semester}</span>
            <span className="text-xs text-slate-300 tabular-nums">{fmtDateM(t.weeks[0])} → {fmtDateM(addDaysIso(t.weeks[t.weeks.length - 1], 6))} · {t.weeks.length} weeks</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-1.5 font-semibold">Week of</th>
                  {WEEKDAYS.map((d) => <th key={d} className="px-2 py-1.5 text-center font-semibold">{d}</th>)}
                </tr>
              </thead>
              <tbody>
                {t.weeks.map((monday) => (
                  <tr key={monday} className="border-b border-slate-100">
                    <td className="whitespace-nowrap px-3 py-1.5 font-medium text-slate-700">{fmtDateM(monday)}</td>
                    {WEEKDAYS.map((_, di) => {
                      const iso = addDaysIso(monday, di);
                      const dayShifts = byDate.get(iso) ?? [];
                      if (!dayShifts.length) return <td key={iso} className="px-2 py-1.5 text-center text-slate-200">·</td>;
                      const kinds = [...new Set(dayShifts.map((c) => c.kind))];
                      const holiday = dayShifts.some((c) => c.holiday);
                      return (
                        <td key={iso} className="px-1 py-1 text-center">
                          <button onClick={() => openDay(iso)} className={`w-full rounded-lg px-1.5 py-1 hover:ring-2 hover:ring-rose-300 ${holiday ? "bg-rose-100" : "bg-slate-100"}`} title={`${fmtDate(iso)} — ${dayShifts.length} shifts · open the day view`}>
                            <span className="flex items-center justify-center gap-1">
                              {kinds.map((k) => <span key={k} className={`h-2 w-2 rounded-full ${KIND_DOT[k]}`} />)}
                              <span className="font-mono text-[11px] font-semibold tabular-nums text-slate-700">{dayShifts.length}</span>
                            </span>
                            <span className="block text-[9px] text-slate-500">{n0(studentsOnDay(dayShifts))} stu{holiday ? " ⚠" : ""}</span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────── Day view ─────────────────────────────────────
/** Students actually on site that day: sections of the SAME session host the
 *  same cohort split into groups, and a cohort's students attend each of the
 *  day's sessions — so count each cohort's students once (its biggest
 *  session's seat total), never seats × sessions. */
function studentsOnDay(dayShifts: Shift[]): number {
  const byCohort = new Map<string, Map<string, number>>();
  for (const c of dayShifts) {
    const s = byCohort.get(c.cohortId) ?? new Map<string, number>();
    s.set(c.sessionKey, (s.get(c.sessionKey) ?? 0) + c.seats);
    byCohort.set(c.cohortId, s);
  }
  let total = 0;
  for (const sessions of byCohort.values()) total += Math.max(0, ...sessions.values());
  return total;
}

function DayView({ dateIso, shifts, rooms, people, sites, onSaved }: {
  dateIso: string; shifts: Shift[];
  rooms: CalRoom[]; people: CalPerson[]; sites: CalSite[];
  onSaved: () => void;
}) {
  // Group by session — the unit people reason about ("Test 1 runs in 8 groups").
  const groups = useMemo(() => {
    const m = new Map<string, Shift[]>();
    for (const c of shifts) { const l = m.get(c.sessionKey) ?? []; l.push(c); m.set(c.sessionKey, l); }
    return [...m.values()].sort((a, b) => (a[0].time ?? "99").localeCompare(b[0].time ?? "99"));
  }, [shifts]);

  if (!shifts.length) {
    return <p className="px-4 py-6 text-sm text-slate-400">Nothing scheduled on {fmtDate(dateIso)}.</p>;
  }

  const students = studentsOnDay(shifts);
  const instructorSections = shifts.filter((c) => c.kind !== "CLINICAL").length;
  const preceptors = shifts.reduce((n, c) => n + c.preceptorsPerSection, 0);
  const holiday = shifts.find((c) => c.holiday)?.holiday ?? null;
  const cohorts = [...new Set(shifts.map((c) => c.cohort))];

  return (
    <div className="space-y-4 px-4 py-4">
      {/* The day's numbers — with the math spelled out */}
      <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <Stat v={n0(shifts.length)} k="shifts" d={`${groups.length} session${groups.length === 1 ? "" : "s"} × their sections`} />
          <Stat v={n0(students)} k="students" d="each counted once — the same students rotate through the day's sessions" />
          {instructorSections > 0 && <Stat v={n0(instructorSections)} k="instructor-led sections" d="one instructor per class/lab section-meeting" />}
          {preceptors > 0 && <Stat v={n0(preceptors)} k="preceptors on site" d="1 per precepted student group" />}
        </div>
        {holiday && <p className="mt-2 text-sm font-medium text-rose-700">⚠ {holiday} — consider moving these shifts.</p>}
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          How to read this: {groups.length === 1 ? "one session runs" : `${groups.length} sessions run`} today for {cohorts.join(" · ")}.
          {" "}Each session splits its cohort into sections (groups) — e.g. {groups[0][0].of} section{groups[0][0].of === 1 ? "" : "s"} of {n0(groups[0][0].seats)} students —
          and every section-meeting is one <strong>shift</strong> needing a room{preceptors > 0 ? " or clinical site" : ""} and a person to run it.
          Students are counted once even when they attend several sessions.
        </p>
      </div>

      {/* Session groups, each shift editable in place */}
      {groups.map((g) => {
        const s0 = g[0];
        return (
          <div key={s0.sessionKey} className="overflow-hidden rounded-xl border border-slate-200">
            <div className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 ${KIND_CHIP[s0.kind]}`}>
              <span className="text-sm font-semibold">{fmtT(s0.time)} · {s0.courseCode ?? s0.courseTitle} · {KIND_LABEL[s0.kind]}</span>
              {s0.sessionTitle && <span className="text-sm">“{s0.sessionTitle}”</span>}
              <span className="text-xs opacity-80">{n0(g.length)} of {n0(s0.of)} section{s0.of === 1 ? "" : "s"} today · {n0(s0.seats)} students each · {s0.lengthHours}h · {s0.cohort}</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-1.5 font-semibold">Shift</th>
                  <th className="px-3 py-1.5 font-semibold">Date</th>
                  <th className="px-3 py-1.5 font-semibold">Time</th>
                  <th className="px-3 py-1.5 font-semibold">{s0.kind === "CLINICAL" ? "Clinical site" : "Room"}</th>
                  <th className="px-3 py-1.5 font-semibold">{s0.kind === "CLINICAL" ? "Preceptor" : "Instructor"}</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Students</th>
                  <th className="px-3 py-1.5 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {g.map((c) => <ShiftEditorRow key={c.key} shift={c} rooms={rooms} people={people} sites={sites} onSaved={onSaved} />)}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function Stat({ v, k, d }: { v: string; k: string; d: string }) {
  return (
    <span className="inline-flex flex-col">
      <span><strong className="text-2xl tabular-nums text-slate-900">{v}</strong> <span className="text-sm font-medium text-slate-700">{k}</span></span>
      <span className="text-[11px] text-slate-400">{d}</span>
    </span>
  );
}

/** One shift OCCURRENCE, editable in place: date · time · location · staff.
 *  Saving records a per-occurrence move (this date only); "pattern" puts it
 *  back on the weekly booking. */
function ShiftEditorRow({ shift, rooms, people, sites, onSaved }: {
  shift: Shift; rooms: CalRoom[]; people: CalPerson[]; sites: CalSite[]; onSaved: () => void;
}) {
  const m = shift.meeting;
  const mv = shift.move;
  const key = { cohortId: shift.cohortId, sessionId: shift.sessionId, sectionIndex: shift.section, meetingId: m?.id ?? null };
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState(shift.dateIso);
  const [time, setTime] = useState(shift.time ?? "");
  const clin = shift.kind === "CLINICAL";
  const [loc, setLoc] = useState(clin ? (mv?.employerId ?? m?.employerId ?? "") : (mv?.facilityId ?? m?.facilityId ?? ""));
  const [staff, setStaff] = useState(mv?.staffPersonId ?? m?.staffPersonId ?? "");
  const dirty = date !== shift.dateIso || time !== (shift.time ?? "") || loc !== (clin ? (mv?.employerId ?? m?.employerId ?? "") : (mv?.facilityId ?? m?.facilityId ?? "")) || staff !== (mv?.staffPersonId ?? m?.staffPersonId ?? "");
  const staffPool = clin ? people.filter((p) => p.role === "preceptor") : people.filter((p) => p.role !== "preceptor");
  const eligibleRooms = rooms.filter((r) => (shift.kind === "LAB" ? r.kind === "LAB" || r.kind === "SIM" : r.kind === "CLASSROOM" || r.kind === "OTHER"));
  const inp = "rounded border border-slate-300 px-2 py-1 text-sm";
  const save = () => {
    startTransition(async () => {
      await moveShiftOccurrence(key, shift.originDate, {
        toDate: date,
        startTime: time || null,
        facilityId: clin ? undefined : (loc || null),
        employerId: clin ? (loc || null) : undefined,
        staffPersonId: staff || null,
      });
      onSaved();
    });
  };
  const reset = () => {
    startTransition(async () => { await clearShiftMove(key, shift.originDate); onSaved(); });
  };
  return (
    <tr className="border-b border-slate-50 align-middle">
      <td className="whitespace-nowrap px-3 py-1.5 font-medium text-slate-700">§{shift.section}</td>
      <td className="px-3 py-1.5">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inp} />
        {shift.moved && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800" title={`weekly pattern puts this on ${shift.originDate}`}>moved</span>}
      </td>
      <td className="px-3 py-1.5"><input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inp} /></td>
      <td className="px-3 py-1.5">
        {clin ? (
          <select value={loc} onChange={(e) => setLoc(e.target.value)} className={`${inp} max-w-[16rem]`}>
            <option value="">— site TBD —</option>
            {sites.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        ) : (
          <select value={loc} onChange={(e) => setLoc(e.target.value)} className={`${inp} max-w-[16rem]`}>
            <option value="">— unroomed —</option>
            {eligibleRooms.map((r) => <option key={r.id} value={r.id}>{r.name}{r.capacity != null ? ` (cap ${r.capacity})` : ""}</option>)}
          </select>
        )}
      </td>
      <td className="px-3 py-1.5">
        <select value={staff} onChange={(e) => setStaff(e.target.value)} className={`${inp} max-w-[14rem]`}>
          <option value="">— unassigned —</option>
          {staffPool.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </td>
      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700">{n0(shift.seats)}</td>
      <td className="whitespace-nowrap px-3 py-1.5">
        <button onClick={save} disabled={!dirty || pending} className={`rounded-lg px-3 py-1 text-xs font-medium ${dirty ? "bg-rose-600 text-white hover:bg-rose-700" : "bg-slate-100 text-slate-400"}`}>
          {pending ? "Saving…" : "Save"}
        </button>
        {shift.moved && <button onClick={reset} disabled={pending} className="ml-1 rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-white" title="put this shift back on its weekly pattern">pattern</button>}
      </td>
    </tr>
  );
}
