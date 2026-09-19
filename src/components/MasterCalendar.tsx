"use client";

// THE MASTER CALENDAR — every class, lab and clinical shift of a college on one timeline, at any
// grain (day · week · month · quarter · semester · year), backwards and forwards without limit,
// searchable by a student, an instructor or preceptor, a clinical site, a room, an offering, a
// program or a course. The server dates and joins everything (lib/calendarquery); this draws it.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { moveMeeting } from "@/lib/actions";
import { dec, fmt } from "@/lib/format";
import type { CalendarData } from "@/lib/calendarquery";
import { CAL_VIEWS, KIND_LABEL, ENTITY_LABEL, entityKey, searchEntities, monthsIn, monthGrid, monthLabel, dayLabel, shortDate, addDaysIso, mondayIso, dowShort, DOW_SHORT, type CalView, type CalEvent, type CalEntity, type EventKind, type CalDayAgg } from "@/lib/calendarview";

// Kind colors: the validated categorical order (blue · orange · aqua). Text stays in slate.
const KIND_COLOR: Record<EventKind, string> = { CLASS: "#2a78d6", LAB: "#eb6834", CLINICAL: "#1baf7a" };
const KIND_TINT: Record<EventKind, string> = { CLASS: "#e3eefb", LAB: "#fdeae2", CLINICAL: "#dcf5ec" };
const KIND_GLYPH: Record<EventKind, string> = { CLASS: "C", LAB: "L", CLINICAL: "⚕" };
// Density: one hue, light → dark (sequential), for the coarse views.
const DENSITY = ["#f1f5f9", "#dbeafe", "#93c5fd", "#3b82f6", "#1d4ed8"];
const densityStep = (n: number) => (n <= 0 ? 0 : n <= 2 ? 1 : n <= 5 ? 2 : n <= 9 ? 3 : 4);
const START_HOUR = 6, END_HOUR = 22, HOUR_PX = 40;
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const fmtTime = (t: string | null) => { if (!t) return "any time"; const [h, m] = t.split(":").map(Number); const ap = h >= 12 ? "p" : "a"; const hh = h % 12 || 12; return m ? `${hh}:${String(m).padStart(2, "0")}${ap}` : `${hh}${ap}`; };
const ENTITY_TONE: Record<string, string> = { student: "bg-violet-100 text-violet-800", person: "bg-emerald-100 text-emerald-800", site: "bg-rose-100 text-rose-800", room: "bg-sky-100 text-sky-800", cohort: "bg-amber-100 text-amber-800", program: "bg-slate-200 text-slate-700", course: "bg-fuchsia-100 text-fuchsia-800" };

export interface CalendarUrlState { view: CalView; date: string; who: string | null; kind: EventKind | null; program: string | null }

export function MasterCalendar({ data, state }: { data: CalendarData; state: CalendarUrlState }) {
  const router = useRouter();
  const [pending, startNav] = useTransition();
  const [selected, setSelected] = useState<CalEvent | null>(null);
  const [editing, setEditing] = useState<{ event: CalEvent; sectionIndex: number; patternId: string } | null>(null);
  useEffect(() => { setSelected(null); }, [data.range.fromIso, data.range.toIso, data.who?.id]);

  const go = (patch: Partial<CalendarUrlState> & { inst?: string }) => {
    const s = { ...state, ...patch };
    const q = new URLSearchParams();
    q.set("inst", patch.inst ?? data.institutionId ?? "");
    q.set("view", s.view); q.set("date", s.date);
    if (s.who) q.set("who", s.who); if (s.kind) q.set("kind", s.kind); if (s.program) q.set("program", s.program);
    startNav(() => router.push(`/calendar?${q.toString()}`));
  };
  const open = (view: CalView, date: string) => go({ view, date });
  const r = data.range;
  const t = data.totals;
  const eventById = useMemo(() => new Map(data.events.map((e) => [e.id, e])), [data.events]);
  const conflictEventIds = useMemo(() => new Set(data.conflicts.flatMap((c) => c.eventIds)), [data.conflicts]);
  const holidayOn = useMemo(() => new Map(data.holidays.map((h) => [h.date, h.label])), [data.holidays]);
  const closedOn = useMemo(() => new Map(data.closedWeeks.map((w) => [w.mondayIso, w.label])), [data.closedWeeks]);
  const marksOn = useMemo(() => { const m = new Map<string, string[]>(); for (const x of data.semesterMarks) m.set(x.iso, [...(m.get(x.iso) ?? []), x.label]); return m; }, [data.semesterMarks]);
  const eventsByDate = useMemo(() => { const m = new Map<string, CalEvent[]>(); for (const e of data.events) m.set(e.date, [...(m.get(e.date) ?? []), e]); return m; }, [data.events]);

  return (
    <div className="space-y-4">
      {/* ── Toolbar: what to look at ──────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">College</span>
            <select value={data.institutionId ?? ""} onChange={(e) => go({ inst: e.target.value, who: null, program: null })} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
              {data.institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </label>
          <SearchBox entities={data.entities} who={data.who} onPick={(e) => go({ who: e ? entityKey(e) : null })} />
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Type</span>
            <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-xs">
              {([[null, "All"], ["CLASS", "Class"], ["LAB", "Lab"], ["CLINICAL", "Clinical"]] as [EventKind | null, string][]).map(([k, l]) => (
                <button key={l} onClick={() => go({ kind: k })} className={`px-2.5 py-1.5 ${state.kind === k ? "bg-slate-800 font-medium text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>{l}</button>
              ))}
            </div>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Program</span>
            <select value={state.program ?? ""} onChange={(e) => go({ program: e.target.value || null })} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
              <option value="">All programs</option>
              {data.programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-sm">
            {CAL_VIEWS.map((v) => <button key={v.key} onClick={() => open(v.key, state.date)} className={`px-3 py-1.5 ${state.view === v.key ? "bg-rose-600 font-medium text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>{v.label}</button>)}
          </div>
          <div className="inline-flex items-center gap-1">
            <button onClick={() => open(state.view, r.prevIso)} aria-label="Previous" className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm hover:bg-slate-50">←</button>
            <button onClick={() => open(state.view, data.today)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm hover:bg-slate-50">Today</button>
            <button onClick={() => open(state.view, r.nextIso)} aria-label="Next" className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm hover:bg-slate-50">→</button>
          </div>
          <div className="text-lg font-semibold text-slate-900">{r.label}</div>
          <input type="date" value={state.date} onChange={(e) => { if (e.target.value) open(state.view, e.target.value); }} aria-label="Go to date" className="rounded-lg border border-slate-300 px-2 py-1 text-sm" />
          {pending && <span className="text-xs text-slate-400">loading…</span>}
          <div className="ml-auto flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
            {(["CLASS", "LAB", "CLINICAL"] as EventKind[]).map((k) => <span key={k} className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: KIND_COLOR[k] }} />{KIND_LABEL[k]}</span>)}
          </div>
        </div>
      </div>

      {/* ── What is in the range ───────────────────────────────────────────────────────────── */}
      {data.who && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${ENTITY_TONE[data.who.kind]}`}>{ENTITY_LABEL[data.who.kind]}</span>
          <span className="font-semibold text-slate-900">{data.who.name}</span>
          {data.who.sub && <span className="text-slate-500">· {data.who.sub}</span>}
          <span className="text-slate-500">· everything on the calendar that touches them, {r.label.toLowerCase()}</span>
          <button onClick={() => go({ who: null })} className="text-xs text-slate-400 hover:text-rose-600">clear ✕</button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        <Tile label="Sessions" value={fmt.num(t.sessions)} sub={`${fmt.num(t.classes)} class · ${fmt.num(t.labs)} lab · ${fmt.num(t.clinicals)} clinical`} />
        <Tile label="Student shifts" value={fmt.num(t.studentShifts)} sub="one student on one clinical shift" />
        <Tile label="Hours" value={dec(t.hours, 0, 1)} sub="session hours" />
        <Tile label="Days" value={fmt.num(t.days)} sub="with anything on" />
        <Tile label="Sites" value={fmt.num(t.sites)} sub="clinical sites in use" />
        <Tile label="Rooms" value={fmt.num(t.rooms)} sub="rooms in use" />
        <Tile label="People" value={fmt.num(t.people)} sub="instructors and preceptors" />
        <Tile label="Students" value={fmt.num(t.students)} sub="distinct" />
      </div>
      {(t.movedByRule > 0 || t.onHoliday > 0 || data.conflicts.length > 0 || t.unbookedClinical > 0 || data.closedWeeks.length > 0 || data.holidays.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {data.conflicts.length > 0 && <span className="rounded-full bg-rose-600 px-2 py-0.5 font-medium text-white">{data.conflicts.length} conflict{data.conflicts.length === 1 ? "" : "s"}</span>}
          {t.onHoliday > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">{fmt.num(t.onHoliday)} on a holiday the rule could not resolve</span>}
          {t.movedByRule > 0 && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-800">{fmt.num(t.movedByRule)} moved off a holiday by the rule</span>}
          {t.unbookedClinical > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{fmt.num(t.unbookedClinical)} clinical sections not booked on a site asset</span>}
          {data.closedWeeks.map((w) => <span key={w.mondayIso} className="rounded-full bg-slate-800 px-2 py-0.5 text-white">closed week of {shortDate(w.mondayIso)} · {w.label}</span>)}
          {data.holidays.filter((h) => !closedOn.has(mondayIso(h.date))).slice(0, 8).map((h) => <span key={h.date} className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800 ring-1 ring-amber-200">{shortDate(h.date)} · {h.label}</span>)}
        </div>
      )}

      {/* ── The calendar itself ────────────────────────────────────────────────────────────── */}
      {state.view === "day" && <DayView date={r.fromIso} events={data.events} holiday={holidayOn.get(r.fromIso) ?? null} closed={closedOn.get(mondayIso(r.fromIso)) ?? null} marks={marksOn.get(r.fromIso) ?? []} conflictIds={conflictEventIds} onSelect={setSelected} selected={selected} />}
      {state.view === "week" && <WeekView monday={r.fromIso} eventsByDate={eventsByDate} holidayOn={holidayOn} closed={closedOn.get(r.fromIso) ?? null} marksOn={marksOn} conflictIds={conflictEventIds} today={data.today} onSelect={setSelected} selected={selected} onDay={(d) => open("day", d)} />}
      {state.view === "month" && <MonthView monthIso={r.fromIso} eventsByDate={eventsByDate} holidayOn={holidayOn} closedOn={closedOn} marksOn={marksOn} conflictIds={conflictEventIds} today={data.today} onSelect={setSelected} onDay={(d) => open("day", d)} onWeek={(d) => open("week", d)} />}
      {(state.view === "quarter" || state.view === "semester" || state.view === "year") && <CoarseView fromIso={r.fromIso} toIso={r.toIso} days={data.days} holidayOn={holidayOn} closedOn={closedOn} today={data.today} terms={data.terms} onDay={(d) => open("day", d)} onMonth={(d) => open("month", d)} onWeek={(d) => open("week", d)} />}

      {/* Conflicts, when the view carries events */}
      {data.conflicts.length > 0 && (
        <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4">
          <h3 className="text-sm font-semibold text-rose-700">{data.conflicts.length} conflict{data.conflicts.length === 1 ? "" : "s"} <span className="font-normal text-rose-500">— on the dates things happen, after every move</span></h3>
          <div className="mt-2 space-y-1">
            {data.conflicts.slice(0, 30).map((c, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 text-[12px]">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${c.kind === "room" ? "bg-rose-200 text-rose-800" : c.kind === "staff" ? "bg-violet-200 text-violet-800" : "bg-amber-200 text-amber-800"}`}>{c.kind}</span>
                <span className="text-slate-500">{shortDate(c.dateIso)}</span>
                {c.eventIds.map((id) => { const e = eventById.get(id); return e ? <button key={id} onClick={() => setSelected(e)} className="text-slate-700 hover:text-rose-700 hover:underline">{e.courseCode ?? e.courseName} ({e.cohortName})</button> : null; })}
                <span className="text-slate-400">{c.detail}{c.pairs > 1 ? ` · ${fmt.num(c.pairs)} sections` : ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {selected && <Detail event={selected} canEdit={data.canEdit} onClose={() => setSelected(null)} onEdit={(sectionIndex, patternId) => setEditing({ event: selected, sectionIndex, patternId })} onWho={(e) => go({ who: entityKey(e) })} />}
      {editing && <PatternEditor event={editing.event} sectionIndex={editing.sectionIndex} patternId={editing.patternId} rooms={data.rooms} people={data.people} employers={data.employers} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setSelected(null); router.refresh(); }} />}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-xl font-semibold tabular-nums text-slate-900">{value}</div>
      {sub && <div className="truncate text-[10px] text-slate-400" title={sub}>{sub}</div>}
    </div>
  );
}

// ── Search ──────────────────────────────────────────────────────────────────────────────────────
function SearchBox({ entities, who, onPick }: { entities: CalEntity[]; who: CalEntity | null; onPick: (e: CalEntity | null) => void }) {
  const [q, setQ] = useState("");
  const [openList, setOpenList] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const hits = useMemo(() => searchEntities(entities, q, 10), [entities, q]);
  useEffect(() => { const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpenList(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);
  const pick = (e: CalEntity) => { onPick(e); setQ(""); setOpenList(false); };
  return (
    <div ref={box} className="relative block min-w-[18rem] flex-1">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Find a student, instructor, preceptor, site, room, offering, program or course</span>
      {who ? (
        <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-sm">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${ENTITY_TONE[who.kind]}`}>{ENTITY_LABEL[who.kind]}</span>
          <span className="truncate font-medium text-slate-800">{who.name}</span>
          <button onClick={() => onPick(null)} className="ml-auto text-xs text-slate-400 hover:text-rose-600" aria-label="Clear the search">✕</button>
        </div>
      ) : (
        <input value={q} onChange={(e) => { setQ(e.target.value); setOpenList(true); setHi(0); }} onFocus={() => setOpenList(true)}
          onKeyDown={(e) => { if (e.key === "ArrowDown") { setHi((h) => Math.min(h + 1, hits.length - 1)); e.preventDefault(); } else if (e.key === "ArrowUp") { setHi((h) => Math.max(h - 1, 0)); e.preventDefault(); } else if (e.key === "Enter" && hits[hi]) pick(hits[hi]); else if (e.key === "Escape") setOpenList(false); }}
          placeholder="type a name…" aria-label="Search the calendar" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
      )}
      {openList && q && (
        <div className="absolute z-30 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {hits.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">Nothing matches.</div>}
          {hits.map((e, i) => (
            <button key={entityKey(e)} onMouseDown={() => pick(e)} className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${i === hi ? "bg-rose-50" : "hover:bg-slate-50"}`}>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${ENTITY_TONE[e.kind]}`}>{ENTITY_LABEL[e.kind]}</span>
              <span className="truncate font-medium text-slate-800">{e.name}</span>
              {e.sub && <span className="truncate text-xs text-slate-400">{e.sub}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Shared pieces ───────────────────────────────────────────────────────────────────────────────
const whereOf = (e: CalEvent) => {
  if (e.online) return "online";
  const places = [...new Set(e.sections.map((s) => (e.kind === "CLINICAL" ? s.site : s.room)).filter(Boolean))] as string[];
  const none = e.sections.filter((s) => !(e.kind === "CLINICAL" ? s.siteId : s.roomId)).length;
  if (!places.length) return e.kind === "CLINICAL" ? "site TBD" : "no room";
  return `${places.slice(0, 2).join(", ")}${places.length > 2 ? ` +${places.length - 2}` : ""}${none ? ` · ${none} unplaced` : ""}`;
};
const staffOf = (e: CalEvent) => { const names = [...new Set(e.sections.flatMap((s) => s.staff.map((p) => p.name)))]; return names.length ? (names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ")) : null; };
const Badges = ({ e, conflict }: { e: CalEvent; conflict: boolean }) => (
  <>
    {conflict && <span className="rounded bg-rose-600 px-1 text-[9px] font-semibold text-white">conflict</span>}
    {e.holiday && <span className="rounded bg-amber-100 px-1 text-[9px] font-semibold text-amber-800" title={`on ${e.holiday}: the rule found no open day`}>on {e.holiday}</span>}
    {e.holidayMoved && <span className="rounded bg-sky-100 px-1 text-[9px] font-semibold text-sky-800" title={`moved off ${e.holidayMoved.holiday} (${shortDate(e.holidayMoved.fromIso)}) by the holiday rule`}>↪ off {e.holidayMoved.holiday}</span>}
    {e.sections.some((s) => s.moved) && <span className="rounded bg-amber-100 px-1 text-[9px] font-semibold text-amber-800" title="moved by hand from its pattern date">moved</span>}
    {e.kind === "CLINICAL" && e.sections.some((s) => !s.booked && s.siteId) && <span className="rounded bg-slate-100 px-1 text-[9px] font-semibold text-slate-600" title="the section's weekly site; nothing is booked on a site asset for this date">not booked</span>}
    {!e.online && !e.sections.some((s) => s.staff.length) && <span className="rounded bg-amber-50 px-1 text-[9px] font-semibold text-amber-700">unstaffed</span>}
  </>
);
const eventTitle = (e: CalEvent) => `${e.courseCode ?? e.courseName} · ${KIND_LABEL[e.kind]}${e.title ? ` · ${e.title}` : ""}`;

// ── Day ─────────────────────────────────────────────────────────────────────────────────────────
function DayView({ date, events, holiday, closed, marks, conflictIds, onSelect, selected }: { date: string; events: CalEvent[]; holiday: string | null; closed: string | null; marks: string[]; conflictIds: Set<string>; onSelect: (e: CalEvent) => void; selected: CalEvent | null }) {
  const sites = useMemo(() => {
    const m = new Map<string, { name: string; students: { name: string; cohort: string; course: string; preceptor: string | null }[]; preceptors: Set<string> }>();
    for (const e of events.filter((x) => x.kind === "CLINICAL")) for (const s of e.sections) {
      const k = s.siteId ?? "tbd"; const site = m.get(k) ?? { name: s.site ?? "site TBD", students: [], preceptors: new Set() };
      for (const st of s.students) site.students.push({ name: st.name, cohort: e.cohortName, course: e.courseCode ?? e.courseName, preceptor: s.staff.find((p) => p.role === "preceptor")?.name ?? null });
      for (const p of s.staff) if (p.role === "preceptor") site.preceptors.add(p.name);
      m.set(k, site);
    }
    return [...m.values()].sort((a, b) => b.students.length - a.students.length);
  }, [events]);
  return (
    <div className="space-y-4">
      {(holiday || closed || marks.length > 0) && (
        <div className="flex flex-wrap gap-2 text-xs">
          {closed && <span className="rounded-full bg-slate-800 px-2 py-0.5 text-white">closed week · {closed}</span>}
          {holiday && !closed && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">{holiday} · college closed</span>}
          {marks.map((m) => <span key={m} className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">{m}</span>)}
        </div>
      )}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {events.length === 0 ? <p className="px-5 py-6 text-sm text-slate-400">Nothing on the calendar this day.</p> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2">When</th><th className="px-3 py-2">What</th><th className="px-3 py-2">Offering</th><th className="px-3 py-2">Where</th><th className="px-3 py-2">Who</th><th className="px-3 py-2 text-right">Students</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {events.map((e) => (
                <tr key={e.id} onClick={() => onSelect(e)} className={`cursor-pointer ${selected?.id === e.id ? "bg-rose-50" : "hover:bg-slate-50/70"}`}>
                  <td className="whitespace-nowrap px-4 py-2 tabular-nums text-slate-700"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ backgroundColor: KIND_COLOR[e.kind] }} />{fmtTime(e.startTime)}{e.endTime ? `–${fmtTime(e.endTime)}` : ""}</td>
                  <td className="px-3 py-2"><div className="font-medium text-slate-800">{e.courseCode ?? e.courseName} <span className="font-normal text-slate-500">· {KIND_LABEL[e.kind]}</span></div><div className="text-xs text-slate-500">{e.title ?? e.courseName} · {e.termName} wk {e.weekOfTerm}</div><div className="mt-0.5 flex flex-wrap gap-1"><Badges e={e} conflict={conflictIds.has(e.id)} /></div></td>
                  <td className="px-3 py-2 text-slate-700">{e.cohortName}<div className="text-xs text-slate-400">{e.programName}</div></td>
                  <td className="px-3 py-2 text-slate-700">{whereOf(e)}</td>
                  <td className="px-3 py-2 text-slate-700">{staffOf(e) ?? <span className="text-amber-700">{e.online ? "—" : "nobody named"}</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmt.num(e.students)}<span className="text-slate-400"> / {e.sections.length} sect.</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {sites.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-800">Who is where <span className="text-xs font-normal text-slate-500">· every clinical site, the students on it and the preceptors named</span></h3>
          <table className="mt-2 w-full text-xs">
            <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-2 py-1">Site</th><th className="px-2 py-1 text-right">Students</th><th className="px-2 py-1">Who</th><th className="px-2 py-1">Preceptors</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {sites.map((s) => (
                <tr key={s.name} className="align-top">
                  <td className="px-2 py-1 font-medium text-slate-800">{s.name}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmt.num(s.students.length)}</td>
                  <td className="px-2 py-1"><div className="flex flex-wrap gap-1">{s.students.map((st, i) => <span key={i} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700" title={`${st.cohort} · ${st.course}${st.preceptor ? ` · with ${st.preceptor}` : ""}`}>{st.name}</span>)}{s.students.length === 0 && <span className="text-slate-400">no students on the roster</span>}</div></td>
                  <td className="px-2 py-1 text-slate-600">{s.preceptors.size ? [...s.preceptors].join(", ") : <span className="text-amber-700">none named</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Week ────────────────────────────────────────────────────────────────────────────────────────
function WeekView({ monday, eventsByDate, holidayOn, closed, marksOn, conflictIds, today, onSelect, selected, onDay }: { monday: string; eventsByDate: Map<string, CalEvent[]>; holidayOn: Map<string, string>; closed: string | null; marksOn: Map<string, string[]>; conflictIds: Set<string>; today: string; onSelect: (e: CalEvent) => void; selected: CalEvent | null; onDay: (d: string) => void }) {
  const days = Array.from({ length: 7 }, (_, i) => addDaysIso(monday, i));
  const gridHeight = (END_HOUR - START_HOUR) * HOUR_PX;
  const layout = (date: string) => {
    const timed = (eventsByDate.get(date) ?? []).filter((e) => e.startTime).sort((a, b) => toMin(a.startTime!) - toMin(b.startTime!));
    const laneEnds: number[] = [];
    const placed = timed.map((e) => { const s = toMin(e.startTime!), en = s + e.hours * 60; let lane = laneEnds.findIndex((x) => x <= s); if (lane === -1) { lane = laneEnds.length; laneEnds.push(en); } else laneEnds[lane] = en; return { e, s, lane }; });
    return { placed, lanes: Math.max(1, laneEnds.length), untimed: (eventsByDate.get(date) ?? []).filter((e) => !e.startTime) };
  };
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      {closed && <div className="mb-2 rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-white">Closed week · {closed} · not a term week: nothing runs, and the term's weeks continue after it.</div>}
      <div className="flex min-w-[900px]">
        <div className="w-12 shrink-0 pt-12">
          {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => <div key={i} style={{ height: HOUR_PX }} className="relative -top-2 pr-1 text-right text-[10px] text-slate-400">{fmtTime(`${START_HOUR + i}:00`)}</div>)}
        </div>
        {days.map((date) => {
          const { placed, lanes, untimed } = layout(date);
          const hol = holidayOn.get(date);
          return (
            <div key={date} className={`flex-1 border-l border-slate-100 ${hol ? "bg-amber-50/50" : date === today ? "bg-rose-50/30" : ""}`}>
              <button onClick={() => onDay(date)} className="block w-full px-1 pb-1 text-center hover:text-rose-700" title="open the day">
                <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{dowShort(date)} <span className="font-normal normal-case text-slate-400">{shortDate(date)}</span></span>
                <span className="block h-4 truncate text-[10px] text-amber-700">{hol ?? marksOn.get(date)?.[0] ?? ""}</span>
              </button>
              <div className="min-h-[18px] space-y-0.5 px-0.5">
                {untimed.map((e) => <button key={e.id} onClick={() => onSelect(e)} className="block w-full truncate rounded px-1 text-left text-[9px] font-medium text-slate-800" style={{ backgroundColor: KIND_TINT[e.kind], borderLeft: `3px solid ${KIND_COLOR[e.kind]}` }}>{e.courseCode ?? e.courseName} · {e.online ? "online" : "any time"}</button>)}
              </div>
              <div className="relative" style={{ height: gridHeight }}>
                {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => <div key={i} style={{ top: i * HOUR_PX, height: HOUR_PX }} className="absolute inset-x-0 border-t border-slate-50" />)}
                {placed.map(({ e, s, lane }) => {
                  const top = Math.max(0, ((s - START_HOUR * 60) / 60) * HOUR_PX);
                  const height = Math.max(18, e.hours * HOUR_PX - 2);
                  const w = 100 / lanes;
                  const conflict = conflictIds.has(e.id);
                  return (
                    <button key={e.id} onClick={() => onSelect(e)} style={{ top, height, left: `${lane * w}%`, width: `calc(${w}% - 2px)`, backgroundColor: KIND_TINT[e.kind], borderLeft: `3px solid ${KIND_COLOR[e.kind]}` }}
                      title={`${eventTitle(e)} · ${fmtTime(e.startTime)}–${fmtTime(e.endTime)} · ${whereOf(e)} · ${e.cohortName} · ${fmt.num(e.students)} students`}
                      className={`absolute overflow-hidden rounded-md px-1 py-0.5 text-left text-slate-900 ${selected?.id === e.id ? "ring-2 ring-rose-500" : conflict ? "ring-2 ring-rose-400" : ""} hover:brightness-95`}>
                      <span className="block truncate text-[10px] font-semibold leading-tight">{e.courseCode ?? e.courseName} <span className="font-normal opacity-70">{KIND_GLYPH[e.kind]}</span></span>
                      <span className="block truncate text-[9px] leading-tight opacity-80">{whereOf(e)}</span>
                      <span className="block truncate text-[9px] leading-tight opacity-70">{fmtTime(e.startTime)} · {fmt.num(e.students)} stu · {e.cohortName}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Month ───────────────────────────────────────────────────────────────────────────────────────
function MonthView({ monthIso, eventsByDate, holidayOn, closedOn, marksOn, conflictIds, today, onSelect, onDay, onWeek }: { monthIso: string; eventsByDate: Map<string, CalEvent[]>; holidayOn: Map<string, string>; closedOn: Map<string, string>; marksOn: Map<string, string[]>; conflictIds: Set<string>; today: string; onSelect: (e: CalEvent) => void; onDay: (d: string) => void; onWeek: (d: string) => void }) {
  const rows = monthGrid(monthIso);
  const MAX = 4;
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="grid grid-cols-[2.5rem_repeat(7,minmax(0,1fr))] border-b border-slate-100 bg-slate-50 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        <div className="py-1.5">wk</div>{DOW_SHORT.map((d) => <div key={d} className="py-1.5">{d}</div>)}
      </div>
      {rows.map((row) => {
        const closed = closedOn.get(row[0].iso);
        return (
          <div key={row[0].iso} className={`grid grid-cols-[2.5rem_repeat(7,minmax(0,1fr))] border-b border-slate-100 ${closed ? "bg-slate-100" : ""}`}>
            <button onClick={() => onWeek(row[0].iso)} className="border-r border-slate-100 py-2 text-center text-[10px] text-slate-400 hover:text-rose-700" title={closed ? `closed week · ${closed}` : "open the week"}>{closed ? "✕" : "→"}</button>
            {row.map(({ iso, inMonth }) => {
              const evs = eventsByDate.get(iso) ?? [];
              const hol = holidayOn.get(iso);
              return (
                <div key={iso} className={`min-h-[6.5rem] border-r border-slate-100 p-1 ${!inMonth ? "bg-slate-50/60" : hol ? "bg-amber-50/60" : ""} ${iso === today ? "ring-2 ring-inset ring-rose-300" : ""}`}>
                  <button onClick={() => onDay(iso)} className={`flex w-full items-baseline justify-between text-xs ${inMonth ? "text-slate-700" : "text-slate-400"} hover:text-rose-700`}>
                    <span className="font-semibold">{Number(iso.slice(8, 10))}</span>
                    {evs.length > 0 && <span className="text-[10px] tabular-nums text-slate-400">{fmt.num(evs.length)}</span>}
                  </button>
                  {hol && <div className="truncate text-[9px] text-amber-700" title={hol}>{hol}</div>}
                  {(marksOn.get(iso) ?? []).map((m) => <div key={m} className="truncate text-[9px] text-emerald-700" title={m}>{m}</div>)}
                  <div className="mt-0.5 space-y-0.5">
                    {evs.slice(0, MAX).map((e) => (
                      <button key={e.id} onClick={() => onSelect(e)} className={`block w-full truncate rounded px-1 text-left text-[9px] leading-4 text-slate-800 ${conflictIds.has(e.id) ? "ring-1 ring-rose-400" : ""}`} style={{ backgroundColor: KIND_TINT[e.kind], borderLeft: `3px solid ${KIND_COLOR[e.kind]}` }} title={`${eventTitle(e)} · ${whereOf(e)} · ${e.cohortName}`}>
                        <span className="tabular-nums text-slate-500">{e.startTime ? fmtTime(e.startTime) : "—"}</span> {e.courseCode ?? e.courseName}
                      </button>
                    ))}
                    {evs.length > MAX && <button onClick={() => onDay(iso)} className="block text-[9px] text-rose-700 hover:underline">+{fmt.num(evs.length - MAX)} more</button>}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ── Quarter · Semester · Year: density per day, months side by side ─────────────────────────────
function CoarseView({ fromIso, toIso, days, holidayOn, closedOn, today, terms, onDay, onMonth, onWeek }: { fromIso: string; toIso: string; days: Record<string, CalDayAgg>; holidayOn: Map<string, string>; closedOn: Map<string, string>; today: string; terms: CalendarData["terms"]; onDay: (d: string) => void; onMonth: (d: string) => void; onWeek: (d: string) => void }) {
  const months = monthsIn(fromIso, toIso);
  const byMonth = useMemo(() => {
    const m = new Map<string, { sessions: number; classes: number; labs: number; clinicals: number; studentShifts: number; hours: number; days: number }>();
    for (const d of Object.values(days)) { const k = d.date.slice(0, 7) + "-01"; const a = m.get(k) ?? { sessions: 0, classes: 0, labs: 0, clinicals: 0, studentShifts: 0, hours: 0, days: 0 }; a.sessions += d.sessions; a.classes += d.classes; a.labs += d.labs; a.clinicals += d.clinicals; a.studentShifts += d.studentShifts; a.hours += d.hours; a.days++; m.set(k, a); }
    return m;
  }, [days]);
  const cols = months.length <= 3 ? "md:grid-cols-3" : months.length <= 5 ? "md:grid-cols-3 xl:grid-cols-5" : "md:grid-cols-3 xl:grid-cols-4";
  return (
    <div className="space-y-4">
      <div className={`grid grid-cols-1 gap-3 ${cols}`}>
        {months.map((m) => {
          const agg = byMonth.get(m);
          return (
            <div key={m} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex items-baseline justify-between">
                <button onClick={() => onMonth(m)} className="text-sm font-semibold text-slate-900 hover:text-rose-700">{monthLabel(m)}</button>
                <span className="text-[10px] tabular-nums text-slate-500">{agg ? `${fmt.num(agg.sessions)} sessions · ${dec(agg.hours, 0, 0)} h` : "nothing"}</span>
              </div>
              <div className="mt-1 grid grid-cols-[1rem_repeat(7,minmax(0,1fr))] gap-0.5 text-center text-[9px] text-slate-400">
                <div />{DOW_SHORT.map((d) => <div key={d}>{d[0]}</div>)}
                {monthGrid(m).map((row) => {
                  const closed = closedOn.get(row[0].iso);
                  return [
                    <button key={`w${row[0].iso}`} onClick={() => onWeek(row[0].iso)} className="text-[8px] text-slate-300 hover:text-rose-700" title={closed ? `closed · ${closed}` : "open the week"}>{closed ? "✕" : "›"}</button>,
                    ...row.map(({ iso, inMonth }) => {
                      const a = days[iso]; const n = a?.sessions ?? 0; const step = densityStep(n); const hol = holidayOn.get(iso);
                      return (
                        <button key={iso} onClick={() => onDay(iso)} disabled={!inMonth} title={inMonth ? `${dayLabel(iso)}${hol ? ` · ${hol}` : ""}${a ? ` · ${fmt.num(a.sessions)} sessions · ${fmt.num(a.clinicals)} clinical · ${fmt.num(a.studentShifts)} student shifts · ${dec(a.hours, 0, 1)} h` : " · nothing on"}` : undefined}
                          className={`relative aspect-square rounded-sm text-[9px] tabular-nums ${!inMonth ? "opacity-0" : step >= 3 ? "text-white" : "text-slate-700"} ${iso === today ? "ring-2 ring-rose-500" : ""} ${closed ? "opacity-40" : ""} hover:ring-1 hover:ring-slate-400`}
                          style={{ backgroundColor: inMonth ? DENSITY[step] : undefined }}>
                          {n > 0 ? fmt.num(n) : ""}
                          {hol && inMonth && <span className="absolute right-0.5 top-0.5 h-1 w-1 rounded-full bg-amber-500" />}
                        </button>
                      );
                    }),
                  ];
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
        <span>sessions a day:</span>
        {["none", "1–2", "3–5", "6–9", "10+"].map((l, i) => <span key={l} className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: DENSITY[i] }} />{l}</span>)}
        <span className="inline-flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" /> holiday</span>
        <span>✕ closed week</span>
        <span>· click a day, a week (›) or a month to drill in</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-2 text-sm font-semibold text-slate-800">By month</div>
          <table className="w-full text-xs">
            <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-1.5">Month</th><th className="px-2 py-1.5 text-right">Sessions</th><th className="px-2 py-1.5 text-right">Class</th><th className="px-2 py-1.5 text-right">Lab</th><th className="px-2 py-1.5 text-right">Clinical</th><th className="px-2 py-1.5 text-right">Student shifts</th><th className="px-2 py-1.5 text-right">Hours</th><th className="px-2 py-1.5 text-right">Days</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {months.map((m) => { const a = byMonth.get(m); return <tr key={m}><td className="px-4 py-1"><button onClick={() => onMonth(m)} className="font-medium text-slate-800 hover:text-rose-700">{monthLabel(m, false)}</button></td><td className="px-2 py-1 text-right tabular-nums">{fmt.num(a?.sessions ?? 0)}</td><td className="px-2 py-1 text-right tabular-nums">{fmt.num(a?.classes ?? 0)}</td><td className="px-2 py-1 text-right tabular-nums">{fmt.num(a?.labs ?? 0)}</td><td className="px-2 py-1 text-right tabular-nums">{fmt.num(a?.clinicals ?? 0)}</td><td className="px-2 py-1 text-right tabular-nums">{fmt.num(a?.studentShifts ?? 0)}</td><td className="px-2 py-1 text-right tabular-nums">{dec(a?.hours ?? 0, 0, 0)}</td><td className="px-2 py-1 text-right tabular-nums">{fmt.num(a?.days ?? 0)}</td></tr>; })}
            </tbody>
          </table>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-2 text-sm font-semibold text-slate-800">Terms running <span className="text-xs font-normal text-slate-500">· each offering's terms that touch this range</span></div>
          {terms.length === 0 ? <p className="px-4 py-3 text-xs text-slate-400">No offering has a term in this range.</p> : (
            <table className="w-full text-xs">
              <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-1.5">Offering</th><th className="px-2 py-1.5">Term</th><th className="px-2 py-1.5">First day</th><th className="px-2 py-1.5">Last day</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {terms.map((tb) => <tr key={`${tb.cohortId}|${tb.termName}`}><td className="px-4 py-1"><Link href={`/programs/${tb.programId}/offerings/${tb.cohortId}`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{tb.cohortName}</Link><span className="block text-[10px] text-slate-400">{tb.programName}</span></td><td className="px-2 py-1 text-slate-700">{tb.termName}</td><td className="px-2 py-1 tabular-nums text-slate-700"><button onClick={() => onDay(tb.startIso)} className="hover:text-rose-700">{shortDate(tb.startIso)}, {tb.startIso.slice(0, 4)}</button></td><td className="px-2 py-1 tabular-nums text-slate-700"><button onClick={() => onDay(tb.endIso)} className="hover:text-rose-700">{shortDate(tb.endIso)}, {tb.endIso.slice(0, 4)}</button></td></tr>)}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ── One event, in full ──────────────────────────────────────────────────────────────────────────
function Detail({ event: e, canEdit, onClose, onEdit, onWho }: { event: CalEvent; canEdit: boolean; onClose: () => void; onEdit: (sectionIndex: number, patternId: string) => void; onWho: (x: { kind: CalEntity["kind"]; id: string }) => void }) {
  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-xl flex-col border-l border-slate-200 bg-white shadow-2xl">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: KIND_COLOR[e.kind] }} /><span className="text-xs font-medium uppercase tracking-wide text-slate-500">{KIND_LABEL[e.kind]}{e.online ? " · online" : ""}</span></div>
          <h3 className="mt-0.5 text-lg font-semibold text-slate-900">{e.courseCode ? `${e.courseCode} · ` : ""}{e.courseName}</h3>
          {e.title && <p className="text-sm text-slate-600">{e.title}</p>}
          <p className="mt-1 text-sm text-slate-700">{dayLabel(e.date)} · {fmtTime(e.startTime)}{e.endTime ? `–${fmtTime(e.endTime)}` : ""} · {dec(e.hours, 0, 1)} h</p>
          <p className="text-xs text-slate-500"><button onClick={() => onWho({ kind: "cohort", id: e.cohortId })} className="hover:text-rose-700 hover:underline">{e.cohortName}</button> · <button onClick={() => onWho({ kind: "program", id: e.programId })} className="hover:text-rose-700 hover:underline">{e.programName}</button> · {e.termName}, week {e.weekOfTerm}</p>
          <div className="mt-1.5 flex flex-wrap gap-1"><Badges e={e} conflict={false} /></div>
        </div>
        <button onClick={onClose} className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50">close</button>
      </div>
      <div className="flex-1 overflow-auto px-5 py-4">
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          <Link href={`/programs/${e.programId}/offerings/${e.cohortId}`} className="rounded-lg border border-slate-300 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50">Offering →</Link>
          <Link href={`/programs/${e.programId}/offerings/${e.cohortId}/design`} className="rounded-lg border border-slate-300 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50">Design &amp; sequence →</Link>
          <button onClick={() => onWho({ kind: "course", id: e.courseId })} className="rounded-lg border border-slate-300 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50">Every date of this course</button>
        </div>
        <div className="space-y-3">
          {e.sections.map((s) => (
            <div key={s.index} className="rounded-xl border border-slate-200 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-sm font-semibold text-slate-800">{s.count > 1 ? `Section ${s.index} of ${s.count}` : "One section"} <span className="font-normal text-slate-500">· {fmt.num(s.students.length || s.seats)} students</span></div>
                {canEdit && s.patternId && <button onClick={() => onEdit(s.index, s.patternId!)} className="text-xs text-rose-700 hover:underline">edit the weekly pattern</button>}
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div><dt className="text-slate-400">{e.kind === "CLINICAL" ? "Clinical site" : "Room"}</dt><dd className="font-medium text-slate-800">{e.kind === "CLINICAL" ? (s.siteId ? <button onClick={() => onWho({ kind: "site", id: s.siteId! })} className="hover:text-rose-700 hover:underline">{s.site}</button> : <span className="text-amber-700">site TBD</span>) : e.online ? "online" : s.roomId ? <button onClick={() => onWho({ kind: "room", id: s.roomId! })} className="hover:text-rose-700 hover:underline">{s.room}</button> : <span className="text-amber-700">no room</span>}{e.kind === "CLINICAL" && s.siteId && !s.booked && <span className="ml-1 text-slate-400">(weekly site; not booked on an asset)</span>}</dd></div>
                <div><dt className="text-slate-400">{e.kind === "CLINICAL" ? "Preceptors / instructor" : "Instructor"}</dt><dd className="font-medium text-slate-800">{s.staff.length ? s.staff.map((p, i) => <span key={p.id}>{i > 0 ? ", " : ""}<button onClick={() => onWho({ kind: "person", id: p.id })} className="hover:text-rose-700 hover:underline">{p.name}</button><span className="text-slate-400"> ({p.role})</span></span>) : <span className="text-amber-700">{e.online ? "—" : "nobody named"}</span>}</dd></div>
                {s.moved && <div className="col-span-2"><dt className="text-slate-400">Moved by hand</dt><dd className="text-slate-700">from {shortDate(s.moved.fromIso)}{s.moved.startTime ? `, now at ${fmtTime(s.moved.startTime)}` : ""}</dd></div>}
              </dl>
              {s.students.length > 0 && (
                <div className="mt-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Students</div>
                  <div className="mt-1 flex flex-wrap gap-1">{s.students.map((st) => <button key={st.id} onClick={() => onWho({ kind: "student", id: st.id })} className={`rounded px-1.5 py-0.5 text-[11px] hover:ring-1 hover:ring-rose-300 ${st.status === "completed" ? "bg-emerald-100 text-emerald-800" : st.status === "absent" || st.status === "withdrawn" ? "bg-rose-100 text-rose-800" : "bg-slate-100 text-slate-700"}`} title={st.status ?? ""}>{st.name}</button>)}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── The weekly pattern behind a section (operational module only) ───────────────────────────────
function PatternEditor({ event: e, sectionIndex, patternId, rooms, people, employers, onClose, onSaved }: { event: CalEvent; sectionIndex: number; patternId: string; rooms: CalendarData["rooms"]; people: CalendarData["people"]; employers: CalendarData["employers"]; onClose: () => void; onSaved: () => void }) {
  const s = e.sections.find((x) => x.index === sectionIndex)!;
  const [day, setDay] = useState(e.dayOfWeek);
  const [time, setTime] = useState(e.startTime ?? "08:00");
  const [room, setRoom] = useState(s.roomId ?? "");
  const [site, setSite] = useState(s.siteId ?? "");
  const [staff, setStaff] = useState(s.staff[0]?.id ?? "");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const offCampus = e.kind === "CLINICAL";
  const staffPool = offCampus ? people.filter((p) => p.role === "preceptor" && (!site || !p.employerId || p.employerId === site)) : people.filter((p) => p.role !== "preceptor");
  const eligible = rooms.filter((r) => (e.kind === "LAB" ? r.kind === "LAB" || r.kind === "SIM" : r.kind === "CLASSROOM" || r.kind === "OTHER"));
  const inp = "w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm";
  const lbl = "mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-xl" onClick={(x) => x.stopPropagation()}>
        <h3 className="text-base font-semibold text-slate-800">{e.courseCode ?? e.courseName} · {KIND_LABEL[e.kind]}{s.count > 1 ? ` · section ${s.index}` : ""}</h3>
        <p className="text-xs text-slate-500">The weekly pattern every week of the term follows. Changing it moves every date of this section, not only {shortDate(e.date)}.</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="block"><span className={lbl}>Day</span><select value={day} onChange={(x) => setDay(x.target.value)} className={inp}>{DOW_SHORT.map((d) => <option key={d} value={d}>{d}</option>)}</select></label>
          <label className="block"><span className={lbl}>Start time</span><input type="time" value={time} onChange={(x) => setTime(x.target.value)} className={inp} /></label>
          {offCampus ? (
            <label className="col-span-2 block"><span className={lbl}>Clinical site</span><select value={site} onChange={(x) => setSite(x.target.value)} className={inp}><option value="">— site TBD —</option>{employers.map((em) => <option key={em.id} value={em.id}>{em.name}{em.setting ? ` (${em.setting})` : ""}</option>)}</select></label>
          ) : (
            <label className="col-span-2 block"><span className={lbl}>Room</span><select value={room} onChange={(x) => setRoom(x.target.value)} className={inp}><option value="">— unroomed —</option>{eligible.map((rm) => <option key={rm.id} value={rm.id}>{rm.name} (cap {rm.capacity ?? "—"})</option>)}</select></label>
          )}
          <label className="col-span-2 block"><span className={lbl}>{offCampus ? "Preceptor" : "Instructor"}</span><select value={staff} onChange={(x) => setStaff(x.target.value)} className={inp}><option value="">— unstaffed —</option>{staffPool.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        </div>
        {err && <p className="mt-2 text-xs text-rose-700">{err}</p>}
        <div className="mt-4 flex items-center gap-2">
          <button disabled={pending} onClick={() => start(async () => { setErr(null); try { await moveMeeting(patternId, { dayOfWeek: day, startTime: time, facilityId: offCampus ? undefined : (room || null), employerId: offCampus ? (site || null) : undefined, staffPersonId: staff || null }); onSaved(); } catch (x) { setErr(x instanceof Error ? x.message : String(x)); } })} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50">{pending ? "Saving…" : "Save"}</button>
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">Cancel</button>
        </div>
      </div>
    </div>
  );
}
