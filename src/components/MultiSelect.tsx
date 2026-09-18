"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// A drop-down multi-select: a button that reads "12 of 67 cohorts", opening a panel with a
// search box, All / None, and a checkbox per option (grouped when the options say so).
export interface MultiOption { value: string; label: string; group?: string; hint?: string }

export function MultiSelect({ label, noun, options, selected, onChange, className = "" }: { label: string; noun: string; options: MultiOption[]; selected: Set<string>; onChange: (next: Set<string>) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const shown = useMemo(() => { const s = q.trim().toLowerCase(); return s ? options.filter((o) => `${o.label} ${o.group ?? ""} ${o.hint ?? ""}`.toLowerCase().includes(s)) : options; }, [options, q]);
  const groups = useMemo(() => { const m = new Map<string, MultiOption[]>(); for (const o of shown) { const g = o.group ?? ""; m.set(g, [...(m.get(g) ?? []), o]); } return [...m.entries()]; }, [shown]);
  const set = (vals: string[], on: boolean) => { const n = new Set(selected); for (const v of vals) on ? n.add(v) : n.delete(v); onChange(n); };
  const all = options.length > 0 && selected.size === options.length;
  return (
    <div ref={ref} className={`relative ${className}`}>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <button type="button" onClick={() => setOpen((o) => !o)} className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm ${open ? "border-rose-400 bg-white" : "border-slate-300 bg-white hover:border-slate-400"}`}>
        <span className="font-medium text-slate-800">{all ? `All ${options.length} ${noun}` : selected.size === 0 ? `No ${noun}` : `${selected.size} of ${options.length} ${noun}`}</span>
        <span className="text-slate-400">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-[min(36rem,90vw)] rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
          <div className="flex items-center gap-2">
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`search ${noun}…`} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1 text-sm" />
            <button type="button" onClick={() => set(shown.map((o) => o.value), true)} className="rounded-lg px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100">All{q ? " shown" : ""}</button>
            <button type="button" onClick={() => set(shown.map((o) => o.value), false)} className="rounded-lg px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100">None{q ? " shown" : ""}</button>
          </div>
          <div className="mt-2 max-h-80 overflow-y-auto">
            {groups.map(([g, os]) => (
              <div key={g} className="mb-1">
                {g && (
                  <div className="flex items-center justify-between px-1 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    <span>{g}</span>
                    <span className="flex gap-1 normal-case tracking-normal"><button type="button" onClick={() => set(os.map((o) => o.value), true)} className="rounded px-1 text-slate-500 hover:bg-slate-100">all</button><button type="button" onClick={() => set(os.map((o) => o.value), false)} className="rounded px-1 text-slate-500 hover:bg-slate-100">none</button></span>
                  </div>
                )}
                {os.map((o) => (
                  <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-slate-50">
                    <input type="checkbox" checked={selected.has(o.value)} onChange={(e) => set([o.value], e.target.checked)} className="accent-rose-600" />
                    <span className="min-w-0 truncate text-slate-800">{o.label}</span>
                    {o.hint && <span className="ml-auto shrink-0 text-[11px] text-slate-400">{o.hint}</span>}
                  </label>
                ))}
              </div>
            ))}
            {shown.length === 0 && <div className="px-2 py-3 text-sm text-slate-400">Nothing matches.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
