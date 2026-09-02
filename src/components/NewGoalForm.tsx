"use client";

import { useState } from "react";
import { createNorthStarGoal } from "@/lib/actions";

// "+ New North Star goal" — creates a program family anchored to a target job.
export function NewGoalForm({ institutions }: { institutions: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [newInst, setNewInst] = useState(institutions.length === 0);
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="rounded-lg bg-rose-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-rose-700">+ New North Star goal</button>
    );
  }
  return (
    <form action={createNorthStarGoal} className="flex flex-wrap items-end gap-2 rounded-xl border border-rose-200 bg-rose-50/40 p-3">
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Institution</span>
        {newInst ? (
          <span className="flex items-center gap-1.5">
            <input name="newInstitutionName" required placeholder="New institution name" className="w-56 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
            {institutions.length > 0 && <button type="button" onClick={() => setNewInst(false)} className="text-[11px] text-slate-500 hover:text-rose-600">pick existing</button>}
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <select name="institutionId" defaultValue={institutions[0]?.id} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
              {institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
            <button type="button" onClick={() => setNewInst(true)} className="whitespace-nowrap text-[11px] font-medium text-rose-700 hover:underline">+ new institution</button>
          </span>
        )}
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
