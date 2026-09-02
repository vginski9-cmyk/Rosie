"use client";

import { useEffect, useState } from "react";
import { type SessionInput, type WorkloadAssumptions, computeColumns } from "@/lib/capacitymodel";
import { defaultSession, KIND_LABELS, type EditableField, type SessionKindKey } from "@/lib/sessionfields";
import { SessionFieldGrid, HiddenSessionFields, harvestOptions, type FieldRow } from "@/components/SessionFields";
import { updateSession, deleteSession, addSession, setSessionTiming } from "@/lib/actions";

// The Raw Data & Calculations session table, one course at a time — every
// workbook column (A–AE) with its full header, one session per row. Click a
// row to open every field; edits recalculate the formulas instantly; Save row
// commits to the template and every offering, calendar and insight reads it.

export interface SheetSession extends SessionInput {
  startTime: string | null;
}

const num = (v: number | null, dp = 2) => (v == null ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: dp }));
const KIND_BADGE: Record<string, string> = { CLASS: "bg-sky-100 text-sky-700", LAB: "bg-violet-100 text-violet-700", CLINICAL: "bg-rose-100 text-rose-700" };
const fmtT = (t: string | null) => { if (!t) return "—"; const [h, m] = t.split(":").map(Number); const ap = h >= 12 ? "p" : "a"; const hh = h % 12 || 12; return m ? `${hh}:${String(m).padStart(2, "0")}${ap}` : `${hh}${ap}`; };
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function SessionSheet({
  programId, courseId, courseCode, courseTitle, termNumber, semester, sessions, enrollment, assumptions, allSessions = [],
}: {
  programId: string;
  courseId: string;
  courseCode: string | null;
  courseTitle: string;
  termNumber: number;
  semester: string;
  sessions: SheetSession[];
  enrollment: number;
  assumptions: WorkloadAssumptions;
  /** Every session in the program — their values become drop-down choices. */
  allSessions?: Partial<FieldRow>[];
}) {
  // Local editable copy so the formula columns recalculate as you type.
  const [rows, setRows] = useState<SheetSession[]>(sessions);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState<FieldRow>(() => defaultSession("CLASS"));
  useEffect(() => { setRows(sessions); setDirty(new Set()); }, [sessions]);

  const setField = (id: string, field: EditableField, value: unknown) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
    setDirty((d) => new Set(d).add(id));
  };
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const ordered = [...rows].sort((a, b) => a.kind.localeCompare(b.kind) || a.number - b.number);
  const allOpen = ordered.length > 0 && ordered.every((r) => open.has(r.id));
  const dataOptions = harvestOptions(allSessions);
  const seq = { A: `Term ${termNumber}`, B: semester, D: courseCode ?? "—", E: courseTitle };

  return (
    <div className="mt-3">
      <div className="mb-1.5 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
        <span className="font-semibold uppercase tracking-wide text-slate-400">Session table — every workbook column</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-blue-300 bg-blue-50" /> editable input (drop-downs take new options)</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-emerald-300 bg-emerald-50" /> live formula</span>
        <span className="ml-auto" />
        <button type="button" onClick={() => setOpen(allOpen ? new Set() : new Set(ordered.map((r) => r.id)))} className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-200">{allOpen ? "Collapse all" : "Open every row"}</button>
      </div>

      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {ordered.map((r) => {
          const comp = computeColumns(r, enrollment, assumptions);
          const isDirty = dirty.has(r.id);
          const isOpen = open.has(r.id);
          return (
            <div key={r.id} className={isDirty ? "bg-rose-50/30" : ""}>
              <button type="button" onClick={() => toggle(r.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-xs hover:bg-slate-50">
                <span className="w-4 text-slate-400">{isOpen ? "▾" : "▸"}</span>
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${KIND_BADGE[r.kind]}`}>{KIND_LABELS[r.kind]} #{r.number}</span>
                <span className="min-w-0 flex-1 truncate text-slate-800">{r.title ?? <span className="text-slate-300">untitled</span>}</span>
                <span className="tabular-nums text-slate-500">{r.week != null ? `wk ${r.week}` : "no week"}{r.dayOfWeek ? ` · ${r.dayOfWeek}` : ""}{r.startTime ? ` · ${fmtT(r.startTime)}` : ""}</span>
                <span className="tabular-nums text-slate-500">{r.lengthHours}h · max {r.maxStudents}{r.deliveryMode ? ` · ${r.deliveryMode}` : ""}{r.location ? ` · ${r.location}` : ""}{r.kind === "CLINICAL" && r.rotationType ? ` · ${r.rotationType}` : ""}</span>
                <span className="tabular-nums text-emerald-800">{comp.divByZero ? "#DIV/0!" : `${num(comp.Y, 0)} sections`} · {num(comp.Z, 1)} faculty h{r.kind === "CLINICAL" ? ` · ${num(comp.AC, 0)} preceptor h` : ""}</span>
                {isDirty && <span className="rounded-full bg-rose-600 px-1.5 py-0.5 text-[9px] font-semibold text-white">unsaved</span>}
              </button>
              {isOpen && (
                <div className="border-t border-slate-100 px-3 py-3">
                  <SessionFieldGrid
                    row={r as unknown as FieldRow} seq={{ ...seq, G: String(r.number) }} enrollment={enrollment} assumptions={assumptions}
                    onChange={(f, v) => setField(r.id, f, v)} dataOptions={dataOptions}
                    after={(
                      <label className="block">
                        <span className="block text-[10px] font-semibold leading-tight text-slate-500"><span className="mr-1 rounded bg-slate-100 px-1 font-mono text-[9px] text-amber-700">booking</span>Start time (when calendarized, the weekly booking carries it)</span>
                        <input type="time" value={r.startTime ?? ""} onChange={(e) => setField(r.id, "startTime", e.target.value || null)} className="w-full rounded border border-blue-200 bg-blue-50/70 px-1.5 py-1 text-xs text-blue-900" />
                      </label>
                    )}
                  />
                  <div className="mt-3 flex items-center gap-3">
                    <form action={updateSession.bind(null, r.id, programId)}>
                      <HiddenSessionFields row={r as unknown as FieldRow} />
                      <button className={`rounded-lg px-3 py-1.5 text-xs font-medium ${isDirty ? "bg-rose-600 text-white hover:bg-rose-700" : "bg-slate-100 text-slate-400"}`}>Save row to the template</button>
                    </form>
                    <form action={deleteSession.bind(null, r.id, programId)}>
                      <button className="text-xs text-slate-400 hover:text-rose-600" onClick={(e) => { if (!confirm(`Delete ${KIND_LABELS[r.kind]} #${r.number}${r.title ? ` — ${r.title}` : ""}?`)) e.preventDefault(); }}>Delete session</button>
                    </form>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {ordered.length === 0 && <div className="px-3 py-3 text-xs text-slate-400">No sessions yet — add one below.</div>}
      </div>

      {/* Add a session — the full row, every field */}
      <div className="mt-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 p-3">
        {!showAdd ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-slate-700">Add a session:</span>
            {(["CLASS", "LAB", "CLINICAL"] as SessionKindKey[]).map((k) => (
              <button key={k} type="button" onClick={() => { setDraft(defaultSession(k)); setShowAdd(true); }} className={`rounded-full px-2.5 py-1 font-medium ${KIND_BADGE[k]} hover:ring-2 hover:ring-rose-300`}>+ {KIND_LABELS[k]}</button>
            ))}
            <span className="text-slate-400">— opens every field with sensible defaults for that type</span>
          </div>
        ) : (
          <form action={async (fd) => { await addSession(courseId, programId, fd); setShowAdd(false); }}>
            <div className="mb-2 text-xs font-semibold text-slate-700">New {KIND_LABELS[draft.kind as SessionKindKey]} session — every field, then Add</div>
            <SessionFieldGrid
              row={draft} seq={{ ...seq, G: String((rows.filter((r) => r.kind === draft.kind).reduce((m, r) => Math.max(m, r.number), 0)) + 1) }}
              enrollment={enrollment} assumptions={assumptions} onChange={(f, v) => setDraft((d) => ({ ...d, [f]: v }))} dataOptions={dataOptions}
              after={(
                <label className="block">
                  <span className="block text-[10px] font-semibold leading-tight text-slate-500"><span className="mr-1 rounded bg-slate-100 px-1 font-mono text-[9px] text-amber-700">booking</span>Start time</span>
                  <input type="time" value={(draft.startTime as string | null) ?? ""} onChange={(e) => setDraft((d) => ({ ...d, startTime: e.target.value || null }))} className="w-full rounded border border-blue-200 bg-blue-50/70 px-1.5 py-1 text-xs text-blue-900" />
                </label>
              )}
            />
            <HiddenSessionFields row={draft} />
            <div className="mt-3 flex items-center gap-3">
              <button className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700">+ Add this session</button>
              <button type="button" onClick={() => setShowAdd(false)} className="text-xs text-slate-500">cancel</button>
            </div>
          </form>
        )}
      </div>

      {/* Bulk timing for a whole kind — full words */}
      <details className="mt-2 text-[11px] text-slate-500">
        <summary className="cursor-pointer font-medium text-slate-600">Apply the same day, start time, location, length and capacity to every session of one type</summary>
        <form action={setSessionTiming.bind(null, courseId, programId)} className="mt-2 flex flex-wrap items-end gap-2">
          <label className="block"><span className="block text-[10px] uppercase tracking-wide text-slate-400">Session type</span><select name="kind" className="rounded border border-slate-300 px-2 py-1 text-xs"><option value="CLASS">Class</option><option value="LAB">Lab</option><option value="CLINICAL">Clinical</option></select></label>
          <label className="block"><span className="block text-[10px] uppercase tracking-wide text-slate-400">This session occurs on</span><select name="dayOfWeek" className="rounded border border-slate-300 px-2 py-1 text-xs"><option value="">(leave as is)</option>{DAYS.map((d) => <option key={d} value={d}>{d}</option>)}</select></label>
          <label className="block"><span className="block text-[10px] uppercase tracking-wide text-slate-400">Start time</span><input name="startTime" type="time" className="rounded border border-slate-300 px-2 py-1 text-xs" /></label>
          <label className="block"><span className="block text-[10px] uppercase tracking-wide text-slate-400">Session length (in hours)</span><input name="lengthHours" type="number" step="0.25" className="w-24 rounded border border-slate-300 px-2 py-1 text-xs" /></label>
          <label className="block"><span className="block text-[10px] uppercase tracking-wide text-slate-400">Max number of students per session</span><input name="maxStudents" type="number" className="w-24 rounded border border-slate-300 px-2 py-1 text-xs" /></label>
          <label className="block"><span className="block text-[10px] uppercase tracking-wide text-slate-400">Session location</span><input name="location" className="w-40 rounded border border-slate-300 px-2 py-1 text-xs" /></label>
          <button className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700">Apply to all of that type</button>
        </form>
      </details>
    </div>
  );
}
