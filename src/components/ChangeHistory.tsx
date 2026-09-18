"use client";

// Recent change records (Phase 5): what each bulk action created, changed and removed, which
// blockers it overrode, and an undo for the ones still standing.

import { useState } from "react";
import type { ChangeSetRow } from "@/lib/changesets";
import { fmt } from "@/lib/format";

const KIND_LABEL: Record<ChangeSetRow["kind"], string> = { "scheduler-apply": "Scheduler plan", "auto-assign": "Auto-assign", realign: "Re-align" };
const counts = (o: Record<string, number>) => Object.entries(o).filter(([, v]) => v > 0).map(([k, v]) => `${fmt.num(v)} ${k}`).join(" · ");

export function ChangeHistory({ changes, onUndo, pending, title = "Recent changes" }: { changes: ChangeSetRow[]; onUndo: (id: string) => void; pending?: boolean; title?: string }) {
  const [open, setOpen] = useState(false);
  if (changes.length === 0) return null;
  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white text-xs">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-3 py-2 text-left font-medium text-slate-700 hover:bg-slate-50" aria-expanded={open}>
        <span>{title} <span className="font-normal text-slate-400">— {fmt.num(changes.length)} recorded, newest first; each says what it wrote and can be undone</span></span>
        <span className="text-slate-400">{open ? "hide" : "show"}</span>
      </button>
      {open && (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {changes.map((c) => (
            <li key={c.id} className={`px-3 py-2 ${c.undoneAt ? "text-slate-400" : "text-slate-700"}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{KIND_LABEL[c.kind]}</span> <span className="font-medium">{c.label}</span> <span className="text-slate-400">{fmt.dateTime(new Date(c.createdAt))}</span>{c.undoneAt && <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px]">undone {fmt.dateTime(new Date(c.undoneAt))}</span>}</span>
                {!c.undoneAt && <button type="button" onClick={() => onUndo(c.id)} disabled={pending} className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-0.5 font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50">Undo</button>}
              </div>
              <div className="mt-0.5 grid gap-x-4 gap-y-0.5 sm:grid-cols-3">
                <span><span className="text-emerald-700">Created</span> {counts(c.summary.created) || "—"}</span>
                <span><span className="text-amber-700">Changed</span> {counts(c.summary.changed) || "—"}</span>
                <span><span className="text-rose-700">Removed</span> {counts(c.summary.removed) || "—"}</span>
              </div>
              {c.summary.blockers && c.summary.blockers.length > 0 && <div className="mt-0.5 text-[11px]">Blockers at the time: {c.summary.blockers.map((b) => `${b.label} (${fmt.num(b.shifts)} shifts${b.blocking ? ", blocking" : ""})`).join("; ")}{c.overridden?.length ? <span className="ml-1 rounded-full bg-rose-100 px-2 py-0.5 font-medium text-rose-800">overridden: {c.overridden.join(", ")}</span> : null}</div>}
              {c.summary.notes && c.summary.notes.length > 0 && <div className="mt-0.5 text-[11px] text-slate-500">{c.summary.notes.slice(0, 3).join(" · ")}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
