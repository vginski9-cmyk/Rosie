"use client";

// A big, unmistakable drop-down section: one clear button per section of the
// page — title, what it holds, a live summary — that opens to the full content.

import { useState, type ReactNode } from "react";

export function Collapse({ title, sub, summary, defaultOpen = false, children }: {
  title: string;
  sub?: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-rose-50/40">
        <span className="min-w-0">
          <span className="block text-lg font-semibold text-slate-900">{title}</span>
          {sub && <span className="mt-0.5 block text-sm text-slate-500">{sub}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-3">
          {summary && <span className="hidden max-w-md text-right text-sm font-medium text-slate-600 sm:block">{summary}</span>}
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-base text-white transition-transform ${open ? "rotate-180 bg-slate-700" : "bg-rose-600"}`}>▾</span>
        </span>
      </button>
      {open && <div className="border-t border-slate-100 p-5">{children}</div>}
    </section>
  );
}
