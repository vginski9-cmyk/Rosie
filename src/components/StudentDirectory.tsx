"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { enrollStudent } from "@/lib/actions";

// The institution-wide Students workspace: search + filter the whole directory,
// and intake (enroll) a new student into a program/cohort with a real record.

export interface DirStudent {
  id: string;
  name: string;
  email: string | null;
  status: string;
  stageKey: string | null;
  sectionIndex: number;
  entryYear: number | null;
  program: { id: string; name: string; institution: { id: string; name: string } };
  cohort: { id: string; name: string } | null;
}
export interface InstTree {
  id: string; name: string;
  programs: { id: string; name: string; cohorts: { id: string; name: string }[] }[];
}

const STATUSES = ["prospect", "applicant", "admitted", "enrolled", "completed", "licensed", "placed", "productive", "withdrawn"];
const STATUS_BADGE: Record<string, string> = {
  prospect: "bg-slate-100 text-slate-600", applicant: "bg-sky-100 text-sky-700", admitted: "bg-indigo-100 text-indigo-700",
  enrolled: "bg-emerald-100 text-emerald-700", completed: "bg-lime-100 text-lime-700", licensed: "bg-amber-100 text-amber-700",
  placed: "bg-orange-100 text-orange-700", productive: "bg-rose-100 text-rose-700", withdrawn: "bg-slate-100 text-slate-400",
};

export function StudentDirectory({ students, institutions }: { students: DirStudent[]; institutions: InstTree[] }) {
  const [q, setQ] = useState("");
  const [fInst, setFInst] = useState("");
  const [fProg, setFProg] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [showEnroll, setShowEnroll] = useState(false);

  const programOptions = useMemo(() => {
    const insts = fInst ? institutions.filter((i) => i.id === fInst) : institutions;
    return insts.flatMap((i) => i.programs.map((p) => ({ id: p.id, name: p.name })));
  }, [institutions, fInst]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return students.filter((s) => {
      if (fInst && s.program.institution.id !== fInst) return false;
      if (fProg && s.program.id !== fProg) return false;
      if (fStatus && s.status !== fStatus) return false;
      if (needle && !(s.name.toLowerCase().includes(needle) || (s.email ?? "").toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [students, q, fInst, fProg, fStatus]);

  const byStatus = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of filtered) m[s.status] = (m[s.status] ?? 0) + 1;
    return m;
  }, [filtered]);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Search</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="name or email…" className="w-56 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Institution</span>
          <select value={fInst} onChange={(e) => { setFInst(e.target.value); setFProg(""); }} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            <option value="">All</option>
            {institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Program</span>
          <select value={fProg} onChange={(e) => setFProg(e.target.value)} className="w-48 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            <option value="">All</option>
            {programOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Status</span>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
            <option value="">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        {(q || fInst || fProg || fStatus) && (
          <button onClick={() => { setQ(""); setFInst(""); setFProg(""); setFStatus(""); }} className="pb-1.5 text-xs text-slate-400 hover:text-rose-600">clear</button>
        )}
        <button onClick={() => setShowEnroll((v) => !v)} className="ml-auto rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700">{showEnroll ? "Close" : "+ Enroll student"}</button>
      </div>

      {/* Enroll / intake form */}
      {showEnroll && <EnrollForm institutions={institutions} onDone={() => setShowEnroll(false)} />}

      {/* Count + status mix */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="font-medium text-slate-700">{filtered.length}</span> of {students.length} students
        {Object.entries(byStatus).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
          <span key={s} className={`rounded-full px-2 py-0.5 ${STATUS_BADGE[s] ?? "bg-slate-100 text-slate-600"}`}>{s} {n}</span>
        ))}
      </div>

      {/* Directory table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 text-left font-semibold">Student</th>
              <th className="px-3 py-2 text-left font-semibold">Program</th>
              <th className="px-3 py-2 text-left font-semibold">Cohort</th>
              <th className="px-3 py-2 text-center font-semibold">Section</th>
              <th className="px-3 py-2 text-left font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50/60">
                <td className="px-3 py-2">
                  <Link href={`/students/${s.id}`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{s.name}</Link>
                  {s.email && <span className="block text-[11px] text-slate-400">{s.email}</span>}
                </td>
                <td className="px-3 py-2 text-slate-600">
                  <Link href={`/programs/${s.program.id}`} className="hover:text-rose-700 hover:underline">{s.program.name}</Link>
                  <span className="block text-[11px] text-slate-400">{s.program.institution.name}</span>
                </td>
                <td className="px-3 py-2 text-slate-500">{s.cohort?.name ?? <span className="text-slate-300">unassigned</span>}</td>
                <td className="px-3 py-2 text-center tabular-nums text-slate-500">{s.sectionIndex}</td>
                <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE[s.status] ?? "bg-slate-100 text-slate-600"}`}>{s.status}</span></td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-sm text-slate-400">No students match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EnrollForm({ institutions, onDone }: { institutions: InstTree[]; onDone: () => void }) {
  const [instId, setInstId] = useState(institutions[0]?.id ?? "");
  const inst = institutions.find((i) => i.id === instId);
  const [progId, setProgId] = useState(inst?.programs[0]?.id ?? "");
  const prog = inst?.programs.find((p) => p.id === progId);

  return (
    <form
      action={async (fd) => { await enrollStudent(fd); onDone(); }}
      className="grid gap-3 rounded-xl border border-rose-200 bg-rose-50/40 p-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Institution</span>
        <select value={instId} onChange={(e) => { setInstId(e.target.value); const i = institutions.find((x) => x.id === e.target.value); setProgId(i?.programs[0]?.id ?? ""); }} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
          {institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Program</span>
        <select name="programId" value={progId} onChange={(e) => setProgId(e.target.value)} required className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
          {(inst?.programs ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Cohort (optional)</span>
        <select name="cohortId" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
          <option value="">— unassigned —</option>
          {(prog?.cohorts ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Status</span>
        <select name="status" defaultValue="applicant" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Full name</span>
        <input name="name" required placeholder="Jordan Rivera" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
      </label>
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Email</span>
        <input name="email" type="email" placeholder="jordan@example.edu" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
      </label>
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Entry year</span>
        <input name="entryYear" type="number" placeholder="2026" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm tabular-nums" />
      </label>
      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Section</span>
        <input name="sectionIndex" type="number" min={1} defaultValue={1} className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm tabular-nums" />
      </label>
      <div className="flex items-end gap-2 lg:col-span-4">
        <button className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700">Enroll student</button>
        <button type="button" onClick={onDone} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-500 hover:bg-white">Cancel</button>
        <span className="pb-1 text-[11px] text-slate-400">Creates a real student record — appears in the program roster and pipeline immediately.</span>
      </div>
    </form>
  );
}
