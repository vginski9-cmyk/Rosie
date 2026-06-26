"use client";

import { useMemo, useState } from "react";
import { roundUpInt } from "@/lib/service";
import { detectSectionConflicts, formatTime12, type SectionSlot } from "@/lib/schedule";
import { saveSectionSchedules } from "@/lib/actions";

type Kind = "CLASS" | "LAB" | "CLINICAL";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_FULL: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
const KIND_STYLE: Record<Kind, { chip: string; ring: string }> = {
  CLASS: { chip: "bg-sky-100 text-sky-800", ring: "ring-sky-200" },
  LAB: { chip: "bg-violet-100 text-violet-800", ring: "ring-violet-200" },
  CLINICAL: { chip: "bg-rose-100 text-rose-800", ring: "ring-rose-200" },
};

export interface SchedSession {
  id: string; kind: Kind; number: number; title: string | null;
  lengthHours: number; maxStudents: number; dayOfWeek: string | null; startTime: string | null; location: string | null;
}
export interface SchedCourse { id: string; code: string | null; name: string; sessions: SchedSession[] }
export interface SchedTerm { id: string; name: string; index: number; courses: SchedCourse[] }

interface Slot { day: string | null; time: string | null; location: string | null; facilityId: string | null }
interface SectionRow {
  key: string; sessionId: string; sectionIndex: number; sections: number;
  courseCode: string; title: string; kind: Kind; lengthHours: number;
}
export interface SchedFacility { id: string; name: string; kind: string; capacity: number | null }

export function OfferingScheduler({
  cohortId, programId, offeringName, enrollment, terms, overrides, facilities = [],
}: {
  cohortId: string; programId: string; offeringName: string; enrollment: number; terms: SchedTerm[];
  overrides: Record<string, { dayOfWeek: string | null; startTime: string | null; location: string | null; facilityId: string | null }>;
  facilities?: SchedFacility[];
}) {
  const facById = useMemo(() => new Map(facilities.map((f) => [f.id, f])), [facilities]);
  const [termId, setTermId] = useState(terms[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // All section rows across all terms (so edits persist when switching terms).
  const allRows = useMemo<{ rows: SectionRow[]; termOf: Record<string, string>; defaults: Record<string, Slot> }>(() => {
    const rows: SectionRow[] = [];
    const termOf: Record<string, string> = {};
    const defaults: Record<string, Slot> = {};
    for (const t of terms) for (const c of t.courses) for (const s of c.sessions) {
      const sections = s.maxStudents > 0 && enrollment > 0 ? roundUpInt(enrollment / s.maxStudents) : 1;
      for (let i = 1; i <= sections; i++) {
        const key = `${s.id}#${i}`;
        rows.push({ key, sessionId: s.id, sectionIndex: i, sections, courseCode: c.code ?? c.name, title: s.title ?? `${c.code} ${s.kind.toLowerCase()}`, kind: s.kind, lengthHours: s.lengthHours });
        termOf[key] = t.id;
        defaults[key] = { day: s.dayOfWeek, time: s.startTime, location: s.location, facilityId: null };
      }
    }
    return { rows, termOf, defaults };
  }, [terms, enrollment]);

  const [slots, setSlots] = useState<Record<string, Slot>>(() => {
    const init: Record<string, Slot> = {};
    for (const r of allRows.rows) {
      const o = overrides[r.key];
      init[r.key] = o ? { day: o.dayOfWeek, time: o.startTime, location: o.location, facilityId: o.facilityId } : { ...allRows.defaults[r.key] };
    }
    return init;
  });

  const setSlot = (key: string, patch: Partial<Slot>) => { setSlots((p) => ({ ...p, [key]: { ...p[key], ...patch } })); setDirty(true); };

  // Rows for the selected term + conflict detection on them.
  const termRows = allRows.rows.filter((r) => allRows.termOf[r.key] === termId);
  const conflicts = useMemo(() => {
    const sl: SectionSlot[] = termRows.map((r) => ({ key: r.key, day: slots[r.key]?.day ?? null, startTime: slots[r.key]?.time ?? null, lengthHours: r.lengthHours, location: slots[r.key]?.location ?? null }));
    return detectSectionConflicts(sl);
  }, [termRows, slots]);

  const daysUsed = useMemo(() => {
    const base = ["Mon", "Tue", "Wed", "Thu", "Fri"];
    const extra = DAYS.filter((d) => !base.includes(d) && termRows.some((r) => slots[r.key]?.day === d));
    return [...base, ...extra];
  }, [termRows, slots]);
  const unscheduled = termRows.filter((r) => !slots[r.key]?.day || !slots[r.key]?.time);

  function autoStagger() {
    setSlots((prev) => {
      const next = { ...prev };
      // Spread each session's sections back-to-back from its base slot, wrapping
      // to the next weekday when a day fills past 20:00 — one room, sequential.
      const bySession = new Map<string, SectionRow[]>();
      for (const r of termRows) { if (!bySession.has(r.sessionId)) bySession.set(r.sessionId, []); bySession.get(r.sessionId)!.push(r); }
      for (const [, list] of bySession) {
        list.sort((a, b) => a.sectionIndex - b.sectionIndex);
        const base = next[list[0].key] ?? {};
        const baseDay = base.day ?? "Mon";
        const baseTime = base.time ?? "09:00";
        const [bh, bm] = baseTime.split(":").map(Number);
        let dayIdx = DAYS.indexOf(baseDay); if (dayIdx < 0) dayIdx = 0;
        let mins = bh * 60 + bm;
        for (const r of list) {
          if (mins + r.lengthHours * 60 > 20 * 60) { dayIdx = (dayIdx + 1) % 5; mins = bh * 60 + bm; }
          const hh = Math.floor(mins / 60), mm = mins % 60;
          next[r.key] = { day: DAYS[dayIdx], time: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`, location: next[r.key]?.location ?? base.location ?? null, facilityId: next[r.key]?.facilityId ?? base.facilityId ?? null };
          mins += r.lengthHours * 60;
        }
      }
      return next;
    });
    setDirty(true);
  }

  function resetTerm() {
    setSlots((prev) => { const next = { ...prev }; for (const r of termRows) next[r.key] = { ...allRows.defaults[r.key] }; return next; });
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      const items = allRows.rows.map((r) => ({ sessionId: r.sessionId, sectionIndex: r.sectionIndex, dayOfWeek: slots[r.key]?.day ?? null, startTime: slots[r.key]?.time ?? null, location: slots[r.key]?.location ?? null, facilityId: slots[r.key]?.facilityId ?? null }));
      await saveSectionSchedules(cohortId, programId, items);
      setDirty(false);
      setSavedAt(new Date().toLocaleTimeString());
    } finally { setSaving(false); }
  }

  const endTime = (time: string | null, len: number) => {
    if (!time) return "";
    const [h, m] = time.split(":").map(Number);
    const total = h * 60 + m + len * 60;
    return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  };

  return (
    <div className="space-y-5">
      {/* Controls + conflict summary */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm"><span className="mr-2 text-slate-400">Term</span>
            <select value={termId} onChange={(e) => setTermId(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
              {terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <span className="text-xs text-slate-500">{enrollment} students → {termRows.length} sections this term</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {conflicts.clashing.size > 0
            ? <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700">⚠ {conflicts.pairs.length} room clash{conflicts.pairs.length === 1 ? "" : "es"}</span>
            : <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">✓ no room clashes</span>}
          <button onClick={autoStagger} className="btn-ghost text-xs">Auto-stagger</button>
          <button onClick={resetTerm} className="btn-ghost text-xs">Reset term</button>
          <button onClick={save} disabled={!dirty || saving} className="btn-primary text-xs disabled:opacity-40">{saving ? "Saving…" : "Save schedule"}</button>
          {!dirty && savedAt && <span className="text-[11px] text-emerald-600">saved {savedAt}</span>}
          {dirty && <span className="text-[11px] text-amber-600">unsaved</span>}
        </div>
      </div>

      {/* Peak concurrency per day — rooms & faculty needed at once */}
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="text-slate-400">Peak simultaneous sections (rooms/faculty needed at once):</span>
        {daysUsed.map((d) => (
          <span key={d} className="rounded bg-slate-100 px-2 py-0.5 tabular-nums text-slate-600">{d} <strong>{conflicts.peakConcurrencyByDay[d] ?? 0}</strong></span>
        ))}
      </div>

      {/* Weekly grid — all courses' sections side by side */}
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${daysUsed.length}, minmax(150px, 1fr))` }}>
        {daysUsed.map((day) => {
          const dayRows = termRows
            .filter((r) => slots[r.key]?.day === day && slots[r.key]?.time)
            .sort((a, b) => (slots[a.key]!.time! < slots[b.key]!.time! ? -1 : 1));
          return (
            <div key={day} className="rounded-xl border border-slate-200 bg-slate-50/40">
              <div className="border-b border-slate-200 px-2 py-1.5 text-center text-xs font-semibold text-slate-600">{DAY_FULL[day]}</div>
              <div className="space-y-1.5 p-1.5">
                {dayRows.map((r) => {
                  const sl = slots[r.key]!;
                  const clash = conflicts.clashing.has(r.key);
                  return (
                    <div key={r.key} className={`rounded-lg border bg-white p-1.5 text-[11px] ring-1 ${clash ? "border-rose-300 ring-rose-200" : `border-slate-200 ${KIND_STYLE[r.kind].ring}`}`}>
                      <div className="flex items-center gap-1">
                        <span className={`rounded px-1 text-[9px] font-semibold uppercase ${KIND_STYLE[r.kind].chip}`}>{r.kind[0]}</span>
                        <span className="font-mono text-slate-500">{r.courseCode}</span>
                        {r.sections > 1 && <span className="text-slate-400">§{r.sectionIndex}/{r.sections}</span>}
                      </div>
                      <div className="truncate font-medium text-slate-700">{r.title}</div>
                      <div className="text-[10px] text-slate-500">{formatTime12(sl.time)}–{formatTime12(endTime(sl.time, r.lengthHours))}</div>
                      {clash && <div className="text-[10px] font-medium text-rose-600">room clash</div>}
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <select value={sl.day ?? ""} onChange={(e) => setSlot(r.key, { day: e.target.value })} className="rounded border border-slate-300 px-0.5 text-[10px]">
                          {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
                        </select>
                        <input type="time" value={sl.time ?? ""} onChange={(e) => setSlot(r.key, { time: e.target.value })} className="w-[88px] rounded border border-slate-300 px-0.5 text-[10px]" />
                        {facilities.length > 0 ? (
                          <select
                            value={sl.facilityId ?? ""}
                            onChange={(e) => { const f = facById.get(e.target.value); setSlot(r.key, { facilityId: e.target.value || null, location: f ? f.name : sl.location }); }}
                            className="w-full rounded border border-slate-300 px-0.5 text-[10px]"
                          >
                            <option value="">{sl.location || "room…"}</option>
                            {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}{f.capacity != null ? ` (${f.capacity})` : ""}</option>)}
                          </select>
                        ) : (
                          <input value={sl.location ?? ""} onChange={(e) => setSlot(r.key, { location: e.target.value })} placeholder="room" className="w-full rounded border border-slate-300 px-0.5 text-[10px]" />
                        )}
                      </div>
                      {sl.facilityId && facById.get(sl.facilityId)?.capacity != null && r.kind !== "CLINICAL" && (
                        (() => { const cap = facById.get(sl.facilityId!)!.capacity!; const over = enrollment > 0 && r.sections > 0 ? Math.ceil(enrollment / r.sections) : 0; return over > cap ? <div className="text-[9px] font-medium text-amber-600">section ~{over} &gt; room cap {cap}</div> : null; })()
                      )}
                    </div>
                  );
                })}
                {dayRows.length === 0 && <div className="py-3 text-center text-[10px] text-slate-300">—</div>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Unscheduled */}
      {unscheduled.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-700">Unscheduled sections ({unscheduled.length}) — give them a day &amp; time</div>
          <div className="flex flex-wrap gap-2">
            {unscheduled.map((r) => (
              <div key={r.key} className="flex items-center gap-1 rounded-lg border border-amber-200 bg-white p-1.5 text-[11px]">
                <span className="font-mono text-slate-500">{r.courseCode}</span><span className="truncate max-w-[120px] font-medium text-slate-700">{r.title}</span>
                <select value={slots[r.key]?.day ?? ""} onChange={(e) => setSlot(r.key, { day: e.target.value })} className="rounded border border-slate-300 px-0.5 text-[10px]"><option value="">day</option>{DAYS.map((d) => <option key={d} value={d}>{d}</option>)}</select>
                <input type="time" value={slots[r.key]?.time ?? ""} onChange={(e) => setSlot(r.key, { time: e.target.value })} className="w-[88px] rounded border border-slate-300 px-0.5 text-[10px]" />
              </div>
            ))}
          </div>
        </div>
      )}

      {conflicts.pairs.length > 0 && (
        <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-3 text-[12px] text-rose-800">
          <div className="font-semibold">Room double-bookings to resolve:</div>
          <ul className="mt-1 space-y-0.5">
            {conflicts.pairs.map((p, i) => {
              const a = termRows.find((r) => r.key === p.a), b = termRows.find((r) => r.key === p.b);
              return <li key={i}>{DAY_FULL[p.day]} · <strong>{p.location}</strong>: {a?.courseCode} {a?.title} ↔ {b?.courseCode} {b?.title}</li>;
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
