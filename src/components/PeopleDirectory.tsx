"use client";

import { useMemo, useState } from "react";
import { createPerson, updatePerson, deletePerson } from "@/lib/actions";

export interface DirPerson {
  id: string;
  name: string;
  role: string;
  email: string | null;
  institution: { id: string; name: string };
  employer: { id: string; name: string } | null;
  _count: { sessionStaff: number; assignments: number };
  load: { totalHours: number; cohorts: { name: string; program: string; hours: number }[] };
}
export interface InstLite { id: string; name: string }
export interface EmpLite { id: string; name: string; institutionId: string }

const ROLES = ["instructor", "preceptor", "support", "supervisor", "coordinator"];
const ROLE_LABEL: Record<string, string> = { instructor: "Faculty", preceptor: "Preceptor", support: "Support", supervisor: "Supervisor", coordinator: "Coordinator" };
const ROLE_BADGE: Record<string, string> = {
  instructor: "bg-rose-100 text-rose-700", preceptor: "bg-orange-100 text-orange-700", support: "bg-sky-100 text-sky-700",
  supervisor: "bg-violet-100 text-violet-700", coordinator: "bg-emerald-100 text-emerald-700",
};

export function PeopleDirectory({ people, institutions, employers }: { people: DirPerson[]; institutions: InstLite[]; employers: EmpLite[] }) {
  const [q, setQ] = useState("");
  const [fInst, setFInst] = useState("");
  const [fRole, setFRole] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [loadOpen, setLoadOpen] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return people.filter((p) => {
      if (fInst && p.institution.id !== fInst) return false;
      if (fRole && p.role !== fRole) return false;
      if (needle && !(p.name.toLowerCase().includes(needle) || (p.email ?? "").toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [people, q, fInst, fRole]);

  const byRole = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of filtered) m[p.role] = (m[p.role] ?? 0) + 1;
    return m;
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Search</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="name or email…" className="w-52 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Institution</span>
          <select value={fInst} onChange={(e) => setFInst(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            <option value="">All</option>
            {institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Role</span>
          <select value={fRole} onChange={(e) => setFRole(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            <option value="">All</option>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </label>
        {(q || fInst || fRole) && <button onClick={() => { setQ(""); setFInst(""); setFRole(""); }} className="pb-1.5 text-xs text-slate-400 hover:text-rose-600">clear</button>}
        <button onClick={() => setShowAdd((v) => !v)} className="ml-auto rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700">{showAdd ? "Close" : "+ Add person"}</button>
      </div>

      {showAdd && <PersonForm institutions={institutions} employers={employers} onDone={() => setShowAdd(false)} />}

      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="font-medium text-slate-700">{filtered.length}</span> people
        {Object.entries(byRole).sort((a, b) => b[1] - a[1]).map(([r, n]) => (
          <span key={r} className={`rounded-full px-2 py-0.5 ${ROLE_BADGE[r] ?? "bg-slate-100 text-slate-600"}`}>{ROLE_LABEL[r] ?? r} {n}</span>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 text-left font-semibold">Name</th>
              <th className="px-3 py-2 text-left font-semibold">Role</th>
              <th className="px-3 py-2 text-left font-semibold">Email</th>
              <th className="px-3 py-2 text-left font-semibold">Employer / institution</th>
              <th className="px-3 py-2 text-left font-semibold">Load (cohorts · hrs)</th>
              <th className="px-3 py-2 text-right font-semibold"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((p) => (
              editing === p.id ? (
                <tr key={p.id} className="bg-rose-50/30">
                  <td colSpan={6} className="px-3 py-3">
                    <PersonForm institutions={institutions} employers={employers} person={p} onDone={() => setEditing(null)} compact />
                  </td>
                </tr>
              ) : (
                <tr key={p.id} className="hover:bg-slate-50/60">
                  <td className="px-3 py-2 font-medium text-slate-800">{p.name}</td>
                  <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${ROLE_BADGE[p.role] ?? "bg-slate-100 text-slate-600"}`}>{ROLE_LABEL[p.role] ?? p.role}</span></td>
                  <td className="px-3 py-2 text-slate-500">{p.email ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-500">{p.employer?.name ?? p.institution.name}</td>
                  <td className="px-3 py-2">
                    {p.load.cohorts.length === 0 ? (
                      <span className="text-[12px] text-slate-300">no cohort assignments</span>
                    ) : (
                      <button onClick={() => setLoadOpen(loadOpen === p.id ? null : p.id)} className="text-[12px] text-slate-600 hover:text-rose-700">
                        <span className="font-medium">{p.load.cohorts.length}</span> cohort{p.load.cohorts.length === 1 ? "" : "s"} · <span className="tabular-nums">{Math.round(p.load.totalHours)}h</span>
                        <span className="ml-1 text-slate-300">{loadOpen === p.id ? "▾" : "▸"}</span>
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setEditing(p.id)} className="text-xs text-rose-600 hover:underline">edit</button>
                  </td>
                </tr>
              )
            ))}
            {filtered.map((p) => (
              loadOpen === p.id && editing !== p.id ? (
                <tr key={p.id + "-load"} className="bg-slate-50/60">
                  <td colSpan={6} className="px-3 py-2">
                    <div className="flex flex-wrap gap-1.5">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{p.name} — assignment load:</span>
                      {p.load.cohorts.map((c) => (
                        <span key={c.name} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] ring-1 ring-slate-200">
                          <span className="text-slate-700">{c.name}</span>
                          <span className="text-slate-400">{c.program}</span>
                          <span className="tabular-nums text-rose-600">{Math.round(c.hours)}h</span>
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ) : null
            ))}
            {filtered.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-400">No people match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PersonForm({ institutions, employers, person, onDone, compact }: { institutions: InstLite[]; employers: EmpLite[]; person?: DirPerson; onDone: () => void; compact?: boolean }) {
  const [instId, setInstId] = useState(person?.institution.id ?? institutions[0]?.id ?? "");
  const instEmployers = employers.filter((e) => e.institutionId === instId);

  return (
    <form
      action={async (fd) => { person ? await updatePerson(person.id, fd) : await createPerson(fd); onDone(); }}
      className={`grid gap-3 ${compact ? "sm:grid-cols-3 lg:grid-cols-6 items-end" : "rounded-xl border border-rose-200 bg-rose-50/40 p-4 sm:grid-cols-2 lg:grid-cols-4"}`}
    >
      {!person && (
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Institution</span>
          <select name="institutionId" value={instId} onChange={(e) => setInstId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            {institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </label>
      )}
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Name</span>
        <input name="name" required defaultValue={person?.name} placeholder="Full name" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
      </label>
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Role</span>
        <select name="role" defaultValue={person?.role ?? "instructor"} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Email</span>
        <input name="email" type="email" defaultValue={person?.email ?? ""} placeholder="name@org" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
      </label>
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Employer (preceptors)</span>
        <select name="employerId" defaultValue={person?.employer?.id ?? ""} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
          <option value="">— none —</option>
          {instEmployers.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </label>
      <div className="flex items-end gap-2">
        <button className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700">{person ? "Save" : "Add"}</button>
        <button type="button" onClick={onDone} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-500 hover:bg-white">Cancel</button>
        {person && (
          <button formAction={async () => { await deletePerson(person.id); onDone(); }} className="rounded-lg px-2 py-2 text-xs text-slate-300 hover:text-rose-600" title="delete">✕</button>
        )}
      </div>
    </form>
  );
}
