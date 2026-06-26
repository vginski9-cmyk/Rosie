"use client";

import { useState } from "react";
import { createNorthStarGoal } from "@/lib/actions";

// "+ New North Star goal" — creates a program family anchored to a target job.
export function NewGoalForm({ institutions }: { institutions: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="rounded-lg bg-rose-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-rose-700">+ New North Star goal</button>
    );
  }
  return (
    <form action={createNorthStarGoal} className="flex flex-wrap items-end gap-2 rounded-xl border border-rose-200 bg-rose-50/40 p-3">
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Institution</span>
        <select name="institutionId" required defaultValue={institutions[0]?.id} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
          {institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Target job</span>
        <input name="name" required placeholder="e.g. Radiologic Technologists" className="w-56 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
      </label>
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">SOC code (optional)</span>
        <input name="socCode" placeholder="29-2034" className="w-28 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
      </label>
      <button className="rounded-lg bg-rose-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-rose-700">Create goal</button>
      <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-500 hover:bg-white">Cancel</button>
    </form>
  );
}
