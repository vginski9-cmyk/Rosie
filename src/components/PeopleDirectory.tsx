"use client";

import { useMemo, useState } from "react";
import { createPerson, updatePerson, deletePerson } from "@/lib/actions";

export interface LoadCohort { cohortId: string; name: string; program: string; hours: number; year: number | null; season: string | null }
export interface DirPerson {
  id: string;
  name: string;
  role: string;
  title: string | null;
  email: string | null;
  active: boolean;
  employmentType: string | null;
  startDate: string | Date | null;
  endDate: string | Date | null;
  institution: { id: string; name: string };
  employer: { id: string; name: string } | null;
  _count: { sessionStaff: number; assignments: number };
  workingNow: boolean;
  currentHours: number;
  load: {
    totalHours: number;
    byYear: Record<number, number>;
    semesters: { year: number; season: string; hours: number }[];
    cohorts: LoadCohort[];
  };
}
export interface InstLite { id: string; name: string }
export interface EmpLite { id: string; name: string; institutionId: string }

const ROLES = ["instructor", "preceptor", "support", "supervisor", "coordinator"];
const ROLE_LABEL: Record<string, string> = { instructor: "Faculty", preceptor: "Preceptor", support: "Support", supervisor: "Supervisor", coordinator: "Coordinator" };
const ROLE_BADGE: Record<string, string> = {
  instructor: "bg-rose-100 text-rose-700", preceptor: "bg-orange-100 text-orange-700", support: "bg-sky-100 text-sky-700",
  supervisor: "bg-violet-100 text-violet-700", coordinator: "bg-emerald-100 text-emerald-700",
};
const SEASONS = ["Fall", "Spring", "Summer"];
const EMP_TYPES = ["full-time", "part-time", "adjunct", "contract", "preceptor"];

const ymd = (d: string | Date | null): string => {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(dt.getTime()) ? "" : dt.toISOString().slice(0, 10);
};
const monthYear = (d: string | Date | null): string | null => {
  if (!d) return null;
  const dt = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(dt.getTime()) ? null : dt.toLocaleDateString(undefined, { month: "short", year: "numeric" });
};

export function PeopleDirectory({ people, institutions, employers }: { people: DirPerson[]; institutions: InstLite[]; employers: EmpLite[] }) {
  const [q, setQ] = useState("");
  const [fInst, setFInst] = useState("");
  const [fRole, setFRole] = useState("");
  const [fStatus, setFStatus] = useState<"" | "active" | "inactive">("");
  const [fWorking, setFWorking] = useState(false);
  const [fYear, setFYear] = useState<string>("");
  const [fSeason, setFSeason] = useState<string>("");
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [loadOpen, setLoadOpen] = useState<string | null>(null);

  const years = useMemo(() => {
    const s = new Set<number>();
    for (const p of people) for (const k of Object.keys(p.load.byYear)) s.add(Number(k));
    return [...s].sort((a, b) => b - a);
  }, [people]);

  const periodActive = fYear !== "" || fSeason !== "";

  // Hours for a person scoped to the selected period (year and/or season).
  const scopedHours = (p: DirPerson): number => {
    if (!periodActive) return p.load.totalHours;
    let h = 0;
    for (const c of p.load.cohorts) {
      if (fYear && String(c.year) !== fYear) continue;
      if (fSeason && c.season !== fSeason) continue;
      h += c.hours;
    }
    return h;
  };
  const scopedCohorts = (p: DirPerson): LoadCohort[] =>
    p.load.cohorts.filter((c) => (!fYear || String(c.year) === fYear) && (!fSeason || c.season === fSeason));

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return people.filter((p) => {
      if (fInst && p.institution.id !== fInst) return false;
      if (fRole && p.role !== fRole) return false;
      if (fStatus === "active" && !p.active) return false;
      if (fStatus === "inactive" && p.active) return false;
      if (fWorking && !p.workingNow) return false;
      if (periodActive && scopedHours(p) <= 0) return false;
      if (needle && !(p.name.toLowerCase().includes(needle) || (p.title ?? "").toLowerCase().includes(needle) || (p.email ?? "").toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [people, q, fInst, fRole, fStatus, fWorking, fYear, fSeason]); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = useMemo(() => {
    const byRole: Record<string, number> = {};
    let active = 0, working = 0;
    for (const p of filtered) { byRole[p.role] = (byRole[p.role] ?? 0) + 1; if (p.active) active++; if (p.workingNow) working++; }
    return { byRole, active, inactive: filtered.length - active, working };
  }, [filtered]);

  const periodLabel = periodActive ? `${fSeason || "all"} ${fYear || "years"}`.trim() : "all-time";
  const anyFilter = q || fInst || fRole || fStatus || fWorking || periodActive;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Search</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="name, title, email…" className="w-48 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
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
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Status</span>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value as "" | "active" | "inactive")} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            <option value="">All</option>
            <option value="active">Active (with org)</option>
            <option value="inactive">Inactive / departed</option>
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
        <label className="flex items-center gap-1.5 pb-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={fWorking} onChange={(e) => setFWorking(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300" />
          Working now
        </label>
        {anyFilter && <button onClick={() => { setQ(""); setFInst(""); setFRole(""); setFStatus(""); setFWorking(false); setFYear(""); setFSeason(""); }} className="pb-1.5 text-xs text-slate-400 hover:text-rose-600">clear</button>}
        <button onClick={() => setShowAdd((v) => !v)} className="ml-auto rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700">{showAdd ? "Close" : "+ Add person"}</button>
      </div>

      {showAdd && <PersonForm institutions={institutions} employers={employers} onDone={() => setShowAdd(false)} />}

      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="font-medium text-slate-700">{filtered.length}</span> people
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700">{summary.active} active</span>
        {summary.inactive > 0 && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-slate-600">{summary.inactive} inactive</span>}
        <span className="rounded-full bg-rose-600 px-2 py-0.5 text-white">{summary.working} working now</span>
        <span className="text-slate-300">·</span>
        {Object.entries(summary.byRole).sort((a, b) => b[1] - a[1]).map(([r, n]) => (
          <span key={r} className={`rounded-full px-2 py-0.5 ${ROLE_BADGE[r] ?? "bg-slate-100 text-slate-600"}`}>{ROLE_LABEL[r] ?? r} {n}</span>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 text-left font-semibold">Name &amp; title</th>
              <th className="px-3 py-2 text-left font-semibold">Role</th>
              <th className="px-3 py-2 text-left font-semibold">Status</th>
              <th className="px-3 py-2 text-left font-semibold">Affiliation</th>
              <th className="px-3 py-2 text-left font-semibold">Workload <span className="font-normal normal-case text-slate-400">({periodLabel})</span></th>
              <th className="px-3 py-2 text-right font-semibold"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((p) => {
              const hrs = scopedHours(p);
              const cohorts = scopedCohorts(p);
              return editing === p.id ? (
                <tr key={p.id} className="bg-rose-50/30">
                  <td colSpan={6} className="px-3 py-3">
                    <PersonForm institutions={institutions} employers={employers} person={p} onDone={() => setEditing(null)} compact />
                  </td>
                </tr>
              ) : (
                <tr key={p.id} className="align-top hover:bg-slate-50/60">
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-800">{p.name}</div>
                    {p.title && <div className="text-[11px] text-slate-400">{p.title}</div>}
                  </td>
                  <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${ROLE_BADGE[p.role] ?? "bg-slate-100 text-slate-600"}`}>{ROLE_LABEL[p.role] ?? p.role}</span></td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1">
                      {p.active
                        ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Active</span>
                        : <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600">Departed</span>}
                      {p.workingNow && <span className="inline-flex items-center gap-1 rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-medium text-white"><span className="h-1.5 w-1.5 rounded-full bg-white" />working now</span>}
                    </div>
                    {p.employmentType && <div className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-400">{p.employmentType}</div>}
                  </td>
                  <td className="px-3 py-2 text-slate-500">
                    <div>{p.employer?.name ?? p.institution.name}</div>
                    {(monthYear(p.startDate) || monthYear(p.endDate)) && (
                      <div className="text-[10px] text-slate-400">
                        {monthYear(p.startDate) ? `since ${monthYear(p.startDate)}` : ""}{p.endDate ? ` · left ${monthYear(p.endDate)}` : ""}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {cohorts.length === 0 ? (
                      <span className="text-[12px] text-slate-300">{periodActive ? "no load this period" : "no cohort assignments"}</span>
                    ) : (
                      <button onClick={() => setLoadOpen(loadOpen === p.id ? null : p.id)} className="text-[12px] text-slate-600 hover:text-rose-700">
                        <span className="font-medium">{cohorts.length}</span> cohort{cohorts.length === 1 ? "" : "s"} · <span className="tabular-nums text-rose-600">{Math.round(hrs)}h</span>
                        {p.workingNow && !periodActive && <span className="ml-1 tabular-nums text-slate-400">({Math.round(p.currentHours)}h now)</span>}
                        <span className="ml-1 text-slate-300">{loadOpen === p.id ? "▾" : "▸"}</span>
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setEditing(p.id)} className="text-xs text-rose-600 hover:underline">edit</button>
                  </td>
                </tr>
              );
            })}
            {filtered.map((p) => (
              loadOpen === p.id && editing !== p.id ? (
                <tr key={p.id + "-load"} className="bg-slate-50/60">
                  <td colSpan={6} className="px-3 py-2">
                    <div className="flex flex-wrap gap-1.5">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{p.name} — load{periodActive ? ` (${periodLabel})` : " by term"}:</span>
                      {scopedCohorts(p).map((c, i) => (
                        <span key={c.cohortId + i} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] ring-1 ring-slate-200">
                          <span className="text-slate-700">{c.name}</span>
                          <span className="text-slate-400">{c.program}</span>
                          {c.year && <span className="text-slate-400">{c.season} {c.year}</span>}
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
      className={`grid gap-3 ${compact ? "sm:grid-cols-3 lg:grid-cols-4 items-end" : "rounded-xl border border-rose-200 bg-rose-50/40 p-4 sm:grid-cols-2 lg:grid-cols-4"}`}
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
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Title</span>
        <input name="title" defaultValue={person?.title ?? ""} placeholder="e.g. Clinical Coordinator" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
      </label>
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Role</span>
        <select name="role" defaultValue={person?.role ?? "instructor"} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Employment</span>
        <select name="employmentType" defaultValue={person?.employmentType ?? "full-time"} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
          {EMP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
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
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Affiliated since</span>
        <input name="startDate" type="date" defaultValue={ymd(person?.startDate ?? null)} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
      </label>
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Departed (if any)</span>
        <input name="endDate" type="date" defaultValue={ymd(person?.endDate ?? null)} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
      </label>
      <label className="flex items-center gap-1.5 pb-1.5 text-sm text-slate-600">
        <input type="checkbox" name="active" defaultChecked={person ? person.active : true} className="h-4 w-4 rounded border-slate-300" />
        Currently with the org
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
