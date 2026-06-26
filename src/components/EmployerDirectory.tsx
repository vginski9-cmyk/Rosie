"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createEmployer } from "@/lib/actions";

export interface WblPeriod { year: number; season: string; asked: number; secured: number }
export interface DirEmployer {
  id: string;
  name: string;
  setting: string | null;
  city: string | null;
  status: string;
  contactName: string | null;
  institution: { id: string; name: string };
  _count: { people: number };
  wbl: { asked: number; secured: number; periods: WblPeriod[] };
}
export interface InstLite { id: string; name: string }

const STATUSES = ["prospect", "active", "paused", "archived"];
const STATUS_BADGE: Record<string, string> = {
  prospect: "bg-sky-100 text-sky-700", active: "bg-emerald-100 text-emerald-700",
  paused: "bg-amber-100 text-amber-700", archived: "bg-slate-100 text-slate-400",
};
const SEASONS = ["Fall", "Spring", "Summer"];

export function EmployerDirectory({ employers, institutions }: { employers: DirEmployer[]; institutions: InstLite[] }) {
  const [q, setQ] = useState("");
  const [fInst, setFInst] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fYear, setFYear] = useState("");
  const [fSeason, setFSeason] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const years = useMemo(() => {
    const s = new Set<number>();
    for (const e of employers) for (const p of e.wbl.periods) s.add(p.year);
    return [...s].sort((a, b) => b - a);
  }, [employers]);

  const periodActive = fYear !== "" || fSeason !== "";
  // Asked / secured for an employer scoped to the selected period (or all-time).
  const scoped = (e: DirEmployer): { asked: number; secured: number } => {
    if (!periodActive) return { asked: e.wbl.asked, secured: e.wbl.secured };
    let asked = 0, secured = 0;
    for (const p of e.wbl.periods) {
      if (fYear && String(p.year) !== fYear) continue;
      if (fSeason && p.season !== fSeason) continue;
      asked += p.asked; secured += p.secured;
    }
    return { asked, secured };
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return employers.filter((e) => {
      if (fInst && e.institution.id !== fInst) return false;
      if (fStatus && e.status !== fStatus) return false;
      if (needle && !(e.name.toLowerCase().includes(needle) || (e.city ?? "").toLowerCase().includes(needle) || (e.setting ?? "").toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [employers, q, fInst, fStatus]);

  const totals = filtered.reduce((acc, e) => { const s = scoped(e); return { asked: acc.asked + s.asked, secured: acc.secured + s.secured }; }, { asked: 0, secured: 0 });
  const fillRate = totals.asked > 0 ? Math.round((totals.secured / totals.asked) * 100) : 0;
  const periodLabel = periodActive ? `${fSeason || "all"} ${fYear || "years"}`.trim() : "all-time";
  const anyFilter = q || fInst || fStatus || periodActive;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Search</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="name, city, setting…" className="w-52 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
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
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Year</span>
          <select value={fYear} onChange={(e) => setFYear(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            <option value="">All</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Semester</span>
          <select value={fSeason} onChange={(e) => setFSeason(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            <option value="">All</option>
            {SEASONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        {anyFilter && <button onClick={() => { setQ(""); setFInst(""); setFStatus(""); setFYear(""); setFSeason(""); }} className="pb-1.5 text-xs text-slate-400 hover:text-rose-600">clear</button>}
        <button onClick={() => setShowAdd((v) => !v)} className="ml-auto rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700">{showAdd ? "Close" : "+ Add partner"}</button>
      </div>

      {showAdd && <AddForm institutions={institutions} onDone={() => setShowAdd(false)} />}

      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span><span className="font-medium text-slate-700">{filtered.length}</span> partners</span>
        <span className="text-slate-300">·</span>
        <span>WBL rotations ({periodLabel}): <span className="font-medium text-slate-700 tabular-nums">{totals.secured}</span> secured of <span className="font-medium text-slate-700 tabular-nums">{totals.asked}</span> asked</span>
        <span className={`rounded-full px-2 py-0.5 font-medium ${fillRate >= 90 ? "bg-emerald-100 text-emerald-700" : fillRate >= 70 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`}>{fillRate}% filled</span>
        <span className="text-slate-400">slots are sourced from real placement records, not a static count</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 text-left font-semibold">Partner</th>
              <th className="px-3 py-2 text-left font-semibold">Setting</th>
              <th className="px-3 py-2 text-left font-semibold">Institution</th>
              <th className="px-3 py-2 text-center font-semibold">Asked</th>
              <th className="px-3 py-2 text-center font-semibold">Secured</th>
              <th className="px-3 py-2 text-left font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((e) => {
              const s = scoped(e);
              const gap = s.asked > s.secured;
              return (
                <tr key={e.id} className="hover:bg-slate-50/60">
                  <td className="px-3 py-2">
                    <Link href={`/employers/${e.id}`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{e.name}</Link>
                    {e.city && <span className="block text-[11px] text-slate-400">{e.city}</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-500">{e.setting ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-500">{e.institution.name}</td>
                  <td className="px-3 py-2 text-center tabular-nums text-slate-600">{s.asked || "—"}</td>
                  <td className={`px-3 py-2 text-center tabular-nums ${gap ? "font-semibold text-amber-600" : s.secured ? "text-emerald-600" : "text-slate-400"}`}>{s.secured || "—"}</td>
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
