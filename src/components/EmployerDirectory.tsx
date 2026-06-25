"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createEmployer } from "@/lib/actions";

export interface DirEmployer {
  id: string;
  name: string;
  setting: string | null;
  city: string | null;
  wblSlots: number | null;
  status: string;
  contactName: string | null;
  institution: { id: string; name: string };
  _count: { people: number };
  placements: { status: string }[];
}
export interface InstLite { id: string; name: string }

const STATUSES = ["prospect", "active", "paused", "archived"];
const STATUS_BADGE: Record<string, string> = {
  prospect: "bg-sky-100 text-sky-700", active: "bg-emerald-100 text-emerald-700",
  paused: "bg-amber-100 text-amber-700", archived: "bg-slate-100 text-slate-400",
};
const activeCount = (e: DirEmployer) => e.placements.filter((p) => p.status === "planned" || p.status === "active").length;

export function EmployerDirectory({ employers, institutions }: { employers: DirEmployer[]; institutions: InstLite[] }) {
  const [q, setQ] = useState("");
  const [fInst, setFInst] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return employers.filter((e) => {
      if (fInst && e.institution.id !== fInst) return false;
      if (fStatus && e.status !== fStatus) return false;
      if (needle && !(e.name.toLowerCase().includes(needle) || (e.city ?? "").toLowerCase().includes(needle) || (e.setting ?? "").toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [employers, q, fInst, fStatus]);

  const totals = filtered.reduce((acc, e) => ({ slots: acc.slots + (e.wblSlots ?? 0), used: acc.used + activeCount(e) }), { slots: 0, used: 0 });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Search</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="name, city, setting…" className="w-56 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Institution</span>
          <select value={fInst} onChange={(e) => setFInst(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            <option value="">All</option>
            {institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Status</span>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            <option value="">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        {(q || fInst || fStatus) && <button onClick={() => { setQ(""); setFInst(""); setFStatus(""); }} className="pb-1.5 text-xs text-slate-400 hover:text-rose-600">clear</button>}
        <button onClick={() => setShowAdd((v) => !v)} className="ml-auto rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700">{showAdd ? "Close" : "+ Add partner"}</button>
      </div>

      {showAdd && <AddForm institutions={institutions} onDone={() => setShowAdd(false)} />}

      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span><span className="font-medium text-slate-700">{filtered.length}</span> partners</span>
        <span>· capacity <span className="font-medium text-slate-700">{totals.used}</span> / {totals.slots} WBL slots in use</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 text-left font-semibold">Partner</th>
              <th className="px-3 py-2 text-left font-semibold">Setting</th>
              <th className="px-3 py-2 text-left font-semibold">Institution</th>
              <th className="px-3 py-2 text-center font-semibold">WBL slots</th>
              <th className="px-3 py-2 text-center font-semibold">In use</th>
              <th className="px-3 py-2 text-left font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((e) => {
              const used = activeCount(e);
              const full = e.wblSlots != null && used >= e.wblSlots;
              return (
                <tr key={e.id} className="hover:bg-slate-50/60">
                  <td className="px-3 py-2">
                    <Link href={`/employers/${e.id}`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{e.name}</Link>
                    {e.city && <span className="block text-[11px] text-slate-400">{e.city}</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-500">{e.setting ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-500">{e.institution.name}</td>
                  <td className="px-3 py-2 text-center tabular-nums text-slate-600">{e.wblSlots ?? "—"}</td>
                  <td className={`px-3 py-2 text-center tabular-nums ${full ? "font-semibold text-rose-600" : "text-slate-500"}`}>{used}</td>
                  <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE[e.status] ?? "bg-slate-100 text-slate-600"}`}>{e.status}</span></td>
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-400">No partners match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AddForm({ institutions, onDone }: { institutions: InstLite[]; onDone: () => void }) {
  return (
    <form action={async (fd) => { await createEmployer(fd); onDone(); }} className="grid gap-3 rounded-xl border border-rose-200 bg-rose-50/40 p-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Institution</span>
        <select name="institutionId" required defaultValue={institutions[0]?.id} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
          {institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Partner name</span>
        <input name="name" required placeholder="Cape Fear Valley Medical Center" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
      </label>
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Setting</span>
        <input name="setting" placeholder="acute-care hospital" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
      </label>
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">City</span>
        <input name="city" placeholder="Fayetteville" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
      </label>
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">WBL slots</span>
        <input name="wblSlots" type="number" min={0} placeholder="6" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm tabular-nums" />
      </label>
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Status</span>
        <select name="status" defaultValue="prospect" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Contact name</span>
        <input name="contactName" placeholder="Clinical coordinator" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
      </label>
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Contact email</span>
        <input name="contactEmail" type="email" placeholder="coordinator@partner.org" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
      </label>
      <div className="flex items-end gap-2 lg:col-span-4">
        <button className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700">Add partner</button>
        <button type="button" onClick={onDone} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-500 hover:bg-white">Cancel</button>
      </div>
    </form>
  );
}
